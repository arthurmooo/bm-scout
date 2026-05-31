from __future__ import annotations

from .schemas import MissionOutput, ScoutLead, StructuredInsights

GENERIC_TOKENS = (
    "comme la vôtre",
    "comme la votre",
    "avec l'ia",
    "automatiser votre business",
    "solution clé en main",
    "plateforme saas",
)


def lead_blockers(lead: ScoutLead) -> list[str]:
    blockers: list[str] = []
    if lead.quality_decision == "blocked":
        blockers.append(f"{lead.company}: lead bloqué encore présent dans la shortlist.")
        return blockers
    if lead.verdict == "reject":
        blockers.append(f"{lead.company}: lead rejeté encore présent dans la shortlist.")
        return blockers
    if any(persona.do_not_contact for persona in lead.personas):
        blockers.append(f"{lead.company}: do-not-contact encore présent dans la shortlist.")
    if not lead.evidence:
        blockers.append(f"{lead.company}: aucune source publique.")
    if not lead.observed_signals:
        blockers.append(f"{lead.company}: aucun signal observé.")
    if not has_sourced_observed_insights(lead):
        blockers.append(f"{lead.company}: insight Observé sans evidence_id sourcé.")
    if not lead.pain_hypotheses:
        blockers.append(f"{lead.company}: aucune hypothèse prudente.")
    if not lead.score_justification.strip():
        blockers.append(f"{lead.company}: score non justifié.")
    if lead.mode == "exploration" and "brouillon blo" not in lead.outreach.cold_email.lower():
        blockers.append(f"{lead.company}: Exploration ne doit pas produire de message direct.")
    if message_is_generic(lead.outreach.cold_email):
        blockers.append(f"{lead.company}: message générique.")
    return blockers


def mission_blockers(output: MissionOutput) -> list[str]:
    blockers = [blocker for lead in output.leads for blocker in lead_blockers(lead)]
    if output.mode == "core":
        core_leads = [lead for lead in output.leads if lead.mode == "core"]
        if len(core_leads) < 1:
            blockers.append("Core BM: aucun compte actionnable.")
        if not any(lead.verdict == "validate" for lead in core_leads):
            blockers.append("Core BM: aucun compte validable.")
    if output.mode == "exploration":
        if not output.leads:
            blockers.append("Exploration: shortlist vide.")
        if any("brouillon blo" not in lead.outreach.cold_email.lower() for lead in output.leads):
            blockers.append("Exploration: message direct détecté.")
    if not (3 <= len(output.lessons) <= 5):
        blockers.append("Learning: la synthèse doit contenir 3 à 5 apprentissages.")
    return blockers


def message_is_generic(message: str) -> bool:
    value = message.lower()
    if "brouillon blo" in value:
        return False
    return any(token in value for token in GENERIC_TOKENS)


def has_sourced_observed_insights(lead: ScoutLead) -> bool:
    insights = lead.insights or derive_structured_insights(lead)
    if not insights.observed:
        return False
    evidence_keys = {proof.url for proof in lead.evidence}
    evidence_keys.update(proof.label for proof in lead.evidence)
    return all(item.evidence_id and item.evidence_id in evidence_keys for item in insights.observed)


def derive_structured_insights(lead: ScoutLead) -> StructuredInsights:
    return StructuredInsights(
        observed=[
            {"text": signal, "evidence_id": lead.evidence[min(index, len(lead.evidence) - 1)].url if lead.evidence else ""}
            for index, signal in enumerate(lead.observed_signals)
        ],
        inferred=lead.pain_hypotheses,
        uncertain=(
            ["Décideur exact, email nominatif et outils internes à confirmer."]
            if any(persona.contact_confidence != "confirmed" or persona.email_status != "usable" for persona in lead.personas)
            else []
        ),
    )
