import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type ScoutMode = "core" | "exploration";

export interface SupabasePersistenceDedupeProbe {
  verified: boolean;
  domain: string;
  traceIds: string[];
  runIds: string[];
  companyCount: number;
  retainedMode: string | null;
  mergedRunStepCount: number;
  cleanupRemainingCompanies: number;
  cleanupRemainingRuns: number;
  blockers: string[];
  error?: string;
  cleanupError?: string;
}

export interface SupabaseComplianceGateProbe {
  verified: boolean;
  domain: string;
  noApprovedMessageConstraint: boolean;
  dncUniqueCompany: boolean;
  dncUniqueDomain: boolean;
  dncUniqueContact: boolean;
  dncUniqueEmailHash: boolean;
  cleanupRemainingCompanies: number;
  cleanupRemainingContacts: number;
  cleanupRemainingDncRows: number;
  cleanupRemainingMessages: number;
  blockers: string[];
  errors: string[];
  cleanupError?: string;
}

interface CleanupResult {
  remainingCompanies: number;
  remainingRuns: number;
  error?: string;
}

interface ComplianceCleanupResult {
  remainingCompanies: number;
  remainingContacts: number;
  remainingDncRows: number;
  remainingMessages: number;
  error?: string;
}

export async function verifySupabasePersistenceDedupe(client: SupabaseClient): Promise<SupabasePersistenceDedupeProbe> {
  const suffix = randomUUID().slice(0, 8);
  const domain = `bm-scout-dedupe-${suffix}.invalid`;
  const traceIds = [`verify-dedupe-core-${suffix}`, `verify-dedupe-exploration-${suffix}`];
  const runIds: string[] = [];
  const blockers: string[] = [];
  let companyCount = 0;
  let retainedMode: string | null = null;
  let mergedRunStepCount = 0;
  let error: string | undefined;

  try {
    runIds.push(await persistProbeRun(client, "core", domain, traceIds[0], suffix));
    runIds.push(await persistProbeRun(client, "exploration", domain, traceIds[1], suffix));

    const companies = await loadProbeCompanies(client, domain);
    companyCount = companies.length;
    retainedMode = typeof companies[0]?.mode === "string" ? companies[0].mode : null;
    mergedRunStepCount = await countMergedRunSteps(client, runIds, domain);

    if (companyCount !== 1) blockers.push(`Fusion domaine Supabase invalide: ${companyCount} companies pour ${domain}.`);
    if (retainedMode !== "core") blockers.push(`Fusion domaine Supabase sans priorité Core: mode conservé ${retainedMode ?? "absent"}.`);
    if (mergedRunStepCount < 1) blockers.push("Fusion domaine Supabase sans run step dedupe_decision=merged_existing.");
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    blockers.push(`Probe de fusion Supabase impossible: ${error}`);
  }

  const cleanup = await cleanupProbeRows(client, domain, traceIds, runIds);
  if (cleanup.error) {
    blockers.push(`Nettoyage du probe Supabase incomplet: ${cleanup.error}`);
  }
  if (cleanup.remainingCompanies > 0 || cleanup.remainingRuns > 0) {
    blockers.push(
      `Nettoyage du probe Supabase incomplet: ${cleanup.remainingCompanies} companies, ${cleanup.remainingRuns} runs restants.`
    );
  }

  return {
    verified: blockers.length === 0,
    domain,
    traceIds,
    runIds,
    companyCount,
    retainedMode,
    mergedRunStepCount,
    cleanupRemainingCompanies: cleanup.remainingCompanies,
    cleanupRemainingRuns: cleanup.remainingRuns,
    blockers,
    ...(error ? { error } : {}),
    ...(cleanup.error ? { cleanupError: cleanup.error } : {})
  };
}

