import { demoSnapshot } from "../domain/scout-engine";
import { buildBriefSummary, buildTasksFromRuns } from "../domain/scheduler";
import type { AgentTask, Evidence, LearningLesson, Persona, QualityGate, ScoutLead, ScoutRun, ScoutSnapshot, StructuredInsights } from "../domain/types";
import { createServerSupabaseClient } from "./supabase";

export async function getScoutSnapshot(): Promise<ScoutSnapshot> {
  const client = createServerSupabaseClient();
  if (!client) return demoSnapshot();

  const { data: runs, error } = await client
    .from("scout_runs")
    .select(
      `
      id,
      mode,
      status,
      trace_id,
      scanned_count,
      kept_count,
      rejected_count,
      created_at,
      scout_companies (
        id,
        external_id,
        name,
        website,
        mode,
        segment,
        score,
        verdict,
        quality_decision,
        observed_signals,
        pain_hypotheses,
        structured_insights,
        score_justification,
        next_action,
        rejection_reason,
        scout_contacts (name, role, email, email_type, email_source_url, email_confidence, email_status, reason, confidence, do_not_contact),
        scout_evidence (id, label, url, observed_fact, reliability),
        scout_briefs (short_card, deep_card, created_at),
        scout_messages (channel, body, status),
        scout_quality_reports (decision, gates, reason, blocker_code)
      ),
      scout_learning_lessons (id, lesson, recommendation, source, confidence)
    `
    )
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(3);

  if (error) {
    throw new Error(`Lecture Supabase BM Scout impossible: ${error.message}`);
  }

  const tasks = await loadTaskRows(client);

  return buildSnapshotFromRows((runs ?? []) as ScoutRunRow[], tasks);
}

type SupabaseServerClient = NonNullable<ReturnType<typeof createServerSupabaseClient>>;

async function loadTaskRows(client: SupabaseServerClient): Promise<ScoutTaskRow[]> {
  const { data: tasks, error: taskError } = await client
    .from("scout_agent_tasks")
    .select(
      "id,type,status,title,summary,recommendation,payload,scheduled_for,started_at,completed_at,result_run_id,blocked_reason,error_message,created_at"
    )
    .order("scheduled_for", { ascending: false })
    .limit(8);

  if (taskError && taskError.code !== "PGRST205") {
    throw new Error(`Lecture des tâches BM Scout impossible: ${taskError.message}`);
  }

  return (tasks ?? []) as ScoutTaskRow[];
}

function buildSnapshotFromRows(rows: ScoutRunRow[], taskRows: ScoutTaskRow[] = []): ScoutSnapshot {
  const runs = rows.map(mapRun);
  const allLeads = runs.flatMap((run) => run.leads);
  const rejected = runs.flatMap((run) => run.rejected);
  const ordered = [...allLeads].sort((a, b) => b.score - a.score);
  const lessons = rows.flatMap((row) => row.scout_learning_lessons ?? []).map(mapLesson).slice(0, 4);
  const tasks = taskRows.length ? taskRows.map(mapTask) : buildTasksFromRuns(runs);
  return {
    primaryLead: ordered[0] ?? null,
    queue: ordered.slice(1, 5),
    exploration: allLeads.filter((lead) => lead.mode === "exploration").slice(0, 4),
    rejected,
    lessons,
    runs,
    tasks,
    brief: buildBriefSummary(tasks, runs),
    readiness: "production_not_ready"
  };
}

function mapRun(row: ScoutRunRow): ScoutRun {
  const companies = row.scout_companies ?? [];
  const mappedCompanies = companies.map(mapLead);
  const leads = mappedCompanies.filter((lead) => !isRejectedLead(lead));
  const rejected = mappedCompanies.filter(isRejectedLead);
  return {
    id: row.id,
    mode: row.mode,
    status: row.status === "failed" ? "failed" : "succeeded",
    createdAt: row.created_at,
    traceId: row.trace_id ?? row.id,
    scannedCount: row.scanned_count,
    keptCount: row.kept_count,
    rejectedCount: row.rejected_count,
    leads,
    rejected,
    lessons: (row.scout_learning_lessons ?? []).map(mapLesson)
  };
}

