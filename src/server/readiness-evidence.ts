export interface RunnerStepEvidence {
  step?: string;
  event_type?: string;
  payload?: Record<string, unknown>;
}

export interface RunnerRuntimeEvidence {
  source: string;
  runtimeProvider: string;
  feedbackEventCount: number;
  doNotContactEventCount: number;
  feedbackImpactCount: number;
  feedbackScoreChangedCount: number;
  feedbackBlockedCount: number;
  feedbackDncBlockedCount: number;
  feedbackMessageRegeneratedCount: number;
  feedbackAngleReinforcedCount: number;
  feedbackSegmentDeltaCount: number;
  persistComplete: boolean;
  runtimeMetadataComplete: boolean;
  runtimeRevisionMatchesCurrent: boolean;
  runtimeCodeRevision: string;
  runtimeDurationMs: number;
  runtimeModel: string;
}

export interface SupabaseRuntimeArtifactEvidence {
  status?: string;
  generated_at?: string;
  source?: string;
  code_revision?: string;
  runCount?: number;
  leadCount?: number;
  rejectedCount?: number;
  lessonCount?: number;
  taskCount?: number;
  feedbackCount?: number;
  outcomeCount?: number;
  dncCount?: number;
  runStepCount?: number;
  actionEventCount?: number;
  persistenceDedupeVerified?: boolean;
  persistenceDedupeCompanyCount?: number;
  persistenceDedupeRetainedMode?: string | null;
  persistenceDedupeRunStepCount?: number;
  persistenceDedupeCleanupRemainingCompanies?: number;
  persistenceDedupeCleanupRemainingRuns?: number;
  persistenceDedupeTraceIds?: string[];
  traces?: string[];
  blockers?: string[];
  error?: string;
}

export interface SupabaseRuntimeEvidenceAnalysis {
  verdict: "pass" | "fail";
  runtimeMetadataComplete: boolean;
  runtimeRevisionMatchesCurrent: boolean;
  codeRevision: string;
  blockers: string[];
  traces: string[];
  source: string;
}

export interface AgentTaskCronArtifactEvidence {
  status?: string;
  generated_at?: string;
  source?: string;
  mode?: string;
  code_revision?: string;
  github_run_id?: string;
  github_sha?: string;
  has_supabase_env?: boolean;
  has_openai_env?: boolean;
  dueCount?: number;
  insertedCount?: number;
  skippedCount?: number;
  processedCount?: number;
  completedCount?: number;
  blockedCount?: number;
  failedCount?: number;
  recoveredCount?: number;
  requiredTaskTypes?: string[];
  taskTypes?: string[];
  completedTaskTypes?: string[];
  workerTraceTaskTypes?: string[];
  missingScheduledTaskTypes?: string[];
  missingCompletedTaskTypes?: string[];
  missingWorkerTraceTaskTypes?: string[];
  traceIds?: string[];
  blockers?: string[];
  error?: string;
}

export interface AgentTaskCronEvidenceAnalysis {
  verdict: "pass" | "fail";
  runtimeMetadataComplete: boolean;
  runtimeRevisionMatchesCurrent: boolean;
  codeRevision: string;
  blockers: string[];
  source: string;
  mode: string;
  traceIds: string[];
}

export function analyzeRunnerSteps(steps: RunnerStepEvidence[], currentCodeRevision: string): RunnerRuntimeEvidence {
  const runnerStep = steps.find((step) => step.step === "runner_complete");
  const payload = runnerStep?.payload ?? {};
  const source = typeof payload.feedback_memory_source === "string" ? payload.feedback_memory_source : "unknown";
  const declaredProvider = stringValue(payload.bm_scout_provider) || "unknown";
  const runtimeProvider = detectResearchProvider(steps, declaredProvider);
  const feedbackCount = Number(payload.feedback_event_count ?? 0);
  const dncCount = Number(payload.do_not_contact_event_count ?? 0);
  const durationMs = Number(payload.duration_ms ?? 0);
  const codeRevision = stringValue(payload.code_revision);
  const model = stringValue(payload.openai_model);
  const metadataComplete = hasCompleteRuntimeMetadata(payload, durationMs, codeRevision);
  const feedbackImpactCount = stepNumber(steps, "feedback_memory_effects", "impact_count");
  const feedbackScoreChangedCount = stepNumber(steps, "feedback_memory_effects", "score_changed_count");
  const feedbackBlockedCount = stepNumber(steps, "feedback_memory_effects", "blocked_count");
  const feedbackDncBlockedCount = stepNumber(steps, "feedback_memory_effects", "blocked_do_not_contact_count");
  const feedbackMessageRegeneratedCount = stepNumber(steps, "feedback_memory_effects", "message_regenerated_count");
  const feedbackAngleReinforcedCount = stepNumber(steps, "feedback_memory_effects", "angle_reinforced_count");
  const feedbackSegmentDeltaCount = stepNumber(steps, "feedback_memory_effects", "segment_delta_count");

  return {
    source,
    runtimeProvider,
    feedbackEventCount: Number.isFinite(feedbackCount) ? feedbackCount : 0,
    doNotContactEventCount: Number.isFinite(dncCount) ? dncCount : 0,
    feedbackImpactCount,
    feedbackScoreChangedCount,
    feedbackBlockedCount,
    feedbackDncBlockedCount,
    feedbackMessageRegeneratedCount,
    feedbackAngleReinforcedCount,
    feedbackSegmentDeltaCount,
    persistComplete: steps.some((step) => step.step === "persist_complete" && step.event_type === "supabase_persist"),
    runtimeMetadataComplete: metadataComplete,
    runtimeRevisionMatchesCurrent: metadataComplete && codeRevisionMatchesCurrent(codeRevision, currentCodeRevision),
    runtimeCodeRevision: codeRevision || "unknown",
    runtimeDurationMs: Number.isFinite(durationMs) ? durationMs : 0,
    runtimeModel: model || "unknown"
  };
}

