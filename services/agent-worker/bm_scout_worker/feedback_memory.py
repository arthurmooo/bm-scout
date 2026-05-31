from __future__ import annotations

import re
import unicodedata
from hashlib import sha256
from dataclasses import dataclass, field
from urllib.parse import urlparse

from .schemas import FeedbackEvent, OutreachPack, QualityGate, ScoutLead

NEGATIVE_SECTOR_KEYWORDS = ("mauvais secteur", "hors icp", "trop petit", "douleur faible")
POSITIVE_SECTOR_KEYWORDS = ("tres bon", "très bon", "bon secteur", "fort potentiel")
ANGLE_KEYWORDS = (
    "deal-by-deal",
    "deal",
    "document",
    "documents",
    "reporting",
    "relance",
    "relances",
    "data room",
    "dataroom",
    "q&a",
    "pipeline",
    "crm",
    "collecte",
)


@dataclass
class ProviderFeedbackMemory:
    rejected_targets: set[str] = field(default_factory=set)
    do_not_contact_targets: set[str] = field(default_factory=set)
    target_reasons: dict[str, str] = field(default_factory=dict)
    segment_deltas: dict[str, int] = field(default_factory=dict)
    preferred_angles: list[str] = field(default_factory=list)
    generic_message_feedback: bool = False


def build_provider_feedback_memory(feedbacks: list[FeedbackEvent]) -> ProviderFeedbackMemory:
    memory = ProviderFeedbackMemory()
    for feedback in feedbacks:
        note = normalize(feedback.note)
        targets = feedback_targets(feedback)

        if feedback.kind == "do_not_contact":
            for target in targets:
                memory.do_not_contact_targets.add(target)
                memory.target_reasons[target] = "Do-not-contact issu du feedback Romu."

        if feedback.kind in {"bad_lead", "negative_outcome"} or "a exclure" in note or "à exclure" in note:
            for target in targets:
                memory.rejected_targets.add(target)
                memory.target_reasons[target] = "Lead déjà rejeté ou outcome négatif Romu : ne pas le remettre sans preuve nouvelle."

        if feedback.segment and (feedback.kind in {"bad_lead", "negative_outcome"} or has_keyword(note, NEGATIVE_SECTOR_KEYWORDS)):
            add_segment_delta(memory, feedback.segment, -18)

        if feedback.segment and (feedback.kind in {"good_lead", "positive_outcome"} or has_keyword(note, POSITIVE_SECTOR_KEYWORDS)):
            add_segment_delta(memory, feedback.segment, 6)

        if feedback.kind == "good_angle":
            memory.preferred_angles.extend(extract_angles(feedback.note))

        if feedback.kind == "generic_message" or "trop generique" in note or "trop générique" in note:
            memory.generic_message_feedback = True

    memory.preferred_angles = list(dict.fromkeys(memory.preferred_angles))
    return memory


def apply_provider_feedback_memory(lead: ScoutLead, memory: ProviderFeedbackMemory) -> ScoutLead:
    target = matching_target(lead, memory.do_not_contact_targets)
    if target:
        return block_do_not_contact(lead, memory.target_reasons.get(target))

    target = matching_target(lead, memory.rejected_targets)
    if target:
        return reject_from_feedback(lead, memory.target_reasons.get(target))

    updated = apply_segment_delta(lead, memory.segment_deltas.get(normalize(lead.segment), 0))
    updated = apply_preferred_angle(updated, memory.preferred_angles)
    if memory.generic_message_feedback:
        updated = rewrite_outreach_from_evidence(updated)
    return updated


def feedback_targets(feedback: FeedbackEvent) -> set[str]:
    values = {
        feedback.lead_id,
        feedback.company_name,
        feedback.website,
        domain_key(feedback.website or ""),
        feedback.normalized_domain,
        feedback.normalized_email_hash,
        feedback.contact_id,
    }
    return {normalize(value) for value in values if value}


def matching_target(lead: ScoutLead, targets: set[str]) -> str | None:
    candidates = {
        normalize(lead.id),
        normalize(lead.company),
        normalize(lead.website),
        normalize(domain_key(lead.website)),
        *persona_targets(lead),
    }
    return next((target for target in targets if target in candidates), None)


def persona_targets(lead: ScoutLead) -> set[str]:
    values: set[str] = set()
    for persona in lead.personas:
        if persona.email:
            values.add(normalize(persona.email))
            values.add(email_hash(persona.email))
    return values


def email_hash(email: str) -> str:
    return sha256(email.strip().lower().encode("utf-8")).hexdigest()


def add_segment_delta(memory: ProviderFeedbackMemory, segment: str, delta: int) -> None:
    key = normalize(segment)
    memory.segment_deltas[key] = clamp_delta(memory.segment_deltas.get(key, 0) + delta)


