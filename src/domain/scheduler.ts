import type { AgentTask, AgentTaskStatus, AgentTaskType, RoutineConfig, ScoutBriefSummary, ScoutRun } from "./types";

export const DEFAULT_ROUTINE_CONFIG: RoutineConfig = {
  coreWeeklyTarget: 15,
  explorationScanTarget: 100,
  explorationShortlistTarget: 12
};

const TASK_META: Record<AgentTaskType, { title: string; summary: string; recommendation: string; offsetHours: number }> = {
  weekly_core_research: {
    title: "Recherche Core BM hebdo",
    summary: "Trouver les meilleurs comptes M&A/finance ops et préparer les fiches prioritaires.",
    recommendation: "Lancer en début de semaine, puis faire valider uniquement les comptes passés QC.",
    offsetHours: 0
  },
  weekly_exploration_scan: {
    title: "Scan Exploration hebdo",
    summary: "Scanner plus large, écarter le bruit et produire une shortlist sans message direct.",
    recommendation: "Ne promouvoir un secteur opportuniste que si les signaux publics sont concrets.",
    offsetHours: 1
  },
  daily_brief: {
    title: "Brief quotidien Romu",
    summary: "Résumer ce qui a été fait, ce qui est recommandé et ce qui bloque.",
    recommendation: "Afficher seulement les décisions qui changent l'action commerciale du jour.",
    offsetHours: 2
  },
  learning_review: {
    title: "Learning review",
    summary: "Transformer feedbacks, outcomes et QC en apprentissages opérationnels.",
    recommendation: "Réinjecter les secteurs faibles, angles validés et DNC dans le prochain scoring.",
    offsetHours: 3
  },
  dnc_check: {
    title: "Contrôle do-not-contact",
    summary: "Vérifier que contacts, domaines et outcomes négatifs bloquent toute relance.",
    recommendation: "Bloquer avant génération de message, pas après affichage.",
    offsetHours: 4
  },
  followup_review: {
    title: "Revue relances",
    summary: "Identifier les relances autorisées à copier, sans aucun envoi automatique.",
    recommendation: "Ne proposer une relance que si le contact n'est pas DNC et si l'angle reste spécifique.",
    offsetHours: 5
  }
};

export function createScheduledTasks(
  now: Date = new Date(),
  config: RoutineConfig = DEFAULT_ROUTINE_CONFIG
): AgentTask[] {
  return (Object.keys(TASK_META) as AgentTaskType[]).map((type) =>
    createTask(type, {
      status: "queued",
      now,
      config,
      scheduledFor: withOffset(now, TASK_META[type].offsetHours)
    })
  );
}

export function createDueScheduledTasks(
  now: Date = new Date(),
  config: RoutineConfig = DEFAULT_ROUTINE_CONFIG,
  options: { task?: AgentTaskType; timeZone?: string } = {}
): AgentTask[] {
  const tasks = createScheduledTasks(now, config);
  if (options.task) return tasks.filter((task) => task.type === options.task);
  return tasks.filter((task) => isRoutineDue(task.type, now, options.timeZone));
}

export function isRoutineDue(type: AgentTaskType, now: Date = new Date(), timeZone = "Europe/Paris"): boolean {
  const weekday = weekdayName(now, timeZone);
  const isBusinessDay = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  if (!isBusinessDay) return false;

  if (type === "weekly_core_research" || type === "weekly_exploration_scan" || type === "learning_review") {
    return weekday === "Mon";
  }

  return type === "daily_brief" || type === "dnc_check" || type === "followup_review";
}

