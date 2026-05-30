import { coreCandidates, explorationCandidates, weakCandidates } from "./fixtures";
import { buildLearning, evaluateLead } from "./quality";
import type { FeedbackEvent, ScoutMode, ScoutRun, ScoutSnapshot } from "./types";

export function runScoutMission(mode: ScoutMode, options: { includeWeak?: boolean; feedbacks?: FeedbackEvent[] } = {}): ScoutRun {
  const base = mode === "core" ? coreCandidates : explorationCandidates;
  const candidates = options.includeWeak ? [...base, ...weakCandidates] : base;
  const evaluated = candidates.map(evaluateLead);
  const leads = evaluated.filter((lead) => lead.verdict !== "reject" && lead.qualityDecision !== "blocked");
  const rejected = evaluated.filter((lead) => lead.verdict === "reject" || lead.qualityDecision === "blocked");
  return {
    id: `run-${mode}-${Date.now()}`,
    mode,
    status: "succeeded",
    createdAt: new Date().toISOString(),
    traceId: `trace_bm_scout_${mode}_${Math.random().toString(16).slice(2)}`,
    scannedCount: mode === "core" ? 6 : 12,
    keptCount: leads.length,
    rejectedCount: rejected.length,
    leads,
    rejected,
    lessons: buildLearning(options.feedbacks ?? [], evaluated)
  };
}

export function buildSnapshot(runs: ScoutRun[], feedbacks: FeedbackEvent[] = []): ScoutSnapshot {
  const allLeads = runs.flatMap((run) => run.leads);
  const rejected = runs.flatMap((run) => run.rejected);
  const ordered = [...allLeads].sort((a, b) => b.score - a.score);
  return {
    primaryLead: ordered[0] ?? null,
    queue: ordered.slice(1, 5),
    exploration: allLeads.filter((lead) => lead.mode === "exploration").slice(0, 4),
    rejected,
    lessons: buildLearning(feedbacks, [...allLeads, ...rejected]).slice(0, 4),
    runs
  };
}

export function seedFeedbacks(): FeedbackEvent[] {
  const now = new Date().toISOString();
  return [
    { id: "fb-good-lead", leadId: "core-cambon", kind: "good_lead", note: "Très bon lead, proche M&A.", createdAt: now },
    { id: "fb-bad-lead", leadId: "weak-studio-yoga", kind: "bad_lead", note: "Hors ICP.", createdAt: now },
    { id: "fb-generic", leadId: "weak-studio-yoga", kind: "generic_message", note: "Message trop générique.", createdAt: now },
    { id: "fb-angle", leadId: "core-cambon", kind: "good_angle", note: "Angle deal-by-deal utile.", createdAt: now },
    { id: "fb-outcome", leadId: "core-cambon", kind: "positive_outcome", note: "Réponse positive simulée.", createdAt: now },
    { id: "fb-dnc", leadId: "core-eight-advisory", kind: "do_not_contact", note: "Contact à bloquer.", createdAt: now }
  ];
}

export function demoSnapshot(): ScoutSnapshot {
  const feedbacks = seedFeedbacks();
  return buildSnapshot(
    [
      runScoutMission("core", { feedbacks }),
      runScoutMission("exploration", { feedbacks })
    ],
    feedbacks
  );
}
