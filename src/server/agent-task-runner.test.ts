import { describe, expect, it } from "vitest";
import type { ScoutLead, ScoutSnapshot } from "../domain/types";
import type { AgentTaskExecution, AgentTaskExecutor, AgentTaskRepository, QueuedAgentTask } from "./agent-task-runner";
import { createCliAgentTaskExecutor, processAgentTaskQueue, workerEvidenceFileName } from "./agent-task-runner";

describe("agent task runner", () => {
  it("consomme une tache queued et la passe en completed avec le run persiste", async () => {
    const repo = new FakeTaskRepository([
      task({ id: "task-core", type: "weekly_core_research" })
    ]);
    const executor: AgentTaskExecutor = {
      async execute() {
        return {
          status: "completed",
          summary: "Core terminé.",
          traceId: "trace-core"
        };
      }
    };

    const result = await processAgentTaskQueue(repo, executor);

    expect(result.ok).toBe(true);
    expect(repo.transitions).toEqual(["running:task-core", "completed:task-core:run-core"]);
    expect(result.processed[0]).toMatchObject({ taskId: "task-core", resultRunId: "run-core" });
  });

  it("marque une tache bloquee sans pretendre qu'elle est completee", async () => {
    const repo = new FakeTaskRepository([
      task({ id: "task-learning", type: "learning_review" })
    ]);

    const result = await processAgentTaskQueue(repo, {
      async execute() {
        return {
          status: "blocked",
          summary: "Learning non causal.",
          blockedReason: "Feedback loop non prouvee."
        };
      }
    });

    expect(result.ok).toBe(false);
    expect(repo.transitions).toEqual(["running:task-learning", "blocked:task-learning:Feedback loop non prouvee."]);
  });

  it("marque failed si l'executor leve une erreur", async () => {
    const repo = new FakeTaskRepository([
      task({ id: "task-exploration", type: "weekly_exploration_scan" })
    ]);

    const result = await processAgentTaskQueue(repo, {
      async execute() {
        throw new Error("worker indisponible");
      }
    });

    expect(result.ok).toBe(false);
    expect(repo.transitions).toEqual(["running:task-exploration", "failed:task-exploration:worker indisponible"]);
  });

  it("n'execute pas une tache deja claim par un autre runner", async () => {
    const repo = new FakeTaskRepository([task({ id: "task-race", type: "weekly_core_research" })], {
      claimable: false
    });
    const executor: AgentTaskExecutor = {
      async execute() {
        throw new Error("ne doit pas executer");
      }
    };

    const result = await processAgentTaskQueue(repo, executor);

    expect(result.ok).toBe(true);
    expect(result.processed).toEqual([]);
    expect(result.message).toContain("réclamer");
    expect(repo.transitions).toEqual(["claim-missed:task-race"]);
  });

  it("genere un daily brief depuis un snapshot runtime sans worker", async () => {
    const executor = createCliAgentTaskExecutor({
      real: false,
      persist: false,
      loadSnapshot: async () => snapshot()
    });

    const execution = await executor.execute(task({ id: "task-daily", type: "daily_brief" }));

    expect(execution.status).toBe("completed");
    expect(execution.summary).toContain("Daily Brief généré");
    expect(execution.summary).toContain("Cambon Partners");
    expect(execution.summary).toContain("Aucun envoi automatique");
  });

  it("bloque le learning review si les apprentissages persistés sont insuffisants", async () => {
    const executor = createCliAgentTaskExecutor({
      real: false,
      persist: false,
      loadSnapshot: async () => snapshot({ lessons: [] })
    });

    const execution = await executor.execute(task({ id: "task-learning", type: "learning_review" }));

    expect(execution.status).toBe("blocked");
    expect(execution.blockedReason).toContain("Moins de 3 apprentissages");
  });

  it("complete le learning review avec 3 a 5 apprentissages exploitables", async () => {
    const executor = createCliAgentTaskExecutor({
      real: false,
      persist: false,
      loadSnapshot: async () => snapshot()
    });

    const execution = await executor.execute(task({ id: "task-learning-ok", type: "learning_review" }));

    expect(execution.status).toBe("completed");
    expect(execution.summary).toContain("3 apprentissage");
  });

  it("bloque le controle DNC si un lead actif contient un contact DNC", async () => {
    const executor = createCliAgentTaskExecutor({
      real: false,
      persist: false,
      loadSnapshot: async () => snapshot({ primaryLead: lead({ personas: [{ ...persona(), doNotContact: true }] }) })
    });

    const execution = await executor.execute(task({ id: "task-dnc", type: "dnc_check" }));

    expect(execution.status).toBe("blocked");
    expect(execution.blockedReason).toContain("Cambon Partners");
  });

  it("identifie les relances copiables sans envoi automatique", async () => {
    const executor = createCliAgentTaskExecutor({
      real: false,
      persist: false,
      loadSnapshot: async () => snapshot()
    });

    const execution = await executor.execute(task({ id: "task-followup", type: "followup_review" }));

    expect(execution.status).toBe("completed");
    expect(execution.summary).toContain("relance(s) copiables");
    expect(execution.summary).toContain("Aucun envoi automatique");
  });

  it("nomme les artefacts attendus par quality:readiness", () => {
    expect(workerEvidenceFileName("core", { real: true, persist: false })).toBe("latest-real-core.json");
    expect(workerEvidenceFileName("exploration", { real: true, persist: true })).toBe(
      "latest-real-exploration-supabase-persist.json"
    );
    expect(workerEvidenceFileName("core", { real: false, persist: true })).toBe("latest-cli-persist-offline.json");
  });
});

