import { describe, expect, it } from "vitest";
import { createScheduledTasks } from "../domain/scheduler";
import type { AgentTaskType } from "../domain/types";
import type { AgentTaskSchedulerRepository, ExistingScheduledTask } from "./agent-task-scheduler";
import { enqueueScheduledAgentTasks } from "./agent-task-scheduler";

describe("agent task scheduler repository flow", () => {
  it("met en file les six routines P0 quand aucun doublon n'existe", async () => {
    const tasks = createScheduledTasks(new Date("2026-06-01T06:00:00.000Z"));
    const repo = new FakeSchedulerRepository();

    const result = await enqueueScheduledAgentTasks(repo, tasks);

    expect(result.ok).toBe(true);
    expect(result.inserted.map((item) => item.type)).toEqual([
      "weekly_core_research",
      "weekly_exploration_scan",
      "daily_brief",
      "learning_review",
      "dnc_check",
      "followup_review"
    ]);
    expect(result.skipped).toEqual([]);
    expect(repo.insertedTypes).toEqual(result.inserted.map((item) => item.type));
  });

  it("evite les doublons de cron pour une tache deja queued le meme jour", async () => {
    const tasks = createScheduledTasks(new Date("2026-06-01T06:00:00.000Z"));
    const repo = new FakeSchedulerRepository({
      weekly_core_research: { id: "existing-core", status: "queued" }
    });

    const result = await enqueueScheduledAgentTasks(repo, tasks);

    expect(result.skipped).toContainEqual({
      taskId: "existing-core",
      type: "weekly_core_research",
      status: "queued"
    });
    expect(result.inserted.map((item) => item.type)).not.toContain("weekly_core_research");
  });

  it("force la remise en file quand le cron est lance explicitement avec force", async () => {
    const tasks = createScheduledTasks(new Date("2026-06-01T06:00:00.000Z")).filter(
      (task) => task.type === "weekly_core_research"
    );
    const repo = new FakeSchedulerRepository({
      weekly_core_research: { id: "existing-core", status: "completed" }
    });

    const result = await enqueueScheduledAgentTasks(repo, tasks, { force: true });

    expect(result.skipped).toEqual([]);
    expect(result.inserted).toEqual([{ taskId: "created-weekly_core_research", type: "weekly_core_research" }]);
  });
});

class FakeSchedulerRepository implements AgentTaskSchedulerRepository {
  insertedTypes: AgentTaskType[] = [];

  constructor(private readonly existing: Partial<Record<AgentTaskType, ExistingScheduledTask>> = {}) {}

  async findExistingTask(type: AgentTaskType): Promise<ExistingScheduledTask | null> {
    return this.existing[type] ?? null;
  }

  async insertTask(task: { type: AgentTaskType }): Promise<{ id: string }> {
    this.insertedTypes.push(task.type);
    return { id: `created-${task.type}` };
  }
}
