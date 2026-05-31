import { DEFAULT_ROUTINE_CONFIG, routineTypeForAction } from "../domain/scheduler";
import type { AgentTaskStatus, AgentTaskType, FeedbackKind, LeadActionType, LeadVerdict, QualityDecision } from "../domain/types";
import { createServerSupabaseClient } from "./supabase";

export interface ScoutActionInput {
  action: LeadActionType;
  leadId?: string;
  note?: string;
  reason?: string;
}

export interface ScoutActionResult {
  ok: boolean;
  persisted: boolean;
  message: string;
}

type CompanyPatch = {
  verdict?: LeadVerdict;
  quality_decision?: QualityDecision;
  rejection_reason?: string;
  next_action?: string;
};

type ScoutOutcomeValue = "interested" | "not_now" | "not_relevant" | "meeting_booked" | "negative" | "no_response";

type FeedbackActionEffect = {
  kind: FeedbackKind;
  defaultNote: string;
  companyPatch?: (note: string) => CompanyPatch;
  rejectMessages?: boolean;
};

type OutcomeActionEffect = {
  value: ScoutOutcomeValue;
  defaultNote: string;
  companyPatch?: (note: string) => CompanyPatch;
  hardGateFollowUps?: boolean;
};

type MessageChannel = "email" | "follow_up" | "linkedin";

type ActionMutationTrace = {
  messageId?: string;
  messageIds?: string[];
  channel?: MessageChannel;
  channels?: MessageChannel[];
  dncScopes?: string[];
  taskId?: string;
  taskType?: AgentTaskType;
  taskStatus?: AgentTaskStatus;
};

const ACTION_LABELS: Record<LeadActionType, string> = {
  validate_lead: "Lead validé.",
  reject_lead: "Lead rejeté.",
  watch_lead: "Lead placé en surveillance.",
  exclude_lead: "Lead exclu.",
  request_enrichment: "Enrichissement demandé.",
  rerun_qc: "Relance QC demandée.",
  copy_email: "Email copié. Aucun envoi automatique.",
  copy_follow_up: "Relance copiée. Aucun envoi automatique.",
  copy_linkedin: "Message LinkedIn copié. Aucun envoi automatique.",
  mark_message_used: "Messages marqués comme utilisés manuellement.",
  add_do_not_contact: "Do-not-contact ajouté.",
  feedback_good_lead: "Feedback lead positif enregistré.",
  feedback_bad_lead: "Feedback lead négatif enregistré.",
  feedback_good_angle: "Feedback angle enregistré.",
  feedback_generic_message: "Feedback message générique enregistré.",
  outcome_no_response: "Outcome sans réponse enregistré.",
  outcome_negative: "Outcome négatif enregistré.",
  outcome_positive: "Outcome positif enregistré.",
  outcome_meeting_booked: "Outcome RDV pris enregistré.",
  outcome_wrong_person: "Outcome mauvais interlocuteur enregistré.",
  outcome_pain_confirmed: "Outcome douleur confirmée enregistré.",
  outcome_pain_not_confirmed: "Outcome douleur non confirmée enregistré.",
  outcome_bad_timing: "Outcome mauvais timing enregistré.",
  launch_core: "Routine Core mise en file.",
  launch_exploration: "Routine Exploration mise en file.",
  launch_daily_brief: "Daily Brief mis en file.",
  launch_learning_review: "Learning Review mise en file.",
  launch_dnc_check: "Contrôle do-not-contact mis en file.",
  launch_followup_review: "Revue relances mise en file."
};

const FEEDBACK_ACTIONS: Partial<Record<LeadActionType, FeedbackActionEffect>> = {
  feedback_good_lead: {
    kind: "good_lead",
    defaultNote: "Très bon lead.",
    companyPatch: () => ({ verdict: "validate" })
  },
  feedback_bad_lead: {
    kind: "bad_lead",
    defaultNote: "Mauvais lead.",
    companyPatch: (note) => ({ verdict: "reject", rejection_reason: note })
  },
  feedback_good_angle: {
    kind: "good_angle",
    defaultNote: "Très bon angle."
  },
  feedback_generic_message: {
    kind: "generic_message",
    defaultNote: "Message trop générique.",
    rejectMessages: true
  }
};