export async function verifySupabaseComplianceGates(client: SupabaseClient): Promise<SupabaseComplianceGateProbe> {
  const suffix = randomUUID().slice(0, 8);
  const domain = `bm-scout-compliance-${suffix}.invalid`;
  const blockers: string[] = [];
  const errors: string[] = [];
  let companyId: string | null = null;
  let contactId: string | null = null;
  let emailHash: string | null = null;
  let noApprovedMessageConstraint = false;
  let dncUniqueCompany = false;
  let dncUniqueDomain = false;
  let dncUniqueContact = false;
  let dncUniqueEmailHash = false;

  try {
    companyId = await insertComplianceCompany(client, domain);
    const contact = await insertComplianceContact(client, companyId, domain);
    contactId = contact.id;
    emailHash = contact.emailHash;

    noApprovedMessageConstraint = await assertApprovedMessageBlocked(client, companyId, blockers, errors);
    dncUniqueCompany = await assertDuplicateDncBlocked(
      client,
      "company",
      { scope: "company", company_id: companyId, source: "manual", reason: "Probe unicité DNC company." },
      blockers,
      errors
    );
    dncUniqueDomain = await assertDuplicateDncBlocked(
      client,
      "domain",
      { scope: "domain", normalized_domain: domain, company_id: companyId, source: "manual", reason: "Probe unicité DNC domain." },
      blockers,
      errors
    );
    dncUniqueContact = await assertDuplicateDncBlocked(
      client,
      "contact",
      { scope: "contact", contact_id: contactId, company_id: companyId, source: "manual", reason: "Probe unicité DNC contact." },
      blockers,
      errors
    );
    if (!emailHash) {
      blockers.push("Probe unicité DNC email_hash impossible: email_hash contact absent.");
    } else {
      dncUniqueEmailHash = await assertDuplicateDncBlocked(
        client,
        "email_hash",
        {
          scope: "contact",
          normalized_email_hash: emailHash,
          company_id: companyId,
          source: "manual",
          reason: "Probe unicité DNC email hash."
        },
        blockers,
        errors
      );
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    errors.push(message);
    blockers.push(`Probe conformité Supabase impossible: ${message}`);
  }

  const cleanup = await cleanupComplianceProbeRows(client, {
    domain,
    companyId,
    contactId,
    emailHash
  });
  if (cleanup.error) blockers.push(`Nettoyage du probe conformité incomplet: ${cleanup.error}`);
  if (
    cleanup.remainingCompanies > 0 ||
    cleanup.remainingContacts > 0 ||
    cleanup.remainingDncRows > 0 ||
    cleanup.remainingMessages > 0
  ) {
    blockers.push(
      `Nettoyage du probe conformité incomplet: ${cleanup.remainingCompanies} companies, ${cleanup.remainingContacts} contacts, ${cleanup.remainingDncRows} DNC, ${cleanup.remainingMessages} messages restants.`
    );
  }

  const verified =
    blockers.length === 0 &&
    noApprovedMessageConstraint &&
    dncUniqueCompany &&
    dncUniqueDomain &&
    dncUniqueContact &&
    dncUniqueEmailHash;

  return {
    verified,
    domain,
    noApprovedMessageConstraint,
    dncUniqueCompany,
    dncUniqueDomain,
    dncUniqueContact,
    dncUniqueEmailHash,
    cleanupRemainingCompanies: cleanup.remainingCompanies,
    cleanupRemainingContacts: cleanup.remainingContacts,
    cleanupRemainingDncRows: cleanup.remainingDncRows,
    cleanupRemainingMessages: cleanup.remainingMessages,
    blockers,
    errors,
    ...(cleanup.error ? { cleanupError: cleanup.error } : {})
  };
}

async function persistProbeRun(
  client: SupabaseClient,
  mode: ScoutMode,
  domain: string,
  traceId: string,
  suffix: string
): Promise<string> {
  const { data, error } = await client.rpc("scout_persist_mission_output", {
    payload: buildProbePayload(mode, domain, traceId, suffix)
  });
  if (error) throw new Error(`RPC scout_persist_mission_output ${mode} échouée: ${error.message}`);
  if (typeof data !== "string" || !data.trim()) throw new Error(`RPC scout_persist_mission_output ${mode} sans run id.`);
  return data;
}

function buildProbePayload(mode: ScoutMode, domain: string, traceId: string, suffix: string): Record<string, unknown> {
  const isCore = mode === "core";
  const evidenceId = `evidence-${mode}-${suffix}`;
  const companyName = isCore ? "BM Scout Dedupe Probe Core" : "BM Scout Dedupe Probe Exploration";
  const signal = isCore
    ? "Probe temporaire Core avec domaine partagé pour vérifier la fusion Supabase."
    : "Probe temporaire Exploration avec le même domaine pour vérifier la fusion Supabase.";

  return {
    mode,
    trace_id: traceId,
    scanned_count: 1,
    kept_count: 1,
    rejected_count: 0,
    final_decision: "ready",
    leads: [
      {
        id: `bm-scout-dedupe-${mode}-${suffix}`,
        company: companyName,
        website: `https://${domain}/`,
        mode,
        segment: isCore ? "DAF externalisée" : "opportunité hors coeur",
        score: isCore ? 84 : 71,
        verdict: "validate",
        quality_decision: "pass",
        observed_signals: [signal],
        pain_hypotheses: ["Possible besoin de visibilité pipeline et de relances structurées."],
        insights: {
          observed: [
            {
              text: signal,
              evidence_id: evidenceId
            }
          ],
          inferred: ["Consolidation opérationnelle probablement utile si le volume de dossiers augmente."],
          uncertain: ["Décideur exact non confirmé ; email uniquement générique de probe."]
        },
        score_justification: "Score de probe élevé uniquement pour vérifier la persistance et la fusion domaine.",
        short_card: "Probe Supabase temporaire pour vérifier la fusion des comptes par domaine.",
        deep_card: "Fiche temporaire créée par verify:supabase. Elle doit être supprimée à la fin du probe.",
        personas: [
          {
            name: "Contact Probe",
            role: "Responsable administratif",
            email: `contact@${domain}`,
            email_type: "generic",
            email_source_url: `https://${domain}/contact`,
            email_confidence: "medium",
            email_status: "verify",
            reason: "Contact générique de probe, non destiné à la prospection.",
            contact_confidence: "role_only",
            do_not_contact: false
          }
        ],
        evidence: [
          {
            id: evidenceId,
            label: "Probe verify:supabase",
            url: `https://${domain}/probe`,
            observed_fact: signal,
            reliability: "high"
          }
        ],
        outreach: {
          cold_email: "Bonjour, probe technique Supabase : ne pas envoyer.",
          follow_up: "Relance probe technique Supabase : ne pas envoyer.",
          linkedin: "Message probe technique Supabase : ne pas envoyer."
        },
        quality_gates: [
          {
            code: "probe_evidence",
            passed: true,
            reason: "Preuve temporaire suffisante pour tester la persistance."
          }
        ],
        next_action: "Supprimer automatiquement après vérification."
      }
    ],
    rejected: [],
    lessons: [],
    run_steps: [
      {
        agent_name: "verify_supabase_runtime",
        step: "persistence_dedupe_probe",
        event_type: "tool_call",
        payload: {
          domain,
          mode,
          trace_id: traceId
        }
      }
    ]
  };
}

async function insertComplianceCompany(client: SupabaseClient, domain: string): Promise<string> {
  const { data, error } = await client
    .from("scout_companies")
    .insert({
      name: "BM Scout Compliance Probe",
      website: `https://${domain}/`,
      mode: "core",
      segment: "probe conformité",
      score: 50,
      verdict: "watch",
      quality_decision: "needs_enrichment",
      observed_signals: [],
      pain_hypotheses: [],
      score_justification: "Probe temporaire verify:supabase.",
      next_action: "Supprimer automatiquement après vérification."
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Insertion company probe conformité impossible: ${error.message}`);
  if (!isRecord(data) || typeof data.id !== "string") throw new Error("Insertion company probe conformité sans id.");
  return data.id;
}

async function insertComplianceContact(
  client: SupabaseClient,
  companyId: string,
  domain: string
): Promise<{ id: string; emailHash: string | null }> {
  const { data, error } = await client
    .from("scout_contacts")
    .insert({
      company_id: companyId,
      name: "Contact Compliance Probe",
      role: "Responsable conformité",
      email: `probe@${domain}`,
      reason: "Probe temporaire verify:supabase.",
      confidence: "role_only"
    })
    .select("id,email_hash")
    .maybeSingle();
  if (error) throw new Error(`Insertion contact probe conformité impossible: ${error.message}`);
  if (!isRecord(data) || typeof data.id !== "string") throw new Error("Insertion contact probe conformité sans id.");
  return { id: data.id, emailHash: typeof data.email_hash === "string" ? data.email_hash : null };
}

async function assertApprovedMessageBlocked(
  client: SupabaseClient,
  companyId: string,
  blockers: string[],
  errors: string[]
): Promise<boolean> {
  const { data, error } = await client
    .from("scout_messages")
    .insert({
      company_id: companyId,
      channel: "email",
      body: "Probe verify:supabase : ce message approved doit être refusé.",
      status: "approved"
    })
    .select("id")
    .maybeSingle();

  if (error) return true;

  errors.push("Insertion status approved acceptée.");
  blockers.push("Garde-fou no-auto-send absent: scout_messages accepte encore status=approved.");
  const insertedId = isRecord(data) && typeof data.id === "string" ? data.id : null;
  if (insertedId) {
    await throwOnDeleteError(client.from("scout_messages").delete().eq("id", insertedId), "message approved probe");
  }
  return false;
}

async function assertDuplicateDncBlocked(
  client: SupabaseClient,
  label: string,
  record: ComplianceDncInsert,
  blockers: string[],
  errors: string[]
): Promise<boolean> {
  const { data: first, error: firstError } = await client.from("scout_do_not_contact").insert(record).select("id").maybeSingle();
  if (firstError) {
    const message = `Insertion DNC initiale ${label} impossible: ${firstError.message}`;
    errors.push(message);
    blockers.push(message);
    return false;
  }

  const { data: second, error: secondError } = await client.from("scout_do_not_contact").insert(record).select("id").maybeSingle();
  if (secondError) return true;

  errors.push(`Doublon DNC ${label} accepté.`);
  blockers.push(`Garde-fou DNC absent: doublon ${label} accepté par scout_do_not_contact.`);
  const insertedIds = [first, second].flatMap((row) => (isRecord(row) && typeof row.id === "string" ? [row.id] : []));
  if (insertedIds.length) {
    await throwOnDeleteError(client.from("scout_do_not_contact").delete().in("id", insertedIds), `DNC duplicate ${label}`);
  }
  return false;
}

async function loadProbeCompanies(client: SupabaseClient, domain: string): Promise<Array<{ id: string; mode: string | null }>> {
  const { data, error } = await client.from("scout_companies").select("id,mode").eq("domain", domain);
  if (error) throw new Error(`Lecture companies probe impossible: ${error.message}`);
  return (data ?? []).flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    return [{ id: row.id, mode: typeof row.mode === "string" ? row.mode : null }];
  });
}

async function countMergedRunSteps(client: SupabaseClient, runIds: string[], domain: string): Promise<number> {
  if (!runIds.length) return 0;
  const { data, error } = await client
    .from("scout_run_steps")
    .select("payload")
    .in("run_id", runIds)
    .eq("step", "lead_persisted");
  if (error) throw new Error(`Lecture run steps probe impossible: ${error.message}`);
  return (data ?? []).filter((row) => {
    if (!isRecord(row) || !isRecord(row.payload)) return false;
    return row.payload.dedupe_domain === domain && row.payload.dedupe_decision === "merged_existing";
  }).length;
}

async function cleanupComplianceProbeRows(
  client: SupabaseClient,
  probe: { domain: string; companyId: string | null; contactId: string | null; emailHash: string | null }
): Promise<ComplianceCleanupResult> {
  try {
    await deleteComplianceRows(client, probe);
    return {
      remainingCompanies: await countRowsByDomain(client, probe.domain),
      remainingContacts: await countContactsByProbe(client, probe),
      remainingDncRows: await countDncByProbe(client, probe),
      remainingMessages: await countMessagesByProbe(client, probe)
    };
  } catch (caught) {
    return {
      remainingCompanies: await safeCountRowsByDomain(client, probe.domain),
      remainingContacts: await safeCountContactsByProbe(client, probe),
      remainingDncRows: await safeCountDncByProbe(client, probe),
      remainingMessages: await safeCountMessagesByProbe(client, probe),
      error: caught instanceof Error ? caught.message : String(caught)
    };
  }
}

async function deleteComplianceRows(
  client: SupabaseClient,
  probe: { domain: string; companyId: string | null; contactId: string | null; emailHash: string | null }
): Promise<void> {
  if (probe.companyId) await throwOnDeleteError(client.from("scout_messages").delete().eq("company_id", probe.companyId), "messages probe conformité");
  await throwOnDeleteError(client.from("scout_do_not_contact").delete().eq("normalized_domain", probe.domain), "DNC domaine probe conformité");
  if (probe.companyId) await throwOnDeleteError(client.from("scout_do_not_contact").delete().eq("company_id", probe.companyId), "DNC company probe conformité");
  if (probe.contactId) await throwOnDeleteError(client.from("scout_do_not_contact").delete().eq("contact_id", probe.contactId), "DNC contact probe conformité");
  if (probe.emailHash) await throwOnDeleteError(client.from("scout_do_not_contact").delete().eq("normalized_email_hash", probe.emailHash), "DNC email probe conformité");
  if (probe.contactId) await throwOnDeleteError(client.from("scout_contacts").delete().eq("id", probe.contactId), "contact probe conformité");
  await throwOnDeleteError(client.from("scout_companies").delete().eq("domain", probe.domain), "company probe conformité");
}

async function cleanupProbeRows(client: SupabaseClient, domain: string, traceIds: string[], runIds: string[]): Promise<CleanupResult> {
  try {
    const discoveredRunIds = await loadRunIdsByTrace(client, traceIds);
    const allRunIds = Array.from(new Set([...runIds, ...discoveredRunIds].filter(Boolean)));

    if (allRunIds.length) {
      await throwOnDeleteError(client.from("scout_learning_lessons").delete().in("source_run_id", allRunIds), "learning lessons probe");
    }
    await throwOnDeleteError(client.from("scout_companies").delete().eq("domain", domain), "companies probe");
    if (allRunIds.length) {
      await throwOnDeleteError(client.from("scout_runs").delete().in("id", allRunIds), "runs probe");
    }

    return {
      remainingCompanies: await countRowsByDomain(client, domain),
      remainingRuns: await countRunsByTrace(client, traceIds)
    };
  } catch (caught) {
    return {
      remainingCompanies: await safeCountRowsByDomain(client, domain),
      remainingRuns: await safeCountRunsByTrace(client, traceIds),
      error: caught instanceof Error ? caught.message : String(caught)
    };
  }
}

async function loadRunIdsByTrace(client: SupabaseClient, traceIds: string[]): Promise<string[]> {
  if (!traceIds.length) return [];
  const { data, error } = await client.from("scout_runs").select("id").in("trace_id", traceIds);
  if (error) throw new Error(`Lecture runs probe impossible: ${error.message}`);
  return (data ?? []).flatMap((row) => (isRecord(row) && typeof row.id === "string" ? [row.id] : []));
}

async function throwOnDeleteError<T extends { error: { message: string } | null }>(promise: PromiseLike<T>, label: string): Promise<void> {
  const { error } = await promise;
  if (error) throw new Error(`Suppression ${label} impossible: ${error.message}`);
}

async function countRowsByDomain(client: SupabaseClient, domain: string): Promise<number> {
  const { count, error } = await client.from("scout_companies").select("*", { count: "exact", head: true }).eq("domain", domain);
  if (error) throw new Error(`Comptage companies probe impossible: ${error.message}`);
  return count ?? 0;
}

async function countRunsByTrace(client: SupabaseClient, traceIds: string[]): Promise<number> {
  if (!traceIds.length) return 0;
  const { count, error } = await client.from("scout_runs").select("*", { count: "exact", head: true }).in("trace_id", traceIds);
  if (error) throw new Error(`Comptage runs probe impossible: ${error.message}`);
  return count ?? 0;
}

async function countContactsByProbe(
  client: SupabaseClient,
  probe: { companyId: string | null; contactId: string | null; emailHash: string | null }
): Promise<number> {
  if (probe.contactId) {
    const { count, error } = await client.from("scout_contacts").select("*", { count: "exact", head: true }).eq("id", probe.contactId);
    if (error) throw new Error(`Comptage contact probe conformité impossible: ${error.message}`);
    return count ?? 0;
  }
  if (probe.companyId) {
    const { count, error } = await client.from("scout_contacts").select("*", { count: "exact", head: true }).eq("company_id", probe.companyId);
    if (error) throw new Error(`Comptage contacts probe conformité impossible: ${error.message}`);
    return count ?? 0;
  }
  return 0;
}

async function countDncByProbe(
  client: SupabaseClient,
  probe: { domain: string; companyId: string | null; contactId: string | null; emailHash: string | null }
): Promise<number> {
  const filters = [
    `normalized_domain.eq.${probe.domain}`,
    probe.companyId ? `company_id.eq.${probe.companyId}` : null,
    probe.contactId ? `contact_id.eq.${probe.contactId}` : null,
    probe.emailHash ? `normalized_email_hash.eq.${probe.emailHash}` : null
  ].filter((filter): filter is string => Boolean(filter));
  if (!filters.length) return 0;
  const { count, error } = await client.from("scout_do_not_contact").select("*", { count: "exact", head: true }).or(filters.join(","));
  if (error) throw new Error(`Comptage DNC probe conformité impossible: ${error.message}`);
  return count ?? 0;
}

async function countMessagesByProbe(client: SupabaseClient, probe: { companyId: string | null }): Promise<number> {
  if (!probe.companyId) return 0;
  const { count, error } = await client.from("scout_messages").select("*", { count: "exact", head: true }).eq("company_id", probe.companyId);
  if (error) throw new Error(`Comptage messages probe conformité impossible: ${error.message}`);
  return count ?? 0;
}

async function safeCountRowsByDomain(client: SupabaseClient, domain: string): Promise<number> {
  try {
    return await countRowsByDomain(client, domain);
  } catch {
    return -1;
  }
}

async function safeCountRunsByTrace(client: SupabaseClient, traceIds: string[]): Promise<number> {
  try {
    return await countRunsByTrace(client, traceIds);
  } catch {
    return -1;
  }
}

async function safeCountContactsByProbe(
  client: SupabaseClient,
  probe: { companyId: string | null; contactId: string | null; emailHash: string | null }
): Promise<number> {
  try {
    return await countContactsByProbe(client, probe);
  } catch {
    return -1;
  }
}

async function safeCountDncByProbe(
  client: SupabaseClient,
  probe: { domain: string; companyId: string | null; contactId: string | null; emailHash: string | null }
): Promise<number> {
  try {
    return await countDncByProbe(client, probe);
  } catch {
    return -1;
  }
}

async function safeCountMessagesByProbe(client: SupabaseClient, probe: { companyId: string | null }): Promise<number> {
  try {
    return await countMessagesByProbe(client, probe);
  } catch {
    return -1;
  }
}

type ComplianceDncInsert = {
  scope: "company" | "domain" | "contact";
  company_id?: string;
  contact_id?: string;
  normalized_domain?: string;
  normalized_email_hash?: string;
  source: "manual";
  reason: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
