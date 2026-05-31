import { describe, expect, it, vi } from "vitest";
import { getScoutSnapshot } from "./scout-repository";

const { state } = vi.hoisted(() => ({
  state: {
    clientEnabled: true,
    runs: [] as unknown[],
    tasks: [] as unknown[]
  }
}));

vi.mock("./supabase", () => ({
  createServerSupabaseClient: () => (state.clientEnabled ? { from: (table: string) => fakeTable(table) } : null)
}));

describe("scout repository", () => {
  it("utilise les fixtures uniquement quand Supabase serveur n'est pas configuré", async () => {
    state.clientEnabled = false;
    state.runs = [];
    state.tasks = [];

    const snapshot = await getScoutSnapshot();

    expect(snapshot.primaryLead?.company).toBe("Cambon Partners");
    expect(snapshot.runs.length).toBeGreaterThan(0);
  });

  it("ne retombe pas sur les fixtures quand Supabase est configuré mais vide", async () => {
    state.clientEnabled = true;
    state.runs = [];
    state.tasks = [];

    const snapshot = await getScoutSnapshot();

    expect(snapshot.primaryLead).toBeNull();
    expect(snapshot.queue).toEqual([]);
    expect(snapshot.exploration).toEqual([]);
    expect(snapshot.runs).toEqual([]);
    expect(snapshot.brief.completed[0]).toContain("Aucun run persistant");
    expect(snapshot.tasks.some((task) => task.type === "weekly_core_research")).toBe(true);
  });

  it("affiche les tâches Supabase même avant le premier run persistant", async () => {
    state.clientEnabled = true;
    state.runs = [];
    state.tasks = [
      {
        id: "task-dnc",
        type: "dnc_check",
        status: "queued",
        title: "Contrôle do-not-contact",
        summary: "Contrôle DNC en file.",
        recommendation: "Bloquer avant message.",
        payload: { coreWeeklyTarget: 15, explorationScanTarget: 100, explorationShortlistTarget: 12 },
        scheduled_for: "2026-06-01T10:15:00.000Z",
        started_at: null,
        completed_at: null,
        result_run_id: null,
        blocked_reason: null,
        error_message: null,
        created_at: "2026-06-01T06:00:00.000Z"
      }
    ];

    const snapshot = await getScoutSnapshot();

    expect(snapshot.runs).toEqual([]);
    expect(snapshot.primaryLead).toBeNull();
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0]).toMatchObject({ id: "task-dnc", type: "dnc_check", status: "queued" });
  });

  it("classe une entreprise avec rejection_reason comme exclusion QC visible", async () => {
    state.clientEnabled = true;
    state.tasks = [];
    state.runs = [
      {
        id: "run-exploration",
        mode: "exploration",
        status: "succeeded",
        trace_id: "trace-exploration",
        scanned_count: 100,
        kept_count: 1,
        rejected_count: 1,
        created_at: "2026-06-01T08:00:00.000Z",
        scout_learning_lessons: [],
        scout_companies: [
          companyRow({
            id: "company-kept",
            name: "Compte retenu",
            verdict: "watch",
            quality_decision: "needs_enrichment",
            rejection_reason: null
          }),
          companyRow({
            id: "company-rejected",
            name: "Compte écarté",
            verdict: "watch",
            quality_decision: "needs_enrichment",
            rejection_reason: "Signal métier insuffisant."
          })
        ]
      }
    ];

    const snapshot = await getScoutSnapshot();

    expect(snapshot.runs[0].leads.map((lead) => lead.company)).toEqual(["Compte retenu"]);
    expect(snapshot.runs[0].rejected.map((lead) => lead.company)).toEqual(["Compte écarté"]);
    expect(snapshot.rejected[0].rejectionReason).toBe("Signal métier insuffisant.");
  });
});

function companyRow(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "company",
    external_id: "external-company",
    name: "Company",
    website: "https://example.com",
    mode: "exploration",
    segment: "formation B2B",
    score: 62,
    verdict: "watch",
    quality_decision: "needs_enrichment",
    observed_signals: ["Signal public."],
    pain_hypotheses: ["Hypothèse prudente."],
    structured_insights: { observed: [], inferred: [], uncertain: [] },
    score_justification: "Score prudent.",
    next_action: "Ne pas contacter.",
    rejection_reason: null,
    scout_contacts: [],
    scout_evidence: [],
    scout_briefs: [],
    scout_messages: [],
    scout_quality_reports: [],
    ...overrides
  };
}

function fakeTable(table: string) {
  const chain = {
    data: table === "scout_runs" ? state.runs : table === "scout_agent_tasks" ? state.tasks : [],
    error: null,
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain
  };
  return chain;
}