const OUTCOME_ACTIONS: Partial<Record<LeadActionType, OutcomeActionEffect>> = {
  outcome_no_response: {
    value: "no_response",
    defaultNote: "Pas de réponse."
  },
  outcome_negative: {
    value: "negative",
    defaultNote: "Réponse négative.",
    companyPatch: (note) => ({ verdict: "reject", quality_decision: "blocked", rejection_reason: note }),
    hardGateFollowUps: true
  },
  outcome_positive: {
    value: "interested",
    defaultNote: "Réponse positive.",
    companyPatch: () => ({ verdict: "validate" })
  },
  outcome_meeting_booked: {
    value: "meeting_booked",
    defaultNote: "RDV pris.",
    companyPatch: () => ({ verdict: "validate" })
  },
  outcome_wrong_person: {
    value: "not_relevant",
    defaultNote: "Mauvais interlocuteur.",
    companyPatch: (note) => ({ verdict: "reject", rejection_reason: note })
  },
  outcome_pain_confirmed: {
    value: "interested",
    defaultNote: "Douleur confirmée.",
    companyPatch: () => ({ verdict: "validate" })
  },
  outcome_pain_not_confirmed: {
    value: "not_relevant",
    defaultNote: "Douleur non confirmée.",
    companyPatch: (note) => ({ verdict: "reject", rejection_reason: note })
  },
  outcome_bad_timing: {
    value: "not_now",
    defaultNote: "Timing mauvais.",
    companyPatch: () => ({ verdict: "watch", next_action: "À retenter plus tard : timing défavorable." })
  }
};

export async function recordScoutAction(input: ScoutActionInput): Promise<ScoutActionResult> {
  const client = createServerSupabaseClient();
  if (!client) {
    return {
      ok: false,
      persisted: false,
      message: "Action non persistée : variables Supabase serveur absentes."
    };
  }

  const companyId = input.leadId ? await resolveCompanyId(input.leadId) : null;
  const routineType = routineTypeForAction(input.action);

  if (requiresLead(input.action) && !companyId) {
    return {
      ok: false,
      persisted: false,
      message: `Lead introuvable pour l'action ${input.action}.`
    };
  }

  let mutationError: string | null = null;
  let mutationTrace: ActionMutationTrace | null = null;
  if (routineType) {
    try {
      mutationTrace = await enqueueRoutineTask(input, routineType);
    } catch (error) {
      mutationError = error instanceof Error ? error.message : String(error);
    }
  }

  if (companyId && !mutationError) {
    try {
      mutationTrace = await applyLeadMutation(input, companyId);
    } catch (error) {
      mutationError = error instanceof Error ? error.message : String(error);
    }
  }

  const { error } = await client.from("scout_action_events").insert({
    company_id: companyId,
    message_id: mutationTrace?.messageId ?? null,
    action: input.action,
    note: input.note ?? input.reason ?? ACTION_LABELS[input.action],
    payload: {
      leadId: input.leadId ?? null,
      reason: input.reason ?? null,
      mutation: mutationTrace,
      ok: mutationError === null,
      error: mutationError
    }
  });
  if (error) return failure(error.message);

  if (mutationError) return failure(mutationError);

  return {
    ok: true,
    persisted: true,
    message: ACTION_LABELS[input.action]
  };
}

