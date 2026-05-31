import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createDueScheduledTasks, DEFAULT_ROUTINE_CONFIG } from "../src/domain/scheduler";
import type { AgentTaskType } from "../src/domain/types";
import {
  createSupabaseAgentTaskSchedulerRepository,
  enqueueScheduledAgentTasks,
  type AgentTaskScheduleResult
} from "../src/server/agent-task-scheduler";
import {
  createCliAgentTaskExecutor,
  createSupabaseAgentTaskRepository,
  processAgentTaskQueue,
  type AgentTaskQueueResult
} from "../src/server/agent-task-runner";

const execFileAsync = promisify(execFile);

type CronMode = "real" | "offline";

interface AgentTaskCronEvidenceArtifact {
  status: "pass" | "fail";
  generated_at: string;
  source: "github_actions" | "local";
  mode: CronMode;
  code_revision: string;
  github_run_id?: string;
  github_run_attempt?: string;
  github_workflow?: string;
  github_event_name?: string;
  github_ref?: string;
  github_sha?: string;
  has_supabase_env: boolean;
  has_openai_env: boolean;
  dueCount: number;
  insertedCount: number;
  skippedCount: number;
  processedCount: number;
  completedCount: number;
  blockedCount: number;
  failedCount: number;
  recoveredCount: number;
  requiredTaskTypes: AgentTaskType[];
  taskTypes: AgentTaskType[];
  completedTaskTypes: AgentTaskType[];
  workerTraceTaskTypes: AgentTaskType[];
  missingScheduledTaskTypes: AgentTaskType[];
  missingCompletedTaskTypes: AgentTaskType[];
  missingWorkerTraceTaskTypes: AgentTaskType[];
  traceIds: string[];
  blockers: string[];
  schedule?: AgentTaskScheduleResult;
  queue?: AgentTaskQueueResult;
  error?: string;
}

const args = process.argv.slice(2);
const mode: CronMode = argValue("--mode") === "offline" ? "offline" : "real";
const limit = numberArg("--limit", 10);
const staleMinutes = numberArg("--stale-minutes", 90);
const recoverStale = !args.includes("--no-recover-stale");
const nowArg = argValue("--now");
const taskArg = argValue("--task") as AgentTaskType | undefined;
const now = nowArg ? new Date(nowArg) : new Date();
const P0_TASK_TYPES: AgentTaskType[] = [
  "weekly_core_research",
  "weekly_exploration_scan",
  "daily_brief",
  "learning_review",
  "dnc_check",
  "followup_review"
];
const WORKER_TASK_TYPES = new Set<AgentTaskType>(["weekly_core_research", "weekly_exploration_scan"]);

const baseArtifact = {
  generated_at: new Date().toISOString(),
  source: process.env.GITHUB_ACTIONS === "true" ? ("github_actions" as const) : ("local" as const),
  mode,
  code_revision: await resolveCurrentCodeRevision(),
  github_run_id: process.env.GITHUB_RUN_ID,
  github_run_attempt: process.env.GITHUB_RUN_ATTEMPT,
  github_workflow: process.env.GITHUB_WORKFLOW,
  github_event_name: process.env.GITHUB_EVENT_NAME,
  github_ref: process.env.GITHUB_REF,
  github_sha: process.env.GITHUB_SHA,
  has_supabase_env: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
  has_openai_env: Boolean(process.env.OPENAI_API_KEY)
};

