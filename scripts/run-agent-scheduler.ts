import { createScheduledTasks, DEFAULT_ROUTINE_CONFIG } from "../src/domain/scheduler";
import type { AgentTaskType } from "../src/domain/types";
import { recordScoutAction } from "../src/server/scout-actions";

const args = new Set(process.argv.slice(2));
const taskArg = process.argv.find((arg) => arg.startsWith("--task="))?.split("=")[1] as AgentTaskType | undefined;
const dryRun = args.has("--dry-run");
const run = args.has("--run");

if (!run || dryRun) {
  const tasks = createScheduledTasks(new Date(), DEFAULT_ROUTINE_CONFIG);
  console.log(JSON.stringify({ mode: "plan", dryRun: true, tasks }, null, 2));
  process.exit(0);
}

const actionsByTask: Partial<Record<AgentTaskType, Parameters<typeof recordScoutAction>[0]["action"]>> = {
  weekly_core_research: "launch_core",
  weekly_exploration_scan: "launch_exploration",
  daily_brief: "launch_daily_brief",
  learning_review: "launch_learning_review"
};

const selectedTasks = taskArg ? [taskArg] : (Object.keys(actionsByTask) as AgentTaskType[]);
const results = [];

for (const type of selectedTasks) {
  const action = actionsByTask[type];
  if (!action) {
    results.push({ type, ok: false, message: "Cette routine est planifiée mais pas encore exécutable par le scheduler local." });
    continue;
  }
  results.push({ type, ...(await recordScoutAction({ action, note: "Lancement manuel via scripts/run-agent-scheduler.ts" })) });
}

console.log(JSON.stringify({ mode: "run", dryRun: false, results }, null, 2));
