import { createDueScheduledTasks, createScheduledTasks, DEFAULT_ROUTINE_CONFIG } from "../src/domain/scheduler";
import type { AgentTaskType } from "../src/domain/types";
import {
  createSupabaseAgentTaskSchedulerRepository,
  enqueueScheduledAgentTasks
} from "../src/server/agent-task-scheduler";
import { loadLocalEnvFiles } from "../src/server/runtime-env";

loadLocalEnvFiles();

const args = new Set(process.argv.slice(2));
const taskArg = process.argv.find((arg) => arg.startsWith("--task="))?.split("=")[1] as AgentTaskType | undefined;
const dryRun = args.has("--dry-run");
const run = args.has("--run");
const force = args.has("--force");
const nowArg = process.argv.find((arg) => arg.startsWith("--now="))?.split("=")[1];
const now = nowArg ? new Date(nowArg) : new Date();

if (!run || dryRun) {
  const tasks = createScheduledTasks(now, DEFAULT_ROUTINE_CONFIG);
  const due = createDueScheduledTasks(now, DEFAULT_ROUTINE_CONFIG, { task: taskArg });
  console.log(JSON.stringify({ mode: "plan", dryRun: true, tasks, due }, null, 2));
  process.exit(0);
}

const tasks = createDueScheduledTasks(now, DEFAULT_ROUTINE_CONFIG, { task: taskArg });
const repository = createSupabaseAgentTaskSchedulerRepository();

if (!repository) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: "NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis pour mettre scout_agent_tasks en file."
      },
      null,
      2
    )
  );
  process.exit(1);
}

const result = await enqueueScheduledAgentTasks(repository, tasks, { force });
console.log(JSON.stringify({ mode: "run", dryRun: false, dueCount: tasks.length, ...result }, null, 2));
process.exit(result.ok ? 0 : 1);
