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

function normalizeRevision(value: string): string {
  return value.trim().toLowerCase();
}
