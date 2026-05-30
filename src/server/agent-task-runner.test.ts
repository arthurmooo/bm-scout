import { describe, expect, it } from "vitest";
import type { AgentTaskExecution, AgentTaskExecutor, AgentTaskRepository, QueuedAgentTask } from "./agent-task-runner";
import { processAgentTaskQueue } from "./agent-task-runner";

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
});

class FakeTaskRepository implements AgentTaskRepository {
  transitions: string[] = [];

  constructor(private readonly tasks: QueuedAgentTask[]) {}

  async loadQueuedTasks(options: { limit: number; taskId?: string }): Promise<QueuedAgentTask[]> {
    void options;
    return this.tasks;
  }

  async markRunning(taskId: string): Promise<void> {
    this.transitions.push(`running:${taskId}`);
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
