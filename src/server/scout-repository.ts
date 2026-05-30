import { createClient } from "@supabase/supabase-js";
import { demoSnapshot } from "@/domain/scout-engine";
import type { Evidence, LearningLesson, Persona, QualityGate, ScoutLead, ScoutRun, ScoutSnapshot } from "@/domain/types";

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
        score_justification,
        next_action,
        rejection_reason,
        scout_contacts (name, role, reason, confidence, do_not_contact),
        scout_evidence (label, url, observed_fact, reliability),
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
  if (!runs?.length) return demoSnapshot();
  return buildSnapshotFromRows(runs as ScoutRunRow[]);
}

function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function buildSnapshotFromRows(rows: ScoutRunRow[]): ScoutSnapshot {
  const runs = rows.map(mapRun);
  const allLeads = runs.flatMap((run) => run.leads);
  const rejected = runs.flatMap((run) => run.rejected);
  const ordered = [...allLeads].sort((a, b) => b.score - a.score);
  const lessons = rows.flatMap((row) => row.scout_learning_lessons ?? []).map(mapLesson).slice(0, 4);
  return {
    primaryLead: ordered[0] ?? null,
    queue: ordered.slice(1, 5),
    exploration: allLeads.filter((lead) => lead.mode === "exploration").slice(0, 4),
    rejected,
    lessons,
    runs
  };
}

function mapRun(row: ScoutRunRow): ScoutRun {
  const companies = row.scout_companies ?? [];
  const leads = companies.map(mapLead).filter((lead) => lead.verdict !== "reject" && lead.qualityDecision !== "blocked");
  const rejected = companies.map(mapLead).filter((lead) => lead.verdict === "reject" || lead.qualityDecision === "blocked");
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

function mapLead(row: ScoutCompanyRow): ScoutLead {
  const messages = row.scout_messages ?? [];
  const brief = [...(row.scout_briefs ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const quality = row.scout_quality_reports?.[0];
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
    personas: (row.scout_contacts ?? []).map(mapPersona),
    evidence: (row.scout_evidence ?? []).map(mapEvidence),
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
    doNotContact: row.do_not_contact
  };
}

function mapEvidence(row: ScoutEvidenceRow): Evidence {
  return {
    label: row.label,
    url: row.url,
    observedFact: row.observed_fact,
    reliability: row.reliability
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
  reason: string;
  confidence: "confirmed" | "role_only" | "uncertain";
  do_not_contact: boolean;
}

interface ScoutEvidenceRow {
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
