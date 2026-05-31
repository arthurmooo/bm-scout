import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ScoutLead, ScoutSnapshot } from "../domain/types";
import type {
  AgentTaskExecution,
  AgentTaskExecutor,
  AgentTaskRepository,
  QueuedAgentTask,
  RecoveredAgentTask
} from "./agent-task-runner";
import {
  createCliAgentTaskExecutor,
  processAgentTaskQueue,
  runWorkerCliForEvidence,
  workerReadinessBlockers,
  workerEnvForTask,
  workerEvidenceFileName
} from "./agent-task-runner";

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

  it("recupere les taches running trop anciennes avant de consommer la queue", async () => {
    const repo = new FakeTaskRepository([task({ id: "task-core", type: "weekly_core_research" })], {
      staleTasks: [
        {
          id: "task-stale",
          type: "weekly_exploration_scan",
          startedAt: "2026-05-30T06:00:00.000Z",
          scheduledFor: "2026-05-30T05:00:00.000Z"
        }
      ]
    });

    const result = await processAgentTaskQueue(
      repo,
      {
        async execute() {
          return {
            status: "completed",
            summary: "Core terminé.",
            traceId: "trace-core"
          };
        }
      },
      { recoverStaleMinutes: 60, now: new Date("2026-05-30T08:00:00.000Z") }
    );

    expect(result.ok).toBe(false);
    expect(result.recovered).toEqual([
      {
        id: "task-stale",
        type: "weekly_exploration_scan",
        startedAt: "2026-05-30T06:00:00.000Z",
        scheduledFor: "2026-05-30T05:00:00.000Z"
      }
    ]);
    expect(result.message).toContain("1 tâche(s) running récupérée");
    expect(repo.transitions).toEqual(["recover-stale:2026-05-30T07:00:00.000Z:10", "running:task-core", "completed:task-core:run-core"]);
  });

  it("n'ecrase pas une tache modifiee avant finalisation", async () => {
    const repo = new FakeTaskRepository([task({ id: "task-cancelled", type: "weekly_core_research" })], {
      finalizable: false
    });

    const result = await processAgentTaskQueue(repo, {
      async execute() {
        return {
          status: "completed",
          summary: "Core terminé.",
          traceId: "trace-core"
        };
      }
    });

    expect(result.ok).toBe(false);
    expect(result.processed[0]).toMatchObject({
      taskId: "task-cancelled",
      status: "failed",
      errorMessage: "Transition terminale refusée car scout_agent_tasks n'était plus running."
    });
    expect(repo.transitions).toEqual(["running:task-cancelled", "completed-missed:task-cancelled"]);
  });

  it("n'ecrase pas une tache modifiee quand l'executor leve une erreur", async () => {
    const repo = new FakeTaskRepository([task({ id: "task-failed-race", type: "weekly_exploration_scan" })], {
      finalizable: false
    });

    const result = await processAgentTaskQueue(repo, {
      async execute() {
        throw new Error("worker indisponible");
      }
    });

    expect(result.ok).toBe(false);
    expect(result.processed[0]).toMatchObject({
      taskId: "task-failed-race",
      status: "failed",
      summary: "Tâche non finalisée : son statut a changé pendant l'exécution."
    });
    expect(result.processed[0].errorMessage).toContain("Transition terminale refusée");
    expect(result.processed[0].errorMessage).toContain("Erreur originale: worker indisponible");
    expect(repo.transitions).toEqual(["running:task-failed-race", "failed-missed:task-failed-race"]);
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

  it("transmet les objectifs PRD des agent_tasks au worker Python", () => {
    expect(
      workerEnvForTask(task({ id: "task-core", type: "weekly_core_research", payload: { coreWeeklyTarget: 15 } }))
    ).toEqual({ BM_SCOUT_CORE_TARGET: "15" });
    expect(
      workerEnvForTask(
        task({
          id: "task-exploration",
          type: "weekly_exploration_scan",
          payload: { explorationScanTarget: 100, explorationShortlistTarget: 12 }
        })
      )
    ).toEqual({ BM_SCOUT_EXPLORATION_SCAN_TARGET: "100", BM_SCOUT_FETCH_LIMIT: "12" });
  });

  it("bloque une preuve worker réelle persistée sous les volumes PRD", () => {
    expect(
      workerReadinessBlockers(
        "core",
        { real: true, persist: true, env: { BM_SCOUT_CORE_TARGET: "15" } },
        {
          scanned_count: 6,
          run_steps: [{ step: "persist_complete", event_type: "supabase_persist" }]
        }
      )
    ).toContain("Volume PRD core non prouvé : 6/15 comptes scannés.");

    expect(
      workerReadinessBlockers(
        "exploration",
        { real: true, persist: true, env: { BM_SCOUT_EXPLORATION_SCAN_TARGET: "100" } },
        {
          scanned_count: 25,
          run_steps: [{ step: "persist_complete", event_type: "supabase_persist" }]
        }
      )
    ).toContain("Volume PRD exploration non prouvé : 25/100 comptes scannés.");
  });

  it("exige la preuve persist_complete pour un worker réel persisté", () => {
    expect(
      workerReadinessBlockers(
        "core",
        { real: true, persist: true, env: { BM_SCOUT_CORE_TARGET: "15" } },
        { scanned_count: 15, run_steps: [] }
      )
    ).toEqual(["Persistance Supabase non prouvée : step persist_complete absent."]);

    expect(workerReadinessBlockers("core", { real: true, persist: false }, { scanned_count: 1, run_steps: [] })).toEqual([]);
    expect(workerReadinessBlockers("core", { real: false, persist: true }, { scanned_count: 1, run_steps: [] })).toEqual([]);
  });

  it("n'impose pas le volume PRD au scénario feedback loop contrôlé", () => {
    expect(
      workerReadinessBlockers(
        "core",
        { real: true, persist: true, env: { BM_SCOUT_EVIDENCE_PURPOSE: "feedback_loop", BM_SCOUT_CORE_TARGET: "15" } },
        {
          scanned_count: 3,
          run_steps: [{ step: "persist_complete", event_type: "supabase_persist" }]
        }
      )
    ).toEqual([]);
  });

  it("ecrase l'artefact attendu avec un verdict fail si le worker ne retourne pas de JSON", async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), "bm-scout-worker-fail-"));

    const result = await runWorkerCliForEvidence("exploration", {
      real: true,
      persist: false,
      pythonPath: "/usr/bin/false",
      artifactsDir,
      evidenceDir: artifactsDir
    });

    expect(result.code).not.toBe(0);
    expect(result.evidenceFile).toBe("latest-real-exploration.json");
    expect(result.parsed?.verdict).toBe("fail");
    expect(result.parsed?.blockers?.[0]).toContain("sans sortie JSON valide");

    const payload = JSON.parse(await readFile(join(artifactsDir, result.evidenceFile ?? ""), "utf8")) as {
      verdict?: string;
      output?: { final_decision?: string; run_steps?: Array<{ step?: string }> };
    };
    expect(payload.verdict).toBe("fail");
    expect(payload.output?.final_decision).toBe("not_ready");
    expect(payload.output?.run_steps?.[0]?.step).toBe("worker_cli_failed");
  });
});

