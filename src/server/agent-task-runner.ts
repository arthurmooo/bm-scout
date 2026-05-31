import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { AgentTaskStatus, AgentTaskType, RoutineConfig, ScoutLead, ScoutSnapshot } from "../domain/types";
import { createServerSupabaseClient } from "./supabase";

export interface QueuedAgentTask {
  id: string;
  type: AgentTaskType;
  status: AgentTaskStatus;
  title: string;
  summary: string;
  payload: Partial<RoutineConfig>;
  scheduledFor: string;
}

export interface AgentTaskExecution {
  status: "completed" | "blocked" | "failed";
  summary: string;
  traceId?: string;
  resultRunId?: string;
  blockedReason?: string;
  errorMessage?: string;
}

export interface AgentTaskRepository {
  loadQueuedTasks(options: { limit: number; taskId?: string }): Promise<QueuedAgentTask[]>;
  markRunning(taskId: string): Promise<boolean>;
  markCompleted(taskId: string, execution: AgentTaskExecution): Promise<boolean>;
  markBlocked(taskId: string, execution: AgentTaskExecution): Promise<boolean>;
  markFailed(taskId: string, execution: AgentTaskExecution): Promise<boolean>;
  findRunIdByTrace(traceId: string): Promise<string | null>;
}

export interface AgentTaskExecutor {
  execute(task: QueuedAgentTask): Promise<AgentTaskExecution>;
}

export interface AgentTaskQueueResult {
  ok: boolean;
  processed: AgentTaskExecutionResult[];
  message: string;
}

export interface AgentTaskExecutionResult extends AgentTaskExecution {
  taskId: string;
  taskType: AgentTaskType;
}

export async function processAgentTaskQueue(
  repository: AgentTaskRepository,
  executor: AgentTaskExecutor,
  options: { limit?: number; taskId?: string } = {}
): Promise<AgentTaskQueueResult> {
  const tasks = await repository.loadQueuedTasks({ limit: options.limit ?? 3, taskId: options.taskId });
  const processed: AgentTaskExecutionResult[] = [];

  for (const task of tasks) {
    const claimed = await repository.markRunning(task.id);
    if (!claimed) continue;
    const execution = await executeTask(repository, executor, task);
    processed.push({ ...execution, taskId: task.id, taskType: task.type });
  }

  return {
    ok: processed.every((item) => item.status === "completed"),
    processed,
    message: processed.length
      ? `${processed.length} tâche(s) traitée(s).`
      : tasks.length
        ? "Aucune tâche queued disponible à réclamer."
        : "Aucune tâche queued à traiter."
  };
}