async function enqueueRoutineTask(input: ScoutActionInput, routineType: AgentTaskType): Promise<ActionMutationTrace> {
  const client = createServerSupabaseClient();
  if (!client) return { taskType: routineType };
  const { data, error } = await client
    .from("scout_agent_tasks")
    .insert({
      type: routineType,
      status: "queued",
      title: ACTION_LABELS[input.action],
      summary: input.note ?? "Routine lancée manuellement depuis la console Romu.",
      recommendation: "Exécuter le worker/scheduler serveur, puis relire les sorties QC avant décision Romu.",
      payload: DEFAULT_ROUTINE_CONFIG,
      scheduled_for: new Date().toISOString()
    })
    .select("id,type,status")
    .maybeSingle();

  if (error) throw new Error(error.message);
  const task = data as QueuedTaskRow | null;
  return {
    taskId: task?.id,
    taskType: task?.type ?? routineType,
    taskStatus: task?.status ?? "queued"
  };
}

async function resolveCompanyId(leadId: string): Promise<string | null> {
  const client = createServerSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("scout_companies")
    .select("id")
    .or(`id.eq.${leadId},external_id.eq.${leadId}`)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Resolution lead impossible: ${error.message}`);
  return data?.id ?? null;
}

async function applyLeadMutation(input: ScoutActionInput, companyId: string): Promise<ActionMutationTrace | null> {
  const client = createServerSupabaseClient();
  if (!client) return null;

  if (input.action === "validate_lead") {
    await checked(client.from("scout_companies").update({ verdict: "validate" }).eq("id", companyId));
    await insertFeedback(companyId, "good_lead", input.note ?? input.reason ?? "Lead validé par Romu.");
  }
  if (input.action === "reject_lead") {
    const note = input.reason ?? input.note ?? "Rejet manuel Romu.";
    await checked(
      client
        .from("scout_companies")
        .update({ verdict: "reject", rejection_reason: note })
        .eq("id", companyId)
    );
    await insertFeedback(companyId, "bad_lead", note);
  }
  if (input.action === "watch_lead") {
    await checked(client.from("scout_companies").update({ verdict: "watch" }).eq("id", companyId));
    await checked(
      client.from("scout_outcomes").insert({
        company_id: companyId,
        outcome: "not_now",
        note: input.note ?? input.reason ?? "À surveiller : décision Romu sans rejet."
      })
    );
  }
  if (input.action === "exclude_lead") {
    const note = input.reason ?? "Exclusion manuelle Romu.";
    await checked(
      client
        .from("scout_companies")
        .update({ verdict: "reject", rejection_reason: note })
        .eq("id", companyId)
    );
    await insertFeedback(companyId, "bad_lead", note);
  }
  if (input.action === "request_enrichment") {
    await checked(client.from("scout_companies").update({ verdict: "enrich", quality_decision: "needs_enrichment" }).eq("id", companyId));
  }
  if (input.action === "add_do_not_contact") {
    const note = input.reason ?? input.note ?? "Ajout manuel Romu.";
    const dncTrace = await markCompanyDoNotContact(companyId, "manual", note);
    await checked(
      client
        .from("scout_companies")
        .update({ verdict: "reject", quality_decision: "blocked", rejection_reason: "Do-not-contact manuel." })
        .eq("id", companyId)
    );
    await checked(client.from("scout_messages").update({ status: "blocked" }).eq("company_id", companyId));
    await insertFeedback(companyId, "do_not_contact", note);
    return dncTrace;
  }
  if (input.action === "copy_email") return markMessageCopied(companyId, "email");
  if (input.action === "copy_follow_up") return markMessageCopied(companyId, "follow_up");
  if (input.action === "copy_linkedin") return markMessageCopied(companyId, "linkedin");
  if (input.action === "mark_message_used") return markMessagesUsed(companyId);
  if (input.action === "rerun_qc") {
    await checked(
      client
        .from("scout_companies")
        .update({ verdict: "enrich", quality_decision: "needs_enrichment", next_action: "Relancer QC demandé par Romu." })
        .eq("id", companyId)
    );
  }

  const feedback = FEEDBACK_ACTIONS[input.action];
  if (feedback) {
    const note = input.note ?? input.reason ?? feedback.defaultNote;
    await insertFeedback(companyId, feedback.kind, note);
    if (feedback.companyPatch) await updateCompany(companyId, feedback.companyPatch(note));
    if (feedback.rejectMessages) await rejectUnblockedMessages(companyId);
  }

  const outcome = OUTCOME_ACTIONS[input.action];
  if (outcome) {
    const note = input.note ?? input.reason ?? outcome.defaultNote;
    await checked(
      client.from("scout_outcomes").insert({
        company_id: companyId,
        outcome: outcome.value,
        note
      })
    );
    if (outcome.companyPatch) await updateCompany(companyId, outcome.companyPatch(note));
    if (outcome.hardGateFollowUps) await hardGateFutureContactAfterNegativeOutcome(companyId, note);
  }

  return null;
}

async function markMessageCopied(companyId: string, channel: MessageChannel): Promise<ActionMutationTrace> {
  const client = createServerSupabaseClient();
  if (!client) return {};
  const message = await assertMessageCopyAllowed(companyId, channel);
  await checked(
    client
      .from("scout_messages")
      .update({ status: "copied" })
      .eq("id", message.id)
      .neq("status", "blocked")
  );
  return { messageId: message.id, channel };
}

async function assertMessageCopyAllowed(companyId: string, channel: MessageChannel): Promise<CopyableMessageRow> {
  const client = createServerSupabaseClient();
  if (!client) throw new Error("Vérification message impossible : client Supabase serveur absent.");

  const { data, error } = await client
    .from("scout_messages")
    .select("id,status,body,contact_id,scout_contacts(email,email_status,email_type),scout_companies(domain)")
    .eq("company_id", companyId)
    .eq("channel", channel)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Vérification message impossible: ${error.message}`);
  const message = data as CopyableMessageRow | null;
  if (!message) throw new Error("Copie bloquée : message introuvable.");
  if (message.status === "blocked" || message.body.toLowerCase().startsWith("brouillon blo")) {
    throw new Error("Copie bloquée : message non autorisé par le Quality Control.");
  }
  await assertNoBlockingOutcome(companyId);
  if ((channel === "email" || channel === "follow_up") && message.scout_contacts?.email_status !== "usable") {
    throw new Error("Copie bloquée : email contact à vérifier ou non utilisable.");
  }

  const { data: isDnc, error: dncError } = await client.rpc("scout_is_do_not_contact", {
    input_email: message.scout_contacts?.email ?? null,
    input_domain: message.scout_companies?.domain ?? null,
    input_company_id: companyId,
    input_contact_id: message.contact_id ?? null
  });

  if (dncError) throw new Error(`Vérification do-not-contact impossible: ${dncError.message}`);
  if (isDnc) throw new Error("Copie bloquée : cible do-not-contact.");
  return message;
}