export function analyzeSupabaseRuntimeArtifact(
  payload: SupabaseRuntimeArtifactEvidence,
  currentCodeRevision: string
): SupabaseRuntimeEvidenceAnalysis {
  const codeRevision = stringValue(payload.code_revision);
  const blockers = Array.isArray(payload.blockers) ? payload.blockers.filter((item): item is string => typeof item === "string") : [];
  const persistenceDedupeComplete = hasPersistenceDedupeProof(payload);
  const derivedBlockers = [
    ...blockers,
    ...(!persistenceDedupeComplete ? ["Preuve Supabase manquante: la RPC ne prouve pas la fusion par domaine avec priorité Core et cleanup."] : [])
  ];
  const runtimeMetadataComplete = Boolean(
    stringValue(payload.generated_at) &&
      codeRevision &&
      numericAtLeast(payload.runCount, 1) &&
      numericAtLeast(payload.leadCount, 1) &&
      numericAtLeast(payload.rejectedCount, 1) &&
      numericAtLeast(payload.lessonCount, 3) &&
      numericAtLeast(payload.taskCount, 1) &&
      numericAtLeast(payload.feedbackCount, 1) &&
      numericAtLeast(payload.outcomeCount, 1) &&
      numericAtLeast(payload.dncCount, 1) &&
      numericAtLeast(payload.runStepCount, 1) &&
      numericAtLeast(payload.actionEventCount, 1) &&
      persistenceDedupeComplete &&
      Array.isArray(payload.traces) &&
      payload.traces.length > 0
  );
  const runtimeRevisionMatchesCurrent = runtimeMetadataComplete && codeRevisionMatchesCurrent(codeRevision, currentCodeRevision);

  return {
    verdict: payload.status === "pass" && runtimeMetadataComplete && runtimeRevisionMatchesCurrent ? "pass" : "fail",
    runtimeMetadataComplete,
    runtimeRevisionMatchesCurrent,
    codeRevision: codeRevision || "unknown",
    blockers: derivedBlockers,
    traces: Array.isArray(payload.traces) ? payload.traces.filter((item): item is string => typeof item === "string") : [],
    source: stringValue(payload.source) || "artifact"
  };
}

export function analyzeAgentTaskCronArtifact(
  payload: AgentTaskCronArtifactEvidence,
  currentCodeRevision: string
): AgentTaskCronEvidenceAnalysis {
  const codeRevision = stringValue(payload.code_revision);
  const blockers = Array.isArray(payload.blockers) ? payload.blockers.filter((item): item is string => typeof item === "string") : [];
  const source = stringValue(payload.source) || "artifact";
  const mode = stringValue(payload.mode) || "unknown";
  const scheduledTaskTypes = stringArray(payload.taskTypes);
  const completedTaskTypes = stringArray(payload.completedTaskTypes);
  const workerTraceTaskTypes = stringArray(payload.workerTraceTaskTypes);
  const cronCoversAllP0Routines =
    hasAllValues(scheduledTaskTypes, P0_AGENT_TASK_TYPES) &&
    hasAllValues(completedTaskTypes, P0_AGENT_TASK_TYPES) &&
    hasAllValues(workerTraceTaskTypes, P0_WORKER_AGENT_TASK_TYPES);
  const derivedBlockers = [
    ...blockers,
    ...(!cronCoversAllP0Routines
      ? ["Cron agent_tasks sans preuve complète des 6 routines P0 et des traces worker Core/Exploration."]
      : [])
  ];
  const runtimeMetadataComplete = Boolean(
    stringValue(payload.generated_at) &&
      codeRevision &&
      source === "github_actions" &&
      mode === "real" &&
      stringValue(payload.github_run_id) &&
      stringValue(payload.github_sha) &&
      payload.has_supabase_env === true &&
      payload.has_openai_env === true &&
      numericAtLeast(payload.dueCount, 1) &&
      numericAtLeast(payload.insertedCount, 0) &&
      numericAtLeast(payload.skippedCount, 0) &&
      numericAtLeast(payload.processedCount, 1) &&
      numericAtLeast(payload.completedCount, 1) &&
      numericAtLeast(payload.blockedCount, 0) &&
      numericAtLeast(payload.failedCount, 0) &&
      numericAtLeast(payload.recoveredCount, 0) &&
      Array.isArray(payload.taskTypes) &&
      payload.taskTypes.length > 0 &&
      Array.isArray(payload.completedTaskTypes) &&
      payload.completedTaskTypes.length > 0 &&
      cronCoversAllP0Routines
  );
  const runtimeRevisionMatchesCurrent = runtimeMetadataComplete && codeRevisionMatchesCurrent(codeRevision, currentCodeRevision);
  const cleanExecution =
    numberValue(payload.blockedCount) === 0 && numberValue(payload.failedCount) === 0 && numberValue(payload.recoveredCount) === 0;

  return {
    verdict: payload.status === "pass" && runtimeMetadataComplete && runtimeRevisionMatchesCurrent && cleanExecution ? "pass" : "fail",
    runtimeMetadataComplete,
    runtimeRevisionMatchesCurrent,
    codeRevision: codeRevision || "unknown",
    blockers: derivedBlockers,
    source,
    mode,
    traceIds: Array.isArray(payload.traceIds) ? payload.traceIds.filter((item): item is string => typeof item === "string") : []
  };
}

