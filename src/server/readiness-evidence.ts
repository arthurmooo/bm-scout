export interface RunnerStepEvidence {
  step?: string;
  event_type?: string;
  payload?: Record<string, unknown>;
}

export interface RunnerRuntimeEvidence {
  source: string;
  doNotContactEventCount: number;
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

export function analyzeRunnerSteps(steps: RunnerStepEvidence[], currentCodeRevision: string): RunnerRuntimeEvidence {
  const runnerStep = steps.find((step) => step.step === "runner_complete");
  const payload = runnerStep?.payload ?? {};
  const source = typeof payload.feedback_memory_source === "string" ? payload.feedback_memory_source : "unknown";
  const dncCount = Number(payload.do_not_contact_event_count ?? 0);
  const durationMs = Number(payload.duration_ms ?? 0);
  const codeRevision = stringValue(payload.code_revision);
  const model = stringValue(payload.openai_model);
  const metadataComplete = hasCompleteRuntimeMetadata(payload, durationMs, codeRevision);

  return {
    source,
    doNotContactEventCount: Number.isFinite(dncCount) ? dncCount : 0,
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
      Array.isArray(payload.traces) &&
      payload.traces.length > 0
  );
  const runtimeRevisionMatchesCurrent = runtimeMetadataComplete && codeRevisionMatchesCurrent(codeRevision, currentCodeRevision);

  return {
    verdict: payload.status === "pass" && runtimeMetadataComplete && runtimeRevisionMatchesCurrent ? "pass" : "fail",
    runtimeMetadataComplete,
    runtimeRevisionMatchesCurrent,
    codeRevision: codeRevision || "unknown",
    blockers,
    traces: Array.isArray(payload.traces) ? payload.traces.filter((item): item is string => typeof item === "string") : [],
    source: stringValue(payload.source) || "artifact"
  };
}

export function codeRevisionMatchesCurrent(artifactRevision: string, currentRevision: string): boolean {
  const artifact = normalizeRevision(artifactRevision);
  const current = normalizeRevision(currentRevision);
  if (!artifact || !current || artifact === "unknown" || current === "unknown") return false;
  if (artifact.includes("-dirty") || current.includes("-dirty")) return false;
  if (artifact === current) return true;
  if (artifact.length < 7 || current.length < 7) return false;
  return artifact.startsWith(current) || current.startsWith(artifact);
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

function numericAtLeast(value: unknown, minimum: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function normalizeRevision(value: string): string {
  return value.trim().toLowerCase();
}
