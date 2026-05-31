import { DEFAULT_ROUTINE_CONFIG, routineTypeForAction } from "../domain/scheduler";
import type { FeedbackKind, LeadActionType, LeadVerdict, QualityDecision } from "../domain/types";
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
};

type MessageChannel = "email" | "follow_up" | "linkedin";

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
  mark_message_used: "Message marqué comme utilisé manuellement.",
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
  launch_learning_review: "Learning Review mise en file."
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
    companyPatch: (note) => ({ verdict: "reject", rejection_reason: note })
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

  if (routineType) {
    const { error } = await client.from("scout_agent_tasks").insert({
      type: routineType,
      status: "queued",
      title: ACTION_LABELS[input.action],
      summary: input.note ?? "Routine lancée manuellement depuis la console Romu.",
      recommendation: "Exécuter le worker/scheduler serveur, puis relire les sorties QC avant décision Romu.",
      payload: DEFAULT_ROUTINE_CONFIG,
      scheduled_for: new Date().toISOString()
    });
    if (error) return failure(error.message);
  }

  let mutationError: string | null = null;
  if (companyId) {
    try {
      await applyLeadMutation(input, companyId);
    } catch (error) {
      mutationError = error instanceof Error ? error.message : String(error);
    }
  }

  const { error } = await client.from("scout_action_events").insert({
    company_id: companyId,
    action: input.action,
    note: input.note ?? input.reason ?? ACTION_LABELS[input.action],
    payload: {
      leadId: input.leadId ?? null,
      reason: input.reason ?? null,
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

async function applyLeadMutation(input: ScoutActionInput, companyId: string): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) return;

  if (input.action === "validate_lead") {
    await checked(client.from("scout_companies").update({ verdict: "validate" }).eq("id", companyId));
  }
  if (input.action === "reject_lead") {
    await checked(
      client
        .from("scout_companies")
        .update({ verdict: "reject", rejection_reason: input.reason ?? input.note ?? "Rejet manuel Romu." })
        .eq("id", companyId)
    );
  }
  if (input.action === "watch_lead") {
    await checked(client.from("scout_companies").update({ verdict: "watch" }).eq("id", companyId));
  }
  if (input.action === "exclude_lead") {
    await checked(
      client
        .from("scout_companies")
        .update({ verdict: "reject", rejection_reason: input.reason ?? "Exclusion manuelle Romu." })
        .eq("id", companyId)
    );
  }
  if (input.action === "request_enrichment") {
    await checked(client.from("scout_companies").update({ verdict: "enrich", quality_decision: "needs_enrichment" }).eq("id", companyId));
  }
  if (input.action === "add_do_not_contact") {
    await checked(
      client.from("scout_do_not_contact").insert({
        scope: "company",
        company_id: companyId,
        source: "manual",
        reason: input.reason ?? input.note ?? "Ajout manuel Romu."
      })
    );
    await checked(
      client
        .from("scout_companies")
        .update({ verdict: "reject", quality_decision: "blocked", rejection_reason: "Do-not-contact manuel." })
        .eq("id", companyId)
    );
    await checked(client.from("scout_messages").update({ status: "blocked" }).eq("company_id", companyId));
    await insertFeedback(companyId, "do_not_contact", input.reason ?? input.note ?? "Do-not-contact manuel Romu.");
  }
  if (input.action === "copy_email") await markMessageCopied(companyId, "email");
  if (input.action === "copy_follow_up") await markMessageCopied(companyId, "follow_up");
  if (input.action === "copy_linkedin") await markMessageCopied(companyId, "linkedin");
  if (input.action === "mark_message_used") await markMessagesUsed(companyId);
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
  }
}

async function markMessageCopied(companyId: string, channel: MessageChannel): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) return;
  await assertMessageCopyAllowed(companyId, channel);
  await checked(
    client
      .from("scout_messages")
      .update({ status: "copied" })
      .eq("company_id", companyId)
      .eq("channel", channel)
      .neq("status", "blocked")
  );
}

async function assertMessageCopyAllowed(companyId: string, channel: MessageChannel): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) return;

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
}

async function markMessagesUsed(companyId: string): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) return;
  await assertMessageCopyAllowed(companyId, "email");
  await assertMessageCopyAllowed(companyId, "follow_up");
  await assertMessageCopyAllowed(companyId, "linkedin");
  await checked(
    client
      .from("scout_messages")
      .update({ status: "approved" })
      .eq("company_id", companyId)
      .neq("status", "blocked")
  );
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
  return !["launch_core", "launch_exploration", "launch_daily_brief", "launch_learning_review"].includes(action);
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
