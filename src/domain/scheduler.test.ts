import { describe, expect, it } from "vitest";
import {
  buildBriefSummary,
  buildTasksFromRuns,
  createDueScheduledTasks,
  createScheduledTasks,
  DEFAULT_ROUTINE_CONFIG
} from "./scheduler";
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

  it("met en file toutes les routines hebdo et quotidiennes le lundi ouvré", () => {
    const tasks = createDueScheduledTasks(new Date("2026-06-01T06:00:00.000Z"));

    expect(tasks.map((task) => task.type)).toEqual([
      "weekly_core_research",
      "weekly_exploration_scan",
      "daily_brief",
      "learning_review",
      "dnc_check",
      "followup_review"
    ]);
  });

  it("planifie les créneaux en heure Paris de façon indépendante du serveur", () => {
    const summer = createScheduledTasks(new Date("2026-06-01T04:00:00.000Z"));
    const winter = createScheduledTasks(new Date("2026-01-05T04:00:00.000Z"));

    expect(summer.map((task) => task.scheduledFor)).toEqual([
      "2026-06-01T06:15:00.000Z",
      "2026-06-01T07:15:00.000Z",
      "2026-06-01T08:15:00.000Z",
      "2026-06-01T09:15:00.000Z",
      "2026-06-01T10:15:00.000Z",
      "2026-06-01T11:15:00.000Z"
    ]);
    expect(winter.map((task) => task.scheduledFor)).toEqual([
      "2026-01-05T07:15:00.000Z",
      "2026-01-05T08:15:00.000Z",
      "2026-01-05T09:15:00.000Z",
      "2026-01-05T10:15:00.000Z",
      "2026-01-05T11:15:00.000Z",
      "2026-01-05T12:15:00.000Z"
    ]);
  });

  it("ne met en file que les routines quotidiennes les autres jours ouvrés", () => {
    const tasks = createDueScheduledTasks(new Date("2026-06-02T06:00:00.000Z"));

    expect(tasks.map((task) => task.type)).toEqual(["daily_brief", "dnc_check", "followup_review"]);
  });

  it("permet de forcer manuellement une routine précise hors cadence", () => {
    const tasks = createDueScheduledTasks(new Date("2026-06-06T06:00:00.000Z"), DEFAULT_ROUTINE_CONFIG, {
      task: "weekly_core_research"
    });

    expect(tasks.map((task) => task.type)).toEqual(["weekly_core_research"]);
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
