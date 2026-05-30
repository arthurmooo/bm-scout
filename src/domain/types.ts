export type ScoutMode = "core" | "exploration";
export type LeadVerdict = "validate" | "enrich" | "watch" | "reject";
export type QualityDecision = "pass" | "needs_enrichment" | "blocked";
export type FeedbackKind = "good_lead" | "bad_lead" | "generic_message" | "good_angle" | "positive_outcome" | "negative_outcome" | "do_not_contact";

export interface Evidence {
  label: string;
  url: string;
  observedFact: string;
  reliability: "high" | "medium" | "low";
}

export interface Persona {
  name?: string;
  role: string;
  reason: string;
  contactConfidence: "confirmed" | "role_only" | "uncertain";
  doNotContact?: boolean;
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

export interface ScoutSnapshot {
  primaryLead: ScoutLead | null;
  queue: ScoutLead[];
  exploration: ScoutLead[];
  rejected: ScoutLead[];
  lessons: LearningLesson[];
  runs: ScoutRun[];
}
