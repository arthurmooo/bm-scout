import { describe, expect, it } from "vitest";
import { buildBriefSummary, buildTasksFromRuns, createScheduledTasks, DEFAULT_ROUTINE_CONFIG } from "./scheduler";
import { runScoutMission, seedFeedbacks } from "./scout-engine";

describe("routine scheduler", () => {
  it("cree les six taches proactives attendues", () => {
    const tasks = createScheduledTasks(new Date("2026-05-30T07:00:00.000Z"));

    expect(tasks.map((task) => task.type)).toEqual([
      "weekly_core_research",
      "weekly_exploration_scan",
      "daily_brief",
      "learning_review",
      "dnc_check",
      "followup_review"
    ]);
    expect(tasks.every((task) => task.status === "queued")).toBe(true);
  });

  it("porte les objectifs PRD parametrables sans les hardcoder dans l'UI", () => {
    const tasks = createScheduledTasks(new Date("2026-05-30T07:00:00.000Z"), DEFAULT_ROUTINE_CONFIG);

    expect(tasks.find((task) => task.type === "weekly_core_research")?.payload.coreWeeklyTarget).toBe(15);
    expect(tasks.find((task) => task.type === "weekly_exploration_scan")?.payload.explorationScanTarget).toBe(100);
    expect(tasks.find((task) => task.type === "weekly_exploration_scan")?.payload.explorationShortlistTarget).toBe(12);
  });

  it("transforme les runs persistants en brief Romu auditable", () => {
    const feedbacks = seedFeedbacks();
    const runs = [
      runScoutMission("core", { feedbacks }),
      runScoutMission("exploration", { feedbacks })
    ];
    const tasks = buildTasksFromRuns(runs, new Date("2026-05-30T07:00:00.000Z"));
    const brief = buildBriefSummary(tasks, runs);

    expect(tasks.some((task) => task.type === "weekly_core_research" && task.status === "completed")).toBe(true);
    expect(tasks.some((task) => task.type === "weekly_exploration_scan" && task.status === "completed")).toBe(true);
    expect(brief.completed.join(" ")).toContain("comptes Core retenus");
    expect(brief.recommended.join(" ")).toContain("Prioriser");
  });
});
