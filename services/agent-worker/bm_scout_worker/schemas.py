from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ScoutMode = Literal["core", "exploration"]
LeadVerdict = Literal["validate", "enrich", "watch", "reject"]
QualityDecision = Literal["pass", "needs_enrichment", "blocked"]
FeedbackKind = Literal[
    "good_lead",
    "bad_lead",
    "generic_message",
    "good_angle",
    "positive_outcome",
    "negative_outcome",
    "do_not_contact",
]


class Evidence(BaseModel):
    label: str
    url: str
    observed_fact: str
    reliability: Literal["high", "medium", "low"] = "medium"


class Persona(BaseModel):
    name: str | None = None
    role: str
    reason: str
    contact_confidence: Literal["confirmed", "role_only", "uncertain"] = "role_only"
    do_not_contact: bool = False


class OutreachPack(BaseModel):
    cold_email: str
    follow_up: str
    linkedin: str


class QualityGate(BaseModel):
    code: str
    passed: bool
    reason: str


class ScoutLead(BaseModel):
    id: str
    company: str
    website: str = ""
    mode: ScoutMode
    segment: str
    score: int = Field(ge=0, le=100)
    verdict: LeadVerdict
    quality_decision: QualityDecision
    observed_signals: list[str]
    pain_hypotheses: list[str]
    score_justification: str
    short_card: str
    deep_card: str
    personas: list[Persona]
    evidence: list[Evidence]
    outreach: OutreachPack
    quality_gates: list[QualityGate]
    next_action: str
    rejection_reason: str | None = None


class LearningLesson(BaseModel):
    id: str
    lesson: str
    recommendation: str
    source: str
    confidence: float = Field(ge=0, le=1)


class FeedbackEvent(BaseModel):
    id: str
    lead_id: str
    kind: FeedbackKind
    note: str
    created_at: str


class MissionOutput(BaseModel):
    run_id: str
    mode: ScoutMode
    trace_id: str
    scanned_count: int = Field(ge=0)
    kept_count: int = Field(ge=0)
    rejected_count: int = Field(ge=0)
    leads: list[ScoutLead]
    rejected: list[ScoutLead]
    lessons: list[LearningLesson]
    final_decision: Literal["ready", "not_ready"]
    qualitative_report: str
