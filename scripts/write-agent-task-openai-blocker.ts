import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentTaskType } from "../src/domain/types";

const execFileAsync = promisify(execFile);

const P0_TASK_TYPES: AgentTaskType[] = [
  "weekly_core_research",
  "weekly_exploration_scan",
  "daily_brief",
  "learning_review",
  "dnc_check",
  "followup_review"
];
const WORKER_TASK_TYPES = new Set<AgentTaskType>(["weekly_core_research", "weekly_exploration_scan"]);

const artifact = {
  status: "fail",
  generated_at: new Date().toISOString(),
  source: process.env.GITHUB_ACTIONS === "true" ? "github_actions" : "local",
  mode: "real",
  code_revision: await resolveCurrentCodeRevision(),
  github_run_id: process.env.GITHUB_RUN_ID,
  github_run_attempt: process.env.GITHUB_RUN_ATTEMPT,
  github_workflow: process.env.GITHUB_WORKFLOW,
  github_event_name: process.env.GITHUB_EVENT_NAME,
  github_ref: process.env.GITHUB_REF,
  github_sha: process.env.GITHUB_SHA,
  has_supabase_env: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
  has_openai_env: Boolean(process.env.OPENAI_API_KEY),
  dueCount: 0,
  insertedCount: 0,
  skippedCount: 0,
  processedCount: 0,
  completedCount: 0,
  blockedCount: 0,
  failedCount: 0,
  recoveredCount: 0,
  scheduleScope: "due",
  requiredTaskTypes: P0_TASK_TYPES,
  taskTypes: [],
  completedTaskTypes: [],
  workerTraceTaskTypes: [],
  missingScheduledTaskTypes: P0_TASK_TYPES,
  missingCompletedTaskTypes: P0_TASK_TYPES,
  missingWorkerTraceTaskTypes: P0_TASK_TYPES.filter((type) => WORKER_TASK_TYPES.has(type)),
  traceIds: [],
  blockers: ["OpenAI preflight échoué : agent_tasks real non lancé pour éviter une exécution partielle."]
};

const output = JSON.stringify(artifact, null, 2);
const artifactsDir = join(process.cwd(), "artifacts", "agent-tasks");
await mkdir(artifactsDir, { recursive: true });
await writeFile(join(artifactsDir, "latest-ci-run.json"), `${output}\n`, "utf8");
console.error(output);

async function resolveCurrentCodeRevision(): Promise<string> {
  const configured = process.env.BM_SCOUT_CODE_REVISION ?? process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA;
  if (configured?.trim()) return configured.trim();
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      timeout: 2000
    });
    const revision = stdout.trim();
    if (!revision) return "unknown";
    const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
      timeout: 2000
    });
    return status.trim() ? `${revision}-dirty` : revision;
  } catch {
    return "unknown";
  }
}