const P0_AGENT_TASK_TYPES = [
  "weekly_core_research",
  "weekly_exploration_scan",
  "daily_brief",
  "learning_review",
  "dnc_check",
  "followup_review"
];

const P0_WORKER_AGENT_TASK_TYPES = ["weekly_core_research", "weekly_exploration_scan"];

export function codeRevisionMatchesCurrent(artifactRevision: string, currentRevision: string): boolean {
  const artifact = normalizeRevision(artifactRevision);
  const current = normalizeRevision(currentRevision);
  if (!artifact || !current || artifact === "unknown" || current === "unknown") return false;
  if (artifact.includes("-dirty") || current.includes("-dirty")) return false;
  if (artifact === current) return true;
  if (artifact.length < 7 || current.length < 7) return false;
  return artifact.startsWith(current) || current.startsWith(artifact);
}

export function eligibleRuntimeVerdict(
  rawVerdict: string | undefined,
  runtimeMetadataComplete: boolean,
  runtimeRevisionMatchesCurrent: boolean
): "pass" | "fail" {
  return rawVerdict === "pass" && runtimeMetadataComplete && runtimeRevisionMatchesCurrent ? "pass" : "fail";
}

function hasCompleteRuntimeMetadata(payload: Record<string, unknown>, durationMs: number, codeRevision: string): boolean {
  return Boolean(
    payload.real_mode === true &&
      stringValue(payload.started_at) &&
      stringValue(payload.completed_at) &&
      Number.isFinite(durationMs) &&
      durationMs >= 0 &&
      stringValue(payload.python_version) &&
      knownString(payload.openai_agents_version) &&
      knownString(payload.openai_sdk_version) &&
      codeRevision
  );
}

function knownString(value: unknown): string {
  const text = stringValue(value);
  return text === "unknown" ? "" : text;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function hasAllValues(values: string[], required: string[]): boolean {
  const set = new Set(values);
  return required.every((item) => set.has(item));
}

function numericAtLeast(value: unknown, minimum: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function hasPersistenceDedupeProof(payload: SupabaseRuntimeArtifactEvidence): boolean {
  return Boolean(
    payload.persistenceDedupeVerified === true &&
      payload.persistenceDedupeCompanyCount === 1 &&
      payload.persistenceDedupeRetainedMode === "core" &&
      numericAtLeast(payload.persistenceDedupeRunStepCount, 1) &&
      payload.persistenceDedupeCleanupRemainingCompanies === 0 &&
      payload.persistenceDedupeCleanupRemainingRuns === 0
  );
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stepNumber(steps: RunnerStepEvidence[], stepName: string, key: string): number {
  return steps
    .filter((step) => step.step === stepName)
    .reduce((sum, step) => sum + numberValue(step.payload?.[key]), 0);
}

function detectResearchProvider(steps: RunnerStepEvidence[], declaredProvider: string): string {
  if (steps.some((step) => step.step === "demo_fixture_batch")) return "demo";
  if (steps.some((step) => step.step === "openai_web_search")) return "openai_web";
  if (steps.some((step) => step.step === "serpapi_search")) return "serpapi";
  if (steps.some((step) => step.step === "search_web" && numericAtLeast(step.payload?.discovered_count, 1))) return "web";
  if (steps.some((step) => step.step === "feedback_memory")) return "configured";
  return declaredProvider || "unknown";
}

function normalizeRevision(value: string): string {
  return value.trim().toLowerCase();
}