async function assertNoBlockingOutcome(companyId: string): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) return;
  const { data, error } = await client
    .from("scout_outcomes")
    .select("id,outcome,note")
    .eq("company_id", companyId)
    .in("outcome", ["negative"])
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Vérification outcome impossible: ${error.message}`);
  if (data) throw new Error("Copie bloquée : outcome négatif / opt-out déjà enregistré.");
}

async function markMessagesUsed(companyId: string): Promise<ActionMutationTrace> {
  const client = createServerSupabaseClient();
  if (!client) return {};
  const messages = await Promise.all([
    assertMessageCopyAllowed(companyId, "email"),
    assertMessageCopyAllowed(companyId, "follow_up"),
    assertMessageCopyAllowed(companyId, "linkedin")
  ]);
  const messageIds = Array.from(new Set(messages.map((message) => message.id)));
  await checked(
    client
      .from("scout_messages")
      .update({ status: "used_manually" })
      .in("id", messageIds)
      .neq("status", "blocked")
  );
  return { messageIds, channels: ["email", "follow_up", "linkedin"] };
}

async function rejectUnblockedMessages(companyId: string): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) return;
  await checked(
    client
      .from("scout_messages")
      .update({ status: "rejected" })
      .eq("company_id", companyId)
      .neq("status", "blocked")
  );
}

async function hardGateFutureContactAfterNegativeOutcome(companyId: string, note: string): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) return;
  await markCompanyDoNotContact(companyId, "reply", note);
  await checked(client.from("scout_messages").update({ status: "blocked" }).eq("company_id", companyId).neq("status", "blocked"));
  await insertFeedback(companyId, "negative_outcome", note);
  await insertFeedback(companyId, "do_not_contact", `Outcome négatif / opt-out : ${note}`);
}

async function markCompanyDoNotContact(
  companyId: string,
  source: "manual" | "reply",
  reason: string
): Promise<ActionMutationTrace> {
  const client = createServerSupabaseClient();
  if (!client) return {};
  const target = await loadDncTargets(companyId);
  const records: DoNotContactInsert[] = [{ scope: "company", company_id: companyId, source, reason }];
  if (target.domain) records.push({ scope: "domain", normalized_domain: target.domain, company_id: companyId, source, reason });
  for (const contact of target.contacts) {
    records.push({
      scope: "contact",
      contact_id: contact.id,
      company_id: companyId,
      normalized_email_hash: contact.email_hash ?? undefined,
      source,
      reason
    });
  }
  await checked(client.from("scout_do_not_contact").insert(records));
  return { dncScopes: Array.from(new Set(records.map((record) => record.scope))) };
}

async function loadDncTargets(companyId: string): Promise<CompanyDncTargets> {
  const client = createServerSupabaseClient();
  if (!client) return { domain: null, contacts: [] };
  const { data, error } = await client
    .from("scout_companies")
    .select("domain,scout_contacts(id,email_hash)")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw new Error(`Lecture cibles do-not-contact impossible: ${error.message}`);
  const row = data as CompanyDncTargetRow | null;
  return {
    domain: normalizeDomain(row?.domain),
    contacts: Array.isArray(row?.scout_contacts)
      ? row.scout_contacts.filter((contact): contact is ContactDncTarget => Boolean(contact?.id))
      : []
  };
}

async function updateCompany(companyId: string, patch: CompanyPatch): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) return;
  await checked(client.from("scout_companies").update(patch).eq("id", companyId));
}

async function insertFeedback(companyId: string, kind: FeedbackKind, note: string): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) return;
  await checked(
    client.from("scout_feedback").insert({
      company_id: companyId,
      kind,
      note
    })
  );
}

async function checked<T extends { error: { message: string } | null }>(request: PromiseLike<T>): Promise<void> {
  const { error } = await request;
  if (error) throw new Error(error.message);
}

function requiresLead(action: LeadActionType): boolean {
  return ![
    "launch_core",
    "launch_exploration",
    "launch_daily_brief",
    "launch_learning_review",
    "launch_dnc_check",
    "launch_followup_review"
  ].includes(action);
}

function failure(message: string): ScoutActionResult {
  return {
    ok: false,
    persisted: false,
    message
  };
}

interface CopyableMessageRow {
  id: string;
  status: string;
  body: string;
  contact_id: string | null;
  scout_contacts?: { email: string | null; email_status: "usable" | "verify" | "not_usable"; email_type: string | null } | null;
  scout_companies?: { domain: string | null } | null;
}

type DoNotContactInsert = {
  scope: "company" | "domain" | "contact";
  source: "manual" | "reply";
  reason: string;
  company_id?: string;
  contact_id?: string;
  normalized_domain?: string;
  normalized_email_hash?: string;
};

type ContactDncTarget = {
  id: string;
  email_hash: string | null;
};

type CompanyDncTargetRow = {
  domain: string | null;
  scout_contacts?: Array<ContactDncTarget | null> | null;
};

type CompanyDncTargets = {
  domain: string | null;
  contacts: ContactDncTarget[];
};

type QueuedTaskRow = {
  id?: string;
  type?: AgentTaskType;
  status?: AgentTaskStatus;
};

function normalizeDomain(domain: string | null | undefined): string | null {
  const value = domain?.trim().toLowerCase();
  return value || null;
}
