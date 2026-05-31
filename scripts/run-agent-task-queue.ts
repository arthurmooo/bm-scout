import {
  createCliAgentTaskExecutor,
  createSupabaseAgentTaskRepository,
  processAgentTaskQueue
} from "../src/server/agent-task-runner";
import { loadLocalEnvFiles } from "../src/server/runtime-env";

loadLocalEnvFiles();

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const real = args.has("--real");
const offline = args.has("--offline");
const recoverStale = args.has("--recover-stale");
const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 3);
const staleMinutes = Number(process.argv.find((arg) => arg.startsWith("--stale-minutes="))?.split("=")[1] ?? 90);
const taskId = process.argv.find((arg) => arg.startsWith("--task-id="))?.split("=")[1];

const repository = createSupabaseAgentTaskRepository();
if (!repository) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: "NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis pour lire scout_agent_tasks."
      },
      null,
      2
    )
  );
  process.exit(1);
}

if (dryRun) {
  const tasks = await repository.loadQueuedTasks({ limit, taskId });
  console.log(JSON.stringify({ ok: true, mode: "dry-run", queued: tasks }, null, 2));
  process.exit(0);
}

if (!real && !offline) {
  console.error(JSON.stringify({ ok: false, message: "Choisir explicitement --real ou --offline." }, null, 2));
  process.exit(1);
}

const result = await processAgentTaskQueue(
  repository,
  createCliAgentTaskExecutor({ real, persist: true }),
  { limit, taskId, recoverStaleMinutes: recoverStale ? staleMinutes : undefined }
);

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
