import type { AgentTask, AgentTaskStatus, AgentTaskType } from "../domain/types";
import { createServerSupabaseClient } from "./supabase";

export interface ExistingScheduledTask {
  id: string;
  status: AgentTaskStatus;
}

export interface AgentTaskSchedulerRepository {
  findExistingTask(type: AgentTaskType, scheduledFor: string): Promise<ExistingScheduledTask | null>;
  insertTask(task: AgentTask): Promise<{ id: string }>;
}

export interface AgentTaskScheduleResult {
  ok: boolean;
  inserted: Array<{ taskId: string; type: AgentTaskType }>;
  skipped: Array<{ taskId: string; type: AgentTaskType; status: AgentTaskStatus }>;
  message: string;
}

export async function enqueueScheduledAgentTasks(
  repository: AgentTaskSchedulerRepository,
  tasks: AgentTask[],
  options: { force?: boolean } = {}
): Promise<AgentTaskScheduleResult> {
  const inserted: AgentTaskScheduleResult["inserted"] = [];
  const skipped: AgentTaskScheduleResult["skipped"] = [];

  for (const task of tasks) {
    const existing = options.force ? null : await repository.findExistingTask(task.type, task.scheduledFor);
    if (existing) {
      skipped.push({ taskId: existing.id, type: task.type, status: existing.status });
      continue;
    }

    const created = await repository.insertTask(task);
    inserted.push({ taskId: created.id, type: task.type });
  }

  return {
    ok: true,
    inserted,
    skipped,
    message: `${inserted.length} tâche(s) mise(s) en file, ${skipped.length} doublon(s) évité(s).`
  };
}

export function createSupabaseAgentTaskSchedulerRepository(): AgentTaskSchedulerRepository | null {
  const client = createServerSupabaseClient();
  if (!client) return null;

  return {
    async findExistingTask(type, scheduledFor) {
      const start = startOfUtcDay(scheduledFor);
      const end = nextUtcDay(start);
      const { data, error } = await client
        .from("scout_agent_tasks")
        .select("id,status")
        .eq("type", type)
        .neq("status", "cancelled")
        .gte("scheduled_for", start)
        .lt("scheduled_for", end)
        .order("scheduled_for", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(`Lecture doublon agent_tasks impossible: ${error.message}`);
      return data ? ({ id: data.id, status: data.status } as ExistingScheduledTask) : null;
    },

    async insertTask(task) {
      const { data, error } = await client
        .from("scout_agent_tasks")
        .insert({
          type: task.type,
          status: "queued",
          title: task.title,
          summary: task.summary,
          recommendation: task.recommendation,
          payload: task.payload,
          scheduled_for: task.scheduledFor
        })
        .select("id")
        .single();

      if (error) throw new Error(`Insertion agent_tasks impossible: ${error.message}`);
      if (!data?.id) throw new Error("Insertion agent_tasks sans id retourné.");
      return { id: data.id };
    }
  };
}

function startOfUtcDay(value: string): string {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function nextUtcDay(value: string): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}
