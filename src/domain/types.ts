export type ScoutMode = "core" | "exploration";
export type LeadVerdict = "validate" | "enrich" | "watch" | "reject";
export type QualityDecision = "pass" | "needs_enrichment" | "blocked";
export type FeedbackKind = "good_lead" | "bad_lead" | "generic_message" | "good_angle" | "positive_outcome" | "negative_outcome" | "do_not_contact";
export type ProductReadiness = "demo_ready" | "pilot_candidate" | "production_not_ready" | "ready_for_internal_test_only";
export type AgentTaskStatus = "queued" | "running" | "blocked" | "completed" | "failed" | "cancelled";
export type AgentTaskType =
  | "weekly_core_research"
  | "weekly_exploration_scan"
  | "daily_brief"
  | "learning_review"
  | "dnc_check"
  | "followup_review";
export type LeadActionType =
  | "validate_lead"
  | "reject_lead"
  | "watch_lead"
  | "exclude_lead"
  | "request_enrichment"
  | "rerun_qc"
  | "copy_email"
  | "copy_follow_up"
  | "copy_linkedin"
  | "mark_message_used"
  | "add_do_not_contact"
  | "launch_core"
  | "launch_exploration"
  | "launch_daily_brief"
  | "launch_learning_review";

export interface Evidence {
  id?: string;
  label: string;
  url: string;
  observedFact: string;
  reliability: "high" | "medium" | "low";
}

export interface ObservedInsight {
  text: string;
  evidenceId: string;
}

export interface StructuredInsights {
  observed: ObservedInsight[];
  inferred: string[];
  uncertain: string[];
}

export interface Persona {
  name?: string;
  role: string;
  reason: string;
  contactConfidence: "confirmed" | "role_only" | "uncertain";
  doNotContact?: boolean;
  email?: string;
  emailType?: "public_named" | "generic" | "probable_pattern" | "unknown";
  emailSourceUrl?: string;
  emailConfidence?: "high" | "medium" | "low";
  emailStatus?: "usable" | "verify" | "not_usable";
}

export interface OutreachPack {
  coldEmail: string;
  followUp: string;
  linkedin: string;
}

export interface QualityGate {
  code: string;
  passed: boolean;
  reason: string;
}

export interface ScoutLead {
  id: string;
  company: string;
  website: string;
  mode: ScoutMode;
  segment: string;
  score: number;
  verdict: LeadVerdict;
  qualityDecision: QualityDecision;
  observedSignals: string[];
  painHypotheses: string[];
  scoreJustification: string;
  shortCard: string;
  deepCard: string;
  personas: Persona[];
  evidence: Evidence[];
  insights?: StructuredInsights;
  outreach: OutreachPack;
  qualityGates: QualityGate[];
  nextAction: string;
  rejectionReason?: string;
}

export interface ScoutRun {
  id: string;
  mode: ScoutMode;
  status: "succeeded" | "failed";
  createdAt: string;
  traceId: string;
  scannedCount: number;
  keptCount: number;
  rejectedCount: number;
  leads: ScoutLead[];
  rejected: ScoutLead[];
  lessons: LearningLesson[];
}

export interface LearningLesson {
  id: string;
  lesson: string;
  recommendation: string;
  source: string;
  confidence: number;
}

export interface FeedbackEvent {
  id: string;
  leadId: string;
  kind: FeedbackKind;
  note: string;
  createdAt: string;
}

export interface RoutineConfig {
  coreWeeklyTarget: number;
  explorationScanTarget: number;
  explorationShortlistTarget: number;
}

export interface AgentTask {
  id: string;
  type: AgentTaskType;
  status: AgentTaskStatus;
  title: string;
  summary: string;
  recommendation: string;
  payload: RoutineConfig;
  createdAt: string;
  scheduledFor: string;
  startedAt?: string;
  completedAt?: string;
  resultRunId?: string;
  blockedReason?: string;
  errorMessage?: string;
}

export interface ScoutBriefSummary {
  completed: string[];
  recommended: string[];
  blocked: string[];
}

export interface ScoutSnapshot {
  primaryLead: ScoutLead | null;
  queue: ScoutLead[];
  exploration: ScoutLead[];
  rejected: ScoutLead[];
  lessons: LearningLesson[];
  runs: ScoutRun[];
  tasks: AgentTask[];
  brief: ScoutBriefSummary;
  readiness: ProductReadiness;
}