def apply_segment_delta(lead: ScoutLead, delta: int) -> ScoutLead:
    if delta == 0:
        return lead
    score = clamp_score(lead.score + delta)
    direction = "bonus" if delta > 0 else "pénalité"
    return lead.model_copy(
        update={
            "score": score,
            "score_justification": f"{lead.score_justification} Mémoire Romu : {direction} segment {lead.segment} ({delta:+d}).",
            "next_action": (
                f"{lead.next_action} Segment renforcé par feedback Romu."
                if delta > 0
                else f"{lead.next_action} Vérifier que ce segment mérite encore l'attention avant enrichissement."
            ),
        }
    )


def apply_preferred_angle(lead: ScoutLead, preferred_angles: list[str]) -> ScoutLead:
    angle = next((item for item in preferred_angles if normalize(item) in lead_haystack(lead)), None)
    if not angle:
        return lead
    return lead.model_copy(
        update={
            "score": clamp_score(lead.score + 5),
            "score_justification": f"{lead.score_justification} Angle validé Romu renforcé : {angle}.",
            "next_action": f"{lead.next_action} Réutiliser l'angle validé Romu : {angle}.",
        }
    )


def rewrite_outreach_from_evidence(lead: ScoutLead) -> ScoutLead:
    if lead.outreach.cold_email.lower().startswith("brouillon blo"):
        return lead
    observed = lead.observed_signals[0] if lead.observed_signals else (lead.evidence[0].observed_fact if lead.evidence else "")
    if not observed:
        return lead
    outreach = lead.outreach.model_copy(
        update={
            "cold_email": (
                f"Bonjour,\n\nJ'ai relevé un signal public précis chez {lead.company} : {observed}\n\n"
                "Je suis Arthur de BM Automation. Hypothèse prudente : une partie du suivi associé repasse encore "
                "entre emails, fichiers, documents ou reporting existants.\n\n"
                "Est-ce utile de vérifier un seul workflow concret, sans remplacer vos outils ? Si vous ne souhaitez pas être recontacté, dites-le simplement."
            )
        }
    )
    return lead.model_copy(
        update={
            "outreach": outreach,
            "score_justification": f"{lead.score_justification} Mémoire Romu : message régénéré après feedback anti-générique.",
        }
    )


def reject_from_feedback(lead: ScoutLead, reason: str | None) -> ScoutLead:
    reason = reason or "Lead déjà rejeté par Romu."
    return lead.model_copy(
        update={
            "verdict": "reject",
            "quality_decision": "blocked",
            "score": min(lead.score, 15),
            "outreach": blocked_outreach("lead déjà rejeté par Romu"),
            "quality_gates": feedback_quality_gates(lead, reason),
            "next_action": "Ne pas remettre ce lead dans la shortlist sans preuve nouvelle et justification explicite.",
            "rejection_reason": reason,
        }
    )


def block_do_not_contact(lead: ScoutLead, reason: str | None) -> ScoutLead:
    reason = reason or "Do-not-contact issu du feedback Romu."
    return lead.model_copy(
        update={
            "verdict": "reject",
            "quality_decision": "blocked",
            "score": 0,
            "personas": [persona.model_copy(update={"do_not_contact": True}) for persona in lead.personas],
            "outreach": blocked_outreach("do-not-contact"),
            "quality_gates": feedback_quality_gates(lead, reason),
            "next_action": "Bloqué do-not-contact : aucune relance autorisée.",
            "rejection_reason": reason,
        }
    )


def blocked_outreach(reason: str) -> OutreachPack:
    return OutreachPack(
        cold_email=f"Brouillon bloqué : {reason}.",
        follow_up=f"Brouillon bloqué : {reason}.",
        linkedin=f"Brouillon bloqué : {reason}.",
    )


def feedback_quality_gates(lead: ScoutLead, reason: str) -> list[QualityGate]:
    return [
        *[gate for gate in lead.quality_gates if gate.code != "feedback_memory"],
        QualityGate(code="feedback_memory", passed=False, reason=reason),
    ]


def lead_haystack(lead: ScoutLead) -> str:
    return normalize(
        " ".join(
            [
                lead.segment,
                lead.score_justification,
                lead.deep_card,
                lead.next_action,
                lead.outreach.cold_email,
                *lead.observed_signals,
                *lead.pain_hypotheses,
            ]
        )
    )


def extract_angles(note: str) -> list[str]:
    normalized = normalize(note)
    explicit = [keyword for keyword in ANGLE_KEYWORDS if keyword in normalized]
    if explicit:
        return explicit
    return [part.strip() for part in re.split(r"[,.;/]+", note) if len(part.strip()) >= 6][:2]


def has_keyword(value: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in value for keyword in keywords)


def clamp_score(score: int) -> int:
    return max(0, min(100, score))


def clamp_delta(delta: int) -> int:
    return max(-35, min(18, delta))


def normalize(value: str) -> str:
    return unicodedata.normalize("NFD", str(value)).encode("ascii", "ignore").decode("ascii").lower()


def domain_key(url: str) -> str:
    parsed = urlparse(url)
    return parsed.netloc.lower().removeprefix("www.") if parsed.netloc else ""