class FakeTaskRepository implements AgentTaskRepository {
  transitions: string[] = [];

  constructor(
    private readonly tasks: QueuedAgentTask[],
    private readonly options: { claimable?: boolean; finalizable?: boolean; staleTasks?: RecoveredAgentTask[] } = {}
  ) {}

  async loadQueuedTasks(options: { limit: number; taskId?: string }): Promise<QueuedAgentTask[]> {
    void options;
    return this.tasks;
  }

  async recoverStaleRunningTasks(options: { staleBefore: string; limit: number }): Promise<RecoveredAgentTask[]> {
    this.transitions.push(`recover-stale:${options.staleBefore}:${options.limit}`);
    return this.options.staleTasks ?? [];
  }

  async markRunning(taskId: string): Promise<boolean> {
    if (this.options.claimable === false) {
      this.transitions.push(`claim-missed:${taskId}`);
      return false;
    }
    this.transitions.push(`running:${taskId}`);
    return true;
  }

  async markCompleted(taskId: string, execution: AgentTaskExecution): Promise<boolean> {
    if (this.options.finalizable === false) {
      this.transitions.push(`completed-missed:${taskId}`);
      return false;
    }
    this.transitions.push(`completed:${taskId}:${execution.resultRunId ?? "no-run"}`);
    return true;
  }

  async markBlocked(taskId: string, execution: AgentTaskExecution): Promise<boolean> {
    if (this.options.finalizable === false) {
      this.transitions.push(`blocked-missed:${taskId}`);
      return false;
    }
    this.transitions.push(`blocked:${taskId}:${execution.blockedReason}`);
    return true;
  }

  async markFailed(taskId: string, execution: AgentTaskExecution): Promise<boolean> {
    if (this.options.finalizable === false) {
      this.transitions.push(`failed-missed:${taskId}`);
      return false;
    }
    this.transitions.push(`failed:${taskId}:${execution.errorMessage}`);
    return true;
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