export function buildTasksFromRuns(
  runs: ScoutRun[],
  now: Date = new Date(),
  config: RoutineConfig = DEFAULT_ROUTINE_CONFIG
): AgentTask[] {
  const coreRun = latestRun(runs, "core");
  const explorationRun = latestRun(runs, "exploration");
  const inferredTasks: AgentTask[] = [];

  if (coreRun) {
    inferredTasks.push(
      createTask("weekly_core_research", {
        status: "completed",
        now,
        config,
        scheduledFor: coreRun.createdAt,
        completedAt: coreRun.createdAt,
        resultRunId: coreRun.id,
        summary: `${coreRun.keptCount} comptes Core retenus sur ${coreRun.scannedCount} analysés. Objectif hebdo paramétré : ${config.coreWeeklyTarget}.`
      })
    );
  }

  if (explorationRun) {
    inferredTasks.push(
      createTask("weekly_exploration_scan", {
        status: "completed",
        now,
        config,
        scheduledFor: explorationRun.createdAt,
        completedAt: explorationRun.createdAt,
        resultRunId: explorationRun.id,
        summary: `${explorationRun.keptCount} comptes Exploration shortlistés sur ${explorationRun.scannedCount} analysés. Objectif scan paramétré : ${config.explorationScanTarget}.`
      })
    );
  }

  inferredTasks.push(
    createTask("daily_brief", {
      status: runs.length ? "queued" : "blocked",
      now,
      config,
      scheduledFor: now.toISOString(),
      summary: runs.length
        ? "Brief calculé à l'affichage depuis les runs disponibles. La routine persistée reste à lancer."
        : undefined,
      blockedReason: runs.length ? undefined : "Aucun run persistant disponible pour construire le brief."
    })
  );

  inferredTasks.push(
    createTask("learning_review", {
      status: runs.some((run) => run.lessons.length >= 3) ? "queued" : "blocked",
      now,
      config,
      scheduledFor: now.toISOString(),
      summary: runs.some((run) => run.lessons.length >= 3)
        ? "Apprentissages visibles depuis les runs. La routine learning persistée reste à lancer."
        : undefined,
      blockedReason: runs.some((run) => run.lessons.length >= 3)
        ? undefined
        : "Pas assez de feedbacks/outcomes persistés pour une synthèse fiable."
    })
  );

  const presentTypes = new Set(inferredTasks.map((task) => task.type));
  return [
    ...inferredTasks,
    ...createScheduledTasks(now, config).filter((task) => !presentTypes.has(task.type))
  ].sort((a, b) => taskRank(a.type) - taskRank(b.type));
}

export function buildBriefSummary(tasks: AgentTask[], runs: ScoutRun[]): ScoutBriefSummary {
  const completed = tasks
    .filter((task) => task.status === "completed")
    .slice(0, 4)
    .map((task) => task.summary);
  const blocked = tasks
    .filter((task) => task.status === "blocked" || task.status === "failed")
    .slice(0, 3)
    .map((task) => task.blockedReason ?? task.errorMessage ?? task.summary);
  const recommended = [
    ...[recommendationFromRuns(runs)].flatMap((item) => (item ? [item] : [])),
    ...tasks
      .filter((task) => task.status === "queued")
      .slice(0, 2)
      .map((task) => task.recommendation)
  ];

  return {
    completed: completed.length ? completed : ["Aucun run persistant récent. Lancer une routine ou connecter Supabase."],
    recommended: recommended.length ? recommended : ["Brancher une routine Core ou Exploration pour produire une recommandation actionnable."],
    blocked
  };
}

export function routineTypeForAction(action: string): AgentTaskType | null {
  if (action === "launch_core") return "weekly_core_research";
  if (action === "launch_exploration") return "weekly_exploration_scan";
  if (action === "launch_daily_brief") return "daily_brief";
  if (action === "launch_learning_review") return "learning_review";
  return null;
}

function createTask(
  type: AgentTaskType,
  options: {
    status: AgentTaskStatus;
    now: Date;
    config: RoutineConfig;
    scheduledFor: string;
    summary?: string;
    completedAt?: string;
    resultRunId?: string;
    blockedReason?: string;
    errorMessage?: string;
  }
): AgentTask {
  const meta = TASK_META[type];
  return {
    id: `${type}-${options.scheduledFor.slice(0, 10)}`,
    type,
    status: options.status,
    title: meta.title,
    summary: options.summary ?? meta.summary,
    recommendation: meta.recommendation,
    payload: options.config,
    createdAt: options.now.toISOString(),
    scheduledFor: options.scheduledFor,
    completedAt: options.completedAt,
    resultRunId: options.resultRunId,
    blockedReason: options.blockedReason,
    errorMessage: options.errorMessage
  };
}

function withOffset(date: Date, hours: number): string {
  return zonedDateTimeToUtcISOString(date, 8 + hours, 15, "Europe/Paris");
}

function weekdayName(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(date);
}

function zonedDateTimeToUtcISOString(date: Date, hour: number, minute: number, timeZone: string): string {
  const parts = dateParts(date, timeZone);
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0));
  const offsetMs = timeZoneOffsetMs(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offsetMs).toISOString();
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = dateTimeParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  return asUtc - date.getTime();
}

function dateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day")
  };
}

function dateTimeParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
    hour: numberPart(parts, "hour"),
    minute: numberPart(parts, "minute"),
    second: numberPart(parts, "second")
  };
}

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Date part ${type} introuvable pour le scheduler.`);
  return parsed;
}

function latestRun(runs: ScoutRun[], mode: "core" | "exploration"): ScoutRun | undefined {
  return runs
    .filter((run) => run.mode === mode)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function recommendationFromRuns(runs: ScoutRun[]): string | null {
  const highest = runs.flatMap((run) => run.leads).sort((a, b) => b.score - a.score)[0];
  if (!highest) return null;
  return `Prioriser ${highest.company} : ${highest.nextAction}`;
}

function taskRank(type: AgentTaskType): number {
  return (Object.keys(TASK_META) as AgentTaskType[]).indexOf(type);
}