export function createSupabaseAgentTaskRepository(): AgentTaskRepository | null {
  const client = createServerSupabaseClient();
  if (!client) return null;

  return {
    async loadQueuedTasks({ limit, taskId }) {
      let query = client
        .from("scout_agent_tasks")
        .select("id,type,status,title,summary,payload,scheduled_for")
        .eq("status", "queued")
        .lte("scheduled_for", new Date().toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(limit);

      if (taskId) query = query.eq("id", taskId);
      const { data, error } = await query;
      if (error) throw new Error(`Lecture agent_tasks impossible: ${error.message}`);
      return (data ?? []).map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        title: row.title,
        summary: row.summary,
        payload: row.payload ?? {},
        scheduledFor: row.scheduled_for
      })) as QueuedAgentTask[];
    },

    async markRunning(taskId) {
      const { data, error } = await client
        .from("scout_agent_tasks")
        .update({ status: "running", started_at: new Date().toISOString(), error_message: null, blocked_reason: null })
        .eq("id", taskId)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();

      if (error) throw new Error(`Claim agent_task impossible: ${error.message}`);
      return Boolean(data?.id);
    },

    async markCompleted(taskId, execution) {
      const { data, error } = await client
        .from("scout_agent_tasks")
        .update({
          status: "completed",
          summary: execution.summary,
          result_run_id: execution.resultRunId ?? null,
          completed_at: new Date().toISOString(),
          error_message: null,
          blocked_reason: null
        })
        .eq("id", taskId)
        .eq("status", "running")
        .select("id")
        .maybeSingle();

      if (error) throw new Error(`Finalisation completed agent_task impossible: ${error.message}`);
      return Boolean(data?.id);
    },

    async markBlocked(taskId, execution) {
      const { data, error } = await client
        .from("scout_agent_tasks")
        .update({
          status: "blocked",
          summary: execution.summary,
          blocked_reason: execution.blockedReason ?? execution.summary,
          completed_at: new Date().toISOString()
        })
        .eq("id", taskId)
        .eq("status", "running")
        .select("id")
        .maybeSingle();

      if (error) throw new Error(`Finalisation blocked agent_task impossible: ${error.message}`);
      return Boolean(data?.id);
    },

    async markFailed(taskId, execution) {
      const { data, error } = await client
        .from("scout_agent_tasks")
        .update({
          status: "failed",
          summary: execution.summary,
          error_message: execution.errorMessage ?? execution.summary,
          completed_at: new Date().toISOString()
        })
        .eq("id", taskId)
        .eq("status", "running")
        .select("id")
        .maybeSingle();

      if (error) throw new Error(`Finalisation failed agent_task impossible: ${error.message}`);
      return Boolean(data?.id);
    },

    async findRunIdByTrace(traceId) {
      const { data, error } = await client
        .from("scout_runs")
        .select("id")
        .eq("trace_id", traceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Recherche run par trace impossible: ${error.message}`);
      return data?.id ?? null;
    }
  };
}

export interface WorkerCliOptions {
  real: boolean;
  persist?: boolean;
  pythonPath?: string;
  artifactsDir?: string;
  evidenceDir?: string;
  includeWeak?: boolean;
  loadSnapshot?: () => Promise<ScoutSnapshot | null>;
}

export interface WorkerCliEvidenceResult {
  code: number | null;
  stdout: string;
  stderr: string;
  parsed: WorkerCliOutput | null;
  evidenceFile?: string;
}

export function createCliAgentTaskExecutor(options: WorkerCliOptions = { real: false }): AgentTaskExecutor {
  return {
    async execute(task) {
      if (task.type === "weekly_core_research") {
        return runWorkerCli("core", options);
      }
      if (task.type === "weekly_exploration_scan") {
        return runWorkerCli("exploration", options);
      }
      if (task.type === "daily_brief") {
        return executeDailyBrief(options);
      }
      if (task.type === "learning_review") {
        return executeLearningReview(options);
      }
      if (task.type === "dnc_check") {
        return executeDncCheck(options);
      }
      if (task.type === "followup_review") {
        return executeFollowupReview(options);
      }
      return {
        status: "blocked",
        summary: `${task.title} bloquée : runner métier pas encore implémenté.`,
        blockedReason: "Routine planifiée mais pas encore exécutable par le worker V1."
      };
    }
  };
}

async function executeDailyBrief(options: WorkerCliOptions): Promise<AgentTaskExecution> {
  const snapshot = await loadRuntimeSnapshot(options);
  if (!snapshot) return blockedNoRuntime("Daily Brief");

  const primary = snapshot.primaryLead;
  const completedTasks = snapshot.tasks.filter((task) => task.status === "completed").length;
  const blockedItems = snapshot.brief.blocked.length + snapshot.rejected.length;
  return {
    status: "completed",
    summary: [
      `Daily Brief généré depuis ${snapshot.runs.length} run(s) persisté(s).`,
      primary ? `Priorité Romu : ${primary.company} (${primary.score}/100) - ${primary.nextAction}` : "Aucune priorité validable.",
      `${completedTasks} tâche(s) déjà complétée(s), ${blockedItems} point(s) bloqué(s) à traiter.`,
      "Aucun envoi automatique."
    ].join(" ")
  };
}

async function executeLearningReview(options: WorkerCliOptions): Promise<AgentTaskExecution> {
  const snapshot = await loadRuntimeSnapshot(options);
  if (!snapshot) return blockedNoRuntime("Learning Review");

  const lessons = snapshot.lessons.slice(0, 5);
  if (lessons.length < 3) {
    return {
      status: "blocked",
      summary: "Learning Review bloquée : pas assez d'apprentissages persistés.",
      blockedReason: "Moins de 3 apprentissages disponibles depuis les runs/feedbacks Supabase."
    };
  }

  return {
    status: "completed",
    summary: `Learning Review générée : ${lessons.length} apprentissage(s) exploitables. Prochaine règle : ${lessons[0].recommendation}`
  };
}

async function executeDncCheck(options: WorkerCliOptions): Promise<AgentTaskExecution> {
  const snapshot = await loadRuntimeSnapshot(options);
  if (!snapshot) return blockedNoRuntime("Contrôle do-not-contact");

  const activeViolations = activeLeads(snapshot).filter((lead) => leadHasDncContact(lead));
  if (activeViolations.length) {
    return {
      status: "blocked",
      summary: `Contrôle DNC bloqué : ${activeViolations.length} lead(s) actif(s) contiennent un contact do-not-contact.`,
      blockedReason: `DNC actif dans la shortlist : ${activeViolations.map((lead) => lead.company).join(", ")}.`
    };
  }

  const blockedDnc = snapshot.rejected.filter((lead) => leadHasDncContact(lead)).length;
  return {
    status: "completed",
    summary: `Contrôle DNC terminé : ${blockedDnc} lead(s) DNC restent bloqués, aucune relance active ne cible un DNC.`
  };
}

async function executeFollowupReview(options: WorkerCliOptions): Promise<AgentTaskExecution> {
  const snapshot = await loadRuntimeSnapshot(options);
  if (!snapshot) return blockedNoRuntime("Revue relances");

  const followups = activeLeads(snapshot).filter(
    (lead) =>
      lead.mode === "core" &&
      lead.qualityDecision === "pass" &&
      !leadHasDncContact(lead) &&
      !lead.outreach.followUp.toLowerCase().includes("brouillon blo")
  );

  return {
    status: "completed",
    summary: followups.length
      ? `Revue relances terminée : ${followups.length} relance(s) copiables après validation Romu (${followups
          .slice(0, 3)
          .map((lead) => lead.company)
          .join(", ")}). Aucun envoi automatique.`
      : "Revue relances terminée : aucune relance autorisée à copier pour l'instant. Aucun envoi automatique."
  };
}

async function loadRuntimeSnapshot(options: WorkerCliOptions): Promise<ScoutSnapshot | null> {
  if (options.loadSnapshot) return options.loadSnapshot();

  const client = createServerSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.from("scout_runs").select("id").eq("status", "succeeded").limit(1);
  if (error) throw new Error(`Vérification runs Supabase impossible: ${error.message}`);
  if (!data?.length) return null;
  const { getScoutSnapshot } = await import("./scout-repository");
  return getScoutSnapshot();
}

function blockedNoRuntime(label: string): AgentTaskExecution {
  return {
    status: "blocked",
    summary: `${label} bloqué : aucun run Supabase persistant disponible.`,
    blockedReason: "La routine refuse de s'appuyer sur les fixtures demo pour produire une décision opérationnelle."
  };
}

function activeLeads(snapshot: ScoutSnapshot): ScoutLead[] {
  return [
    ...[snapshot.primaryLead].flatMap((lead) => (lead ? [lead] : [])),
    ...snapshot.queue,
    ...snapshot.exploration
  ];
}

function leadHasDncContact(lead: ScoutLead): boolean {
  return lead.personas.some((persona) => persona.doNotContact);
}

async function executeTask(
  repository: AgentTaskRepository,
  executor: AgentTaskExecutor,
  task: QueuedAgentTask
): Promise<AgentTaskExecution> {
  try {
    const execution = await executor.execute(task);
    const withRunId =
      execution.traceId && !execution.resultRunId
        ? { ...execution, resultRunId: (await repository.findRunIdByTrace(execution.traceId)) ?? undefined }
        : execution;

    const finalized = await finalizeTaskExecution(repository, task.id, withRunId);
    if (!finalized) {
      return {
        status: "failed",
        summary: "Tâche non finalisée : son statut a changé pendant l'exécution.",
        errorMessage: "Transition terminale refusée car scout_agent_tasks n'était plus running."
      };
    }
    return withRunId;
  } catch (error) {
    const execution: AgentTaskExecution = {
      status: "failed",
      summary: "Tâche échouée pendant l'exécution du runner.",
      errorMessage: error instanceof Error ? error.message : String(error)
    };
    await repository.markFailed(task.id, execution);
    return execution;
  }
}

function finalizeTaskExecution(
  repository: AgentTaskRepository,
  taskId: string,
  execution: AgentTaskExecution
): Promise<boolean> {
  if (execution.status === "completed") return repository.markCompleted(taskId, execution);
  if (execution.status === "blocked") return repository.markBlocked(taskId, execution);
  return repository.markFailed(taskId, execution);
}

export async function runWorkerCliForEvidence(
  mode: "core" | "exploration",
  options: WorkerCliOptions
): Promise<WorkerCliEvidenceResult> {
  const pythonPath = options.pythonPath ?? defaultPythonPath();
  const artifactsDir = options.artifactsDir ?? "artifacts/agent-worker-real";
  const args = [
    "-m",
    "bm_scout_worker.cli",
    "--mode",
    mode,
    options.real ? "--real" : "--offline",
    "--artifacts-dir",
    artifactsDir
  ];
  if (options.includeWeak) args.push("--include-weak");
  if (options.persist !== false) args.push("--persist");

  const result = await runProcess(pythonPath, args);
  const parsed = parseWorkerOutput(result.stdout);
  const evidenceFile = parsed ? await writeWorkerEvidence(mode, options, parsed) : undefined;

  return {
    ...result,
    parsed,
    evidenceFile
  };
}

async function runWorkerCli(mode: "core" | "exploration", options: WorkerCliOptions): Promise<AgentTaskExecution> {
  const result = await runWorkerCliForEvidence(mode, options);
  if (result.code !== 0) {
    return {
      status: "failed",
      summary: `Worker ${mode} échoué.`,
      errorMessage: [result.stderr, result.stdout].filter(Boolean).join("\n").slice(0, 4000)
    };
  }

  if (!result.parsed || result.parsed.verdict !== "pass") {
    return {
      status: "failed",
      summary: `Worker ${mode} sans verdict pass.`,
      errorMessage: result.stdout.slice(0, 4000)
    };
  }

  return {
    status: "completed",
    summary: `Worker ${mode} terminé : ${result.parsed.output.kept_count} retenus, ${result.parsed.output.rejected_count} rejetés.`,
    traceId: result.parsed.output.trace_id
  };
}

export function workerEvidenceFileName(mode: "core" | "exploration", options: Pick<WorkerCliOptions, "real" | "persist">): string {
  if (!options.real && options.persist !== false) return "latest-cli-persist-offline.json";
  if (options.real && options.persist !== false) return `latest-real-${mode}-supabase-persist.json`;
  if (options.real) return `latest-real-${mode}.json`;
  return `latest-offline-${mode}.json`;
}

async function writeWorkerEvidence(
  mode: "core" | "exploration",
  options: WorkerCliOptions,
  parsed: WorkerCliOutput
): Promise<string> {
  const evidenceDir = options.evidenceDir ?? join(process.cwd(), "artifacts", "agent-worker-real");
  const fileName = workerEvidenceFileName(mode, options);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, fileName), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return fileName;
}

function defaultPythonPath(): string {
  const localVenv = join(process.cwd(), ".venv", "bin", "python");
  return existsSync(localVenv) ? localVenv : "python3";
}

function runProcess(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env });
    const timeoutMs = workerCliTimeoutMs();
    let stdout = "";
    let stderr = "";
    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) return;
      stderr += `\nWorker CLI timeout après ${timeoutMs}ms.`;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!finished) child.kill("SIGKILL");
      }, 3000).unref();
    }, timeoutMs);
    timeout.unref();

    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      stderr += error.message;
      finish(1);
    });
    child.on("close", (code, signal) => finish(signal === "SIGTERM" ? 124 : code));
  });
}

function workerCliTimeoutMs(): number {
  const value = Number(process.env.BM_SCOUT_WORKER_TIMEOUT_MS ?? 300000);
  return Number.isFinite(value) && value >= 10000 ? value : 300000;
}

function parseWorkerOutput(stdout: string): WorkerCliOutput | null {
  try {
    return JSON.parse(stdout) as WorkerCliOutput;
  } catch {
    return null;
  }
}

interface WorkerCliOutput {
  verdict: "pass" | "fail";
  blockers?: string[];
  output: {
    trace_id: string;
    mode?: "core" | "exploration";
    kept_count: number;
    rejected_count: number;
    final_decision?: "ready" | "not_ready";
    lessons?: { lesson?: string; recommendation?: string; source?: string }[];
  };
}
