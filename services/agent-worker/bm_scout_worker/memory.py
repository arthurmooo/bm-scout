from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from .schemas import MissionOutput, ScoutLead


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    service_role_key: str

    @classmethod
    def from_env(cls) -> "SupabaseConfig | None":
        url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            return None
        return cls(url=url.rstrip("/"), service_role_key=key)


class SupabaseMemory:
    def __init__(self, config: SupabaseConfig):
        self.config = config

    def persist_output(self, output: MissionOutput) -> None:
        run = self.insert(
            "scout_runs",
            {
                "mode": output.mode,
                "status": "succeeded",
                "trace_id": output.trace_id,
                "structured_output": output.model_dump(mode="json"),
                "scanned_count": output.scanned_count,
                "kept_count": output.kept_count,
                "rejected_count": output.rejected_count,
            },
        )
        run_id = run["id"]
        for lead in [*output.leads, *output.rejected]:
            company = self._persist_company(lead, run_id)
            self._persist_children(lead, company["id"], run_id)
        for lesson in output.lessons:
            self.insert(
                "scout_learning_lessons",
                {
                    "lesson": lesson.lesson,
                    "recommendation": lesson.recommendation,
                    "source": "run_review",
                    "confidence": lesson.confidence,
                    "source_run_id": run_id,
                },
            )

    def _persist_company(self, lead: ScoutLead, run_id: str) -> dict[str, Any]:
        return self.insert(
            "scout_companies",
            {
                "external_id": lead.id,
                "name": lead.company,
                "website": lead.website,
                "mode": lead.mode,
                "segment": lead.segment,
                "score": lead.score,
                "verdict": lead.verdict,
                "quality_decision": lead.quality_decision,
                "observed_signals": lead.observed_signals,
                "pain_hypotheses": lead.pain_hypotheses,
                "score_justification": lead.score_justification,
                "next_action": lead.next_action,
                "rejection_reason": lead.rejection_reason,
                "latest_run_id": run_id,
            },
        )

    def _persist_children(self, lead: ScoutLead, company_id: str, run_id: str) -> None:
        contact_ids: list[str] = []
        for persona in lead.personas:
            contact = self.insert(
                "scout_contacts",
                {
                    "company_id": company_id,
                    "name": persona.name,
                    "role": persona.role,
                    "reason": persona.reason,
                    "confidence": persona.contact_confidence,
                    "do_not_contact": persona.do_not_contact,
                    "created_by_run_id": run_id,
                },
            )
            contact_ids.append(contact["id"])
        for proof in lead.evidence:
            self.insert(
                "scout_evidence",
                {
                    "company_id": company_id,
                    "label": proof.label,
                    "url": proof.url,
                    "observed_fact": proof.observed_fact,
                    "reliability": proof.reliability,
                    "source_terms_risk": "unknown",
                    "created_by_run_id": run_id,
                },
            )
        score = self.insert(
            "scout_scores",
            {
                "company_id": company_id,
                "score": lead.score,
                "verdict": lead.verdict,
                "breakdown": {"mode": lead.mode, "segment": lead.segment},
                "justification": lead.score_justification,
                "created_by_run_id": run_id,
            },
        )
        brief = self.insert(
            "scout_briefs",
            {
                "company_id": company_id,
                "short_card": lead.short_card,
                "deep_card": lead.deep_card,
                "facts": lead.observed_signals,
                "hypotheses": lead.pain_hypotheses,
                "created_by_run_id": run_id,
            },
        )
        _ = score
        for channel, body in (
            ("email", lead.outreach.cold_email),
            ("follow_up", lead.outreach.follow_up),
            ("linkedin", lead.outreach.linkedin),
        ):
            self.insert(
                "scout_messages",
                {
                    "company_id": company_id,
                    "contact_id": contact_ids[0] if contact_ids else None,
                    "brief_id": brief["id"],
                    "channel": channel,
                    "body": body,
                    "status": "blocked" if "Brouillon blo" in body else "proposed",
                    "created_by_run_id": run_id,
                },
            )
        self.insert(
            "scout_quality_reports",
            {
                "run_id": run_id,
                "company_id": company_id,
                "decision": lead.quality_decision,
                "gates": [gate.model_dump(mode="json") for gate in lead.quality_gates],
                "reason": lead.rejection_reason or lead.next_action,
                "blocker_code": next((gate.code for gate in lead.quality_gates if not gate.passed), None),
            },
        )

    def insert(self, table: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.config.url}/rest/v1/{table}"
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "apikey": self.config.service_role_key,
                "authorization": f"Bearer {self.config.service_role_key}",
                "content-type": "application/json",
                "prefer": "return=representation",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase insert failed for {table}: {error.code} {body}") from error
        if not data:
            raise RuntimeError(f"Supabase insert returned no row for {table}")
        return data[0]