class FakeTaskRepository implements AgentTaskRepository {
  transitions: string[] = [];

  constructor(
    private readonly tasks: QueuedAgentTask[],
    private readonly options: { claimable?: boolean } = {}
  ) {}

  async loadQueuedTasks(options: { limit: number; taskId?: string }): Promise<QueuedAgentTask[]> {
    void options;
    return this.tasks;
  }

  async markRunning(taskId: string): Promise<boolean> {
    if (this.options.claimable === false) {
      this.transitions.push(`claim-missed:${taskId}`);
      return false;
    }
    this.transitions.push(`running:${taskId}`);
    return true;
  }

  async markCompleted(taskId: string, execution: AgentTaskExecution): Promise<void> {
    this.transitions.push(`completed:${taskId}:${execution.resultRunId ?? "no-run"}`);
  }

  async markBlocked(taskId: string, execution: AgentTaskExecution): Promise<void> {
    this.transitions.push(`blocked:${taskId}:${execution.blockedReason}`);
  }

  async markFailed(taskId: string, execution: AgentTaskExecution): Promise<void> {
    this.transitions.push(`failed:${taskId}:${execution.errorMessage}`);
  }

  async findRunIdByTrace(traceId: string): Promise<string | null> {
    return traceId === "trace-core" ? "run-core" : null;
  }
}

function task(overrides: Partial<QueuedAgentTask>): QueuedAgentTask {
  return {
    id: "task",
    type: "weekly_core_research",
    status: "queued",
    title: "Task",
    summary: "Queued task",
    payload: {},
    scheduledFor: "2026-05-30T08:15:00.000Z",
    ...overrides
  };
}

function snapshot(overrides: Partial<ScoutSnapshot> = {}): ScoutSnapshot {
  const primaryLead = overrides.primaryLead === undefined ? lead() : overrides.primaryLead;
  return {
    primaryLead,
    queue: [],
    exploration: [],
    rejected: [],
    lessons: [
      {
        id: "lesson-1",
        lesson: "Feedback Romu : angle deal-by-deal performant.",
        recommendation: "Renforcer l'angle deal-by-deal.",
        source: "feedback/outcomes",
        confidence: 0.9
      },
      {
        id: "lesson-2",
        lesson: "Feedback Romu : messages génériques rejetés.",
        recommendation: "Ancrer chaque message sur un signal observé.",
        source: "feedback/outcomes",
        confidence: 0.9
      },
      {
        id: "lesson-3",
        lesson: "Do-not-contact doit bloquer toute relance.",
        recommendation: "Faire passer le statut do-not-contact avant les recommandations.",
        source: "feedback/outcomes",
        confidence: 0.95
      }
    ],
    runs: [
      {
        id: "run-core",
        mode: "core",
        status: "succeeded",
        createdAt: "2026-05-31T08:00:00.000Z",
        traceId: "trace-core",
        scannedCount: 15,
        keptCount: 1,
        rejectedCount: 0,
        leads: primaryLead ? [primaryLead] : [],
        rejected: [],
        lessons: []
      }
    ],
    tasks: [
      {
        id: "task-core",
        type: "weekly_core_research",
        status: "completed",
        title: "Core",
        summary: "Core terminé.",
        recommendation: "Valider le top lead.",
        payload: { coreWeeklyTarget: 15, explorationScanTarget: 100, explorationShortlistTarget: 12 },
        createdAt: "2026-05-31T08:00:00.000Z",
        scheduledFor: "2026-05-31T08:00:00.000Z",
        completedAt: "2026-05-31T08:10:00.000Z"
      }
    ],
    brief: {
      completed: ["Core terminé."],
      recommended: ["Prioriser Cambon Partners."],
      blocked: []
    },
    readiness: "production_not_ready",
    ...overrides
  };
}

function lead(overrides: Partial<ScoutLead> = {}): ScoutLead {
  return {
    id: "core-cambon",
    company: "Cambon Partners",
    website: "https://www.cambonpartners.com",
    mode: "core",
    segment: "Conseil M&A",
    score: 92,
    verdict: "validate",
    qualityDecision: "pass",
    observedSignals: ["Banque d'affaires indépendante active en M&A."],
    painHypotheses: ["Suivi deal-by-deal possiblement dispersé."],
    scoreJustification: "Signal M&A fort et douleur workflow plausible.",
    shortCard: "Fiche courte.",
    deepCard: "Fiche profonde.",
    personas: [persona()],
    evidence: [
      {
        id: "evidence-1",
        label: "Site",
        url: "https://www.cambonpartners.com",
        observedFact: "M&A",
        reliability: "high"
      }
    ],
    outreach: {
      coldEmail: "Bonjour, signal précis.",
      followUp: "Relance précise.",
      linkedin: "Message précis."
    },
    qualityGates: [{ code: "evidence", passed: true, reason: "Source publique." }],
    nextAction: "Valider l'angle deal-by-deal.",
    ...overrides
  };
}

function persona() {
  return {
    role: "Partner M&A",
    reason: "Décideur probable.",
    contactConfidence: "role_only" as const,
    doNotContact: false,
    emailType: "unknown" as const,
    emailConfidence: "low" as const,
    emailStatus: "not_usable" as const
  };
}