function isRejectedLead(lead: ScoutLead): boolean {
  return lead.verdict === "reject" || lead.qualityDecision === "blocked" || Boolean(lead.rejectionReason);
}

function mapLead(row: ScoutCompanyRow): ScoutLead {
  const messages = row.scout_messages ?? [];
  const brief = [...(row.scout_briefs ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const quality = row.scout_quality_reports?.[0];
  const personas = (row.scout_contacts ?? []).map(mapPersona);
  return {
    id: row.external_id ?? row.id,
    company: row.name,
    website: row.website ?? "",
    mode: row.mode,
    segment: row.segment,
    score: row.score ?? 0,
    verdict: row.verdict,
    qualityDecision: row.quality_decision,
    observedSignals: row.observed_signals ?? [],
    painHypotheses: row.pain_hypotheses ?? [],
    scoreJustification: row.score_justification ?? "Score non renseigné.",
    shortCard: brief?.short_card ?? "Fiche courte non générée.",
    deepCard: brief?.deep_card ?? "Fiche profonde non générée.",
    personas,
    evidence: (row.scout_evidence ?? []).map(mapEvidence),
    insights: mapStructuredInsights(row.structured_insights),
    outreach: {
      coldEmail: messages.find((message) => message.channel === "email")?.body ?? "Brouillon bloqué : message absent.",
      followUp: messages.find((message) => message.channel === "follow_up")?.body ?? "Brouillon bloqué : relance absente.",
      linkedin: messages.find((message) => message.channel === "linkedin")?.body ?? "Brouillon bloqué : LinkedIn absent."
    },
    qualityGates: mapQualityGates(quality),
    nextAction: row.next_action ?? quality?.reason ?? "Décision Romu requise.",
    rejectionReason: row.rejection_reason ?? undefined
  };
}

function mapPersona(row: ScoutContactRow): Persona {
  return {
    name: row.name ?? undefined,
    role: row.role,
    reason: row.reason,
    contactConfidence: row.confidence,
    doNotContact: row.do_not_contact,
    email: row.email ?? undefined,
    emailType: row.email_type,
    emailSourceUrl: row.email_source_url ?? undefined,
    emailConfidence: row.email_confidence,
    emailStatus: row.email_status
  };
}

function mapEvidence(row: ScoutEvidenceRow): Evidence {
  return {
    id: row.id,
    label: row.label,
    url: row.url,
    observedFact: row.observed_fact,
    reliability: row.reliability
  };
}

function mapTask(row: ScoutTaskRow): AgentTask {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    title: row.title,
    summary: row.summary,
    recommendation: row.recommendation,
    payload: {
      coreWeeklyTarget: Number(row.payload?.coreWeeklyTarget ?? 15),
      explorationScanTarget: Number(row.payload?.explorationScanTarget ?? 100),
      explorationShortlistTarget: Number(row.payload?.explorationShortlistTarget ?? 12)
    },
    createdAt: row.created_at,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    resultRunId: row.result_run_id ?? undefined,
    blockedReason: row.blocked_reason ?? undefined,
    errorMessage: row.error_message ?? undefined
  };
}

function mapLesson(row: ScoutLessonRow): LearningLesson {
  return {
    id: row.id,
    lesson: row.lesson,
    recommendation: row.recommendation,
    source: row.source,
    confidence: Number(row.confidence)
  };
}

function mapQualityGates(row?: ScoutQualityRow): QualityGate[] {
  if (!row?.gates || !Array.isArray(row.gates)) {
    return row ? [{ code: row.blocker_code ?? "qc", passed: row.decision !== "blocked", reason: row.reason }] : [];
  }
  return row.gates.flatMap((gate) => (isQualityGate(gate) ? [gate] : []));
}

function mapStructuredInsights(value: Json | undefined): StructuredInsights | undefined {
  if (!isJsonObject(value)) return undefined;
  const observed = Array.isArray(value.observed)
    ? value.observed.flatMap((item) => {
        if (!isJsonObject(item) || typeof item.text !== "string") return [];
        const evidenceId = typeof item.evidenceId === "string" ? item.evidenceId : typeof item.evidence_id === "string" ? item.evidence_id : "";
        return evidenceId ? [{ text: item.text, evidenceId }] : [];
      })
    : [];
  const inferred = Array.isArray(value.inferred) ? value.inferred.filter((item): item is string => typeof item === "string") : [];
  const uncertain = Array.isArray(value.uncertain) ? value.uncertain.filter((item): item is string => typeof item === "string") : [];
  return { observed, inferred, uncertain };
}

function isQualityGate(value: unknown): value is QualityGate {
  return Boolean(
    value &&
      typeof value === "object" &&
      "code" in value &&
      "passed" in value &&
      "reason" in value
  );
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function isJsonObject(value: Json | undefined): value is { [key: string]: Json } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

interface ScoutRunRow {
  id: string;
  mode: "core" | "exploration";
  status: string;
  trace_id: string | null;
  scanned_count: number;
  kept_count: number;
  rejected_count: number;
  created_at: string;
  scout_companies?: ScoutCompanyRow[];
  scout_learning_lessons?: ScoutLessonRow[];
}

interface ScoutCompanyRow {
  id: string;
  external_id: string | null;
  name: string;
  website: string | null;
  mode: "core" | "exploration";
  segment: string;
  score: number | null;
  verdict: "validate" | "enrich" | "watch" | "reject";
  quality_decision: "pass" | "needs_enrichment" | "blocked";
  observed_signals: string[] | null;
  pain_hypotheses: string[] | null;
  structured_insights: Json;
  score_justification: string | null;
  next_action: string | null;
  rejection_reason: string | null;
  scout_contacts?: ScoutContactRow[];
  scout_evidence?: ScoutEvidenceRow[];
  scout_briefs?: ScoutBriefRow[];
  scout_messages?: ScoutMessageRow[];
  scout_quality_reports?: ScoutQualityRow[];
}

interface ScoutContactRow {
  name: string | null;
  role: string;
  email: string | null;
  email_type: "public_named" | "generic" | "probable_pattern" | "unknown";
  email_source_url: string | null;
  email_confidence: "high" | "medium" | "low";
  email_status: "usable" | "verify" | "not_usable";
  reason: string;
  confidence: "confirmed" | "role_only" | "uncertain";
  do_not_contact: boolean;
}

interface ScoutEvidenceRow {
  id: string;
  label: string;
  url: string;
  observed_fact: string;
  reliability: "high" | "medium" | "low";
}

interface ScoutBriefRow {
  short_card: string;
  deep_card: string;
  created_at: string;
}

interface ScoutMessageRow {
  channel: "email" | "follow_up" | "linkedin";
  body: string;
  status: string;
}

interface ScoutQualityRow {
  decision: "pass" | "needs_enrichment" | "blocked";
  gates: Json;
  reason: string;
  blocker_code: string | null;
}

interface ScoutLessonRow {
  id: string;
  lesson: string;
  recommendation: string;
  source: string;
  confidence: string | number;
}

interface ScoutTaskRow {
  id: string;
  type: AgentTask["type"];
  status: AgentTask["status"];
  title: string;
  summary: string;
  recommendation: string;
  payload: Partial<AgentTask["payload"]> | null;
  scheduled_for: string;
  started_at: string | null;
  completed_at: string | null;
  result_run_id: string | null;
  blocked_reason: string | null;
  error_message: string | null;
  created_at: string;
}