try {
  const envBlockers = [
    ...(!baseArtifact.has_supabase_env ? ["NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis pour le cron agent_tasks."] : []),
    ...(mode === "real" && !baseArtifact.has_openai_env ? ["OPENAI_API_KEY requis pour prouver agent:tasks:real en cron."] : [])
  ];

  const schedulerRepository = createSupabaseAgentTaskSchedulerRepository();
  const queueRepository = createSupabaseAgentTaskRepository();
  if (!schedulerRepository || !queueRepository || envBlockers.length) {
    await exitWithArtifact(
      {
        ...emptyArtifact("fail", envBlockers),
        ...baseArtifact
      },
      1
    );
  }
  const scheduler = schedulerRepository!;
  const queueRepositoryReady = queueRepository!;

  const tasks = createDueScheduledTasks(now, DEFAULT_ROUTINE_CONFIG, { task: taskArg });
  const schedule = await enqueueScheduledAgentTasks(scheduler, tasks);
  const queue = await processAgentTaskQueue(
    queueRepositoryReady,
    createCliAgentTaskExecutor({ real: mode === "real", persist: true }),
    { limit, recoverStaleMinutes: recoverStale ? staleMinutes : undefined, now }
  );
  const processed = queue.processed;
  const completed = processed.filter((item) => item.status === "completed");
  const blocked = processed.filter((item) => item.status === "blocked");
  const failed = processed.filter((item) => item.status === "failed");
  const scheduledTaskTypes = uniqueTaskTypes(tasks.map((task) => task.type));
  const completedTaskTypes = uniqueTaskTypes(completed.map((task) => task.taskType));
  const workerTraceTaskTypes = uniqueTaskTypes(
    completed.flatMap((task) => (WORKER_TASK_TYPES.has(task.taskType) && task.traceId ? [task.taskType] : []))
  );
  const missingScheduledTaskTypes = missingTaskTypes(scheduledTaskTypes);
  const missingCompletedTaskTypes = missingTaskTypes(completedTaskTypes);
  const missingWorkerTraceTaskTypes = P0_TASK_TYPES.filter((type) => WORKER_TASK_TYPES.has(type) && !workerTraceTaskTypes.includes(type));
  const blockers = [
    ...(baseArtifact.source !== "github_actions" ? ["Artefact cron produit hors GitHub Actions."] : []),
    ...(mode !== "real" ? ["Artefact cron produit en mode offline, insuffisant pour la readiness."] : []),
    ...(!baseArtifact.has_supabase_env ? ["Secrets Supabase absents."] : []),
    ...(!baseArtifact.has_openai_env ? ["Secret OPENAI_API_KEY absent."] : []),
    ...(tasks.length < 1 ? ["Aucune routine due mise en file par le scheduler."] : []),
    ...(missingScheduledTaskTypes.length
      ? [`Routines P0 absentes du scheduler cron: ${missingScheduledTaskTypes.join(", ")}.`]
      : []),
    ...(schedule.inserted.length < 1 && schedule.skipped.length < 1 ? ["Aucune tâche agent_tasks insérée ou retrouvée."] : []),
    ...(processed.length < 1 ? ["Aucune tâche agent_tasks consommée par le runner."] : []),
    ...(completed.length < 1 ? ["Aucune transition agent_tasks vers completed."] : []),
    ...(missingCompletedTaskTypes.length
      ? [`Routines P0 non complétées par le runner cron: ${missingCompletedTaskTypes.join(", ")}.`]
      : []),
    ...(missingWorkerTraceTaskTypes.length
      ? [`Routines worker sans trace persistable: ${missingWorkerTraceTaskTypes.join(", ")}.`]
      : []),
    ...(blocked.length ? [`${blocked.length} tâche(s) bloquée(s) pendant le cron.`] : []),
    ...(failed.length ? [`${failed.length} tâche(s) échouée(s) pendant le cron.`] : []),
    ...(queue.recovered.length ? [`${queue.recovered.length} tâche(s) running récupérée(s), incident à traiter.`] : [])
  ];

  await exitWithArtifact(
    {
      ...baseArtifact,
      status: blockers.length ? "fail" : "pass",
      dueCount: tasks.length,
      insertedCount: schedule.inserted.length,
      skippedCount: schedule.skipped.length,
      processedCount: processed.length,
      completedCount: completed.length,
      blockedCount: blocked.length,
      failedCount: failed.length,
      recoveredCount: queue.recovered.length,
      requiredTaskTypes: P0_TASK_TYPES,
      taskTypes: scheduledTaskTypes,
      completedTaskTypes,
      workerTraceTaskTypes,
      missingScheduledTaskTypes,
      missingCompletedTaskTypes,
      missingWorkerTraceTaskTypes,
      traceIds: processed.flatMap((task) => (task.traceId ? [task.traceId] : [])),
      blockers,
      schedule,
      queue
    },
    blockers.length ? 1 : 0
  );
} catch (error) {
  await exitWithArtifact(
    {
      ...emptyArtifact("fail", ["Exécution cron agent_tasks impossible."]),
      ...baseArtifact,
      error: error instanceof Error ? error.message : String(error)
    },
    1
  );
}

async function exitWithArtifact(artifact: AgentTaskCronEvidenceArtifact, code: number): Promise<never> {
  const output = JSON.stringify(artifact, null, 2);
  await writeArtifact(output);
  if (code === 0) {
    console.log(output);
  } else {
    console.error(output);
  }
  process.exit(code);
}

function emptyArtifact(status: "pass" | "fail", blockers: string[]): AgentTaskCronEvidenceArtifact {
  return {
    status,
    generated_at: new Date().toISOString(),
    source: "local",
    mode,
    code_revision: "unknown",
    has_supabase_env: false,
    has_openai_env: false,
    dueCount: 0,
    insertedCount: 0,
    skippedCount: 0,
    processedCount: 0,
    completedCount: 0,
    blockedCount: 0,
    failedCount: 0,
    recoveredCount: 0,
    requiredTaskTypes: P0_TASK_TYPES,
    taskTypes: [],
    completedTaskTypes: [],
    workerTraceTaskTypes: [],
    missingScheduledTaskTypes: P0_TASK_TYPES,
    missingCompletedTaskTypes: P0_TASK_TYPES,
    missingWorkerTraceTaskTypes: P0_TASK_TYPES.filter((type) => WORKER_TASK_TYPES.has(type)),
    traceIds: [],
    blockers
  };
}

function uniqueTaskTypes(types: AgentTaskType[]): AgentTaskType[] {
  return P0_TASK_TYPES.filter((type) => types.includes(type));
}

function missingTaskTypes(types: AgentTaskType[]): AgentTaskType[] {
  return P0_TASK_TYPES.filter((type) => !types.includes(type));
}

async function writeArtifact(output: string): Promise<void> {
  const artifactsDir = join(process.cwd(), "artifacts", "agent-tasks");
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(join(artifactsDir, "latest-ci-run.json"), `${output}\n`, "utf8");
}

function argValue(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function numberArg(name: string, fallback: number): number {
  const value = Number(argValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

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
