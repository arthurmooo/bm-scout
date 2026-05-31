import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createScheduledTasks, DEFAULT_ROUTINE_CONFIG } from "../src/domain/scheduler";
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
  type AgentTaskExecutor,
  type AgentTaskQueueResult
} from "../src/server/agent-task-runner";
import { loadLocalEnvFiles } from "../src/server/runtime-env";

const execFileAsync = promisify(execFile);
loadLocalEnvFiles();

const P0_TASK_TYPES: AgentTaskType[] = [
  "weekly_core_research",
  "weekly_exploration_scan",
  "daily_brief",
  "learning_review",
  "dnc_check",
  "followup_review"
];
const WORKER_TASK_TYPES = new Set<AgentTaskType>(["weekly_core_research", "weekly_exploration_scan"]);

interface OpenAiBlockerArtifact {
  status: "fail";
  generated_at: string;
  source: "github_actions" | "local";
  mode: "real";
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
  scheduleScope: "all_p0";
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
}

const baseArtifact = {
  status: "fail" as const,
  generated_at: new Date().toISOString(),
  source: process.env.GITHUB_ACTIONS === "true" ? ("github_actions" as const) : ("local" as const),
  mode: "real" as const,
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

const fallbackArtifact: OpenAiBlockerArtifact = {
  ...baseArtifact,
  dueCount: 0,
  insertedCount: 0,
  skippedCount: 0,
  processedCount: 0,
  completedCount: 0,
  blockedCount: 0,
  failedCount: 0,
  recoveredCount: 0,
  scheduleScope: "all_p0",
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

const artifact = await buildArtifact();
const output = JSON.stringify(artifact, null, 2);
const artifactsDir = join(process.cwd(), "artifacts", "agent-tasks");
await mkdir(artifactsDir, { recursive: true });
await writeFile(join(artifactsDir, "latest-ci-run.json"), `${output}\n`, "utf8");
console.error(output);

async function buildArtifact(): Promise<OpenAiBlockerArtifact> {
  const schedulerRepository = createSupabaseAgentTaskSchedulerRepository();
  const queueRepository = createSupabaseAgentTaskRepository();
  if (!baseArtifact.has_supabase_env || !schedulerRepository || !queueRepository) {
    return {
      ...fallbackArtifact,
      blockers: [
        "OpenAI preflight échoué : agent_tasks real non lancé pour éviter une exécution partielle.",
        "NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis pour persister les tâches bloquées."
      ]
    };
  }

  const tasks = createScheduledTasks(new Date(), DEFAULT_ROUTINE_CONFIG);
  const schedule = await enqueueScheduledAgentTasks(schedulerRepository, tasks);
  const queue = await processScheduledOpenAiBlockedTasks(
    queueRepository,
    schedule.inserted.concat(schedule.skipped.filter((task) => task.status === "queued"))
  );
  const processed = queue.processed;
  const completed = processed.filter((task) => task.status === "completed");
  const blocked = processed.filter((task) => task.status === "blocked");
  const failed = processed.filter((task) => task.status === "failed");
  const skippedCompleted = schedule.skipped.filter((task) => task.status === "completed");
  const skippedBlocked = schedule.skipped.filter((task) => task.status === "blocked");
  const skippedFailed = schedule.skipped.filter((task) => task.status === "failed");
  const taskTypes = uniqueTaskTypes(tasks.map((task) => task.type));
  const completedTaskTypes = uniqueTaskTypes(completed.map((task) => task.taskType).concat(skippedCompleted.map((task) => task.type)));
  const workerTraceTaskTypes = uniqueTaskTypes(
    completed.flatMap((task) => (WORKER_TASK_TYPES.has(task.taskType) && task.traceId ? [task.taskType] : []))
  );

  return {
    ...baseArtifact,
    dueCount: tasks.length,
    insertedCount: schedule.inserted.length,
    skippedCount: schedule.skipped.length,
    processedCount: processed.length,
    completedCount: completed.length + skippedCompleted.length,
    blockedCount: blocked.length + skippedBlocked.length,
    failedCount: failed.length + skippedFailed.length,
    recoveredCount: queue.recovered.length,
    scheduleScope: "all_p0",
    requiredTaskTypes: P0_TASK_TYPES,
    taskTypes,
    completedTaskTypes,
    workerTraceTaskTypes,
    missingScheduledTaskTypes: missingTaskTypes(taskTypes),
    missingCompletedTaskTypes: missingTaskTypes(completedTaskTypes),
    missingWorkerTraceTaskTypes: P0_TASK_TYPES.filter((type) => WORKER_TASK_TYPES.has(type) && !workerTraceTaskTypes.includes(type)),
    traceIds: processed.flatMap((task) => (task.traceId ? [task.traceId] : [])),
    blockers: [
      "OpenAI preflight échoué : agent_tasks real partiellement bloqué avant les routines Core/Exploration.",
      ...(blocked.length ? [`${blocked.length} tâche(s) agent_tasks bloquée(s) et persistée(s) avec raison.`] : []),
      ...(skippedBlocked.length ? [`${skippedBlocked.length} tâche(s) agent_tasks déjà bloquée(s) sur ce créneau.`] : []),
      ...(failed.length ? [`${failed.length} tâche(s) agent_tasks échouée(s).`] : []),
      ...(skippedFailed.length ? [`${skippedFailed.length} tâche(s) agent_tasks déjà échouée(s) sur ce créneau.`] : []),
      ...(queue.recovered.length ? [`${queue.recovered.length} tâche(s) running récupérée(s).`] : [])
    ],
    schedule,
    queue
  };
}

async function processScheduledOpenAiBlockedTasks(
  repository: NonNullable<ReturnType<typeof createSupabaseAgentTaskRepository>>,
  scheduled: Array<{ taskId: string; type: AgentTaskType }>
): Promise<AgentTaskQueueResult> {
  const executor = createOpenAiBlockedExecutor();
  const processed: AgentTaskQueueResult["processed"] = [];
  const recovered: AgentTaskQueueResult["recovered"] = [];

  for (const [index, item] of scheduled.entries()) {
    const result = await processAgentTaskQueue(repository, executor, {
      limit: 1,
      taskId: item.taskId,
      recoverStaleMinutes: index === 0 ? 90 : undefined
    });
    processed.push(...result.processed);
    recovered.push(...result.recovered);
  }

  return {
    ok: recovered.length === 0 && processed.every((item) => item.status === "completed"),
    processed,
    recovered,
    message: `${processed.length} tâche(s) P0 traitée(s) après preflight OpenAI échoué, ${recovered.length} récupérée(s).`
  };
}

function createOpenAiBlockedExecutor(): AgentTaskExecutor {
  const fallbackExecutor = createCliAgentTaskExecutor({ real: false, persist: false });
  return {
    async execute(task) {
      if (WORKER_TASK_TYPES.has(task.type)) {
        return {
          status: "blocked",
          summary: `${task.title} bloquée : OpenAI indisponible avant run Agents SDK.`,
          blockedReason: "OpenAI preflight échoué : quota/billing insuffisant, aucun run Core/Exploration réel lancé."
        };
      }
      return fallbackExecutor.execute(task);
    }
  };
}

function uniqueTaskTypes(types: AgentTaskType[]): AgentTaskType[] {
  return P0_TASK_TYPES.filter((type) => types.includes(type));
}

function missingTaskTypes(types: AgentTaskType[]): AgentTaskType[] {
  return P0_TASK_TYPES.filter((type) => !types.includes(type));
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
