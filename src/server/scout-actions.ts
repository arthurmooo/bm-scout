import { DEFAULT_ROUTINE_CONFIG, routineTypeForAction } from "../domain/scheduler";
import type { LeadActionType } from "../domain/types";
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
  launch_core: "Routine Core mise en file.",
  launch_exploration: "Routine Exploration mise en file.",
  launch_daily_brief: "Daily Brief mis en file.",
  launch_learning_review: "Learning Review mise en file."
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

  if (companyId) {
    await applyLeadMutation(input, companyId);
  }

  const { error } = await client.from("scout_action_events").insert({
    company_id: companyId,
    action: input.action,
    note: input.note ?? input.reason ?? ACTION_LABELS[input.action],
    payload: {
      leadId: input.leadId ?? null,
      reason: input.reason ?? null
    }
  });
  if (error) return failure(error.message);

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
  }
  if (input.action === "copy_email") await markMessageCopied(companyId, "email");
  if (input.action === "copy_follow_up") await markMessageCopied(companyId, "follow_up");
  if (input.action === "copy_linkedin") await markMessageCopied(companyId, "linkedin");
}

async function markMessageCopied(companyId: string, channel: "email" | "follow_up" | "linkedin"): Promise<void> {
  const client = createServerSupabaseClient();
  if (!client) return;
  await checked(
    client
      .from("scout_messages")
      .update({ status: "copied" })
      .eq("company_id", companyId)
      .eq("channel", channel)
      .neq("status", "blocked")
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
