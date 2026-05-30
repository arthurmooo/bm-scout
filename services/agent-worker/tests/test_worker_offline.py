from __future__ import annotations

import asyncio
import json
from unittest.mock import patch

from bm_scout_worker.fixtures import offline_output
from bm_scout_worker.memory import SupabaseConfig, SupabaseMemory
from bm_scout_worker.quality import mission_blockers
from bm_scout_worker.runner import run_bm_scout_mission
from bm_scout_worker.schemas import OutreachPack, QualityGate, ScoutLead


def test_core_offline_produces_actionable_lead() -> None:
    output = offline_output("core")

    assert output.leads
    assert any(lead.verdict == "validate" and lead.quality_decision == "pass" for lead in output.leads)
    assert mission_blockers(output) == []


def test_exploration_does_not_generate_direct_outreach() -> None:
    output = offline_output("exploration")

    assert output.leads
    assert all("brouillon blo" in lead.outreach.cold_email.lower() for lead in output.leads)
    assert mission_blockers(output) == []


def test_qc_negative_blocks_weak_case() -> None:
    output = offline_output("exploration", include_weak=True)

    assert any(lead.id == "weak-studio-yoga" for lead in output.rejected)
    assert all(lead.id != "weak-studio-yoga" for lead in output.leads)
    assert mission_blockers(output) == []


def test_blocked_lead_cannot_remain_in_shortlist() -> None:
    output = offline_output("core")
    blocked = ScoutLead(
        id="blocked-core",
        company="Blocked Core",
        mode="core",
        segment="M&A",
        score=80,
        verdict="watch",
        quality_decision="blocked",
        observed_signals=["Signal"],
        pain_hypotheses=["Hypothèse"],
        score_justification="Justification",
        short_card="Court",
        deep_card="Profond",
        personas=[],
        evidence=[],
        outreach=OutreachPack(cold_email="Brouillon bloqué.", follow_up="Brouillon bloqué.", linkedin="Brouillon bloqué."),
        quality_gates=[QualityGate(code="qc", passed=False, reason="Bloqué")],
        next_action="Rejeter",
    )
    output.leads.append(blocked)

    assert "Blocked Core: lead bloqué encore présent dans la shortlist." in mission_blockers(output)


def test_runner_writes_artifact(tmp_path) -> None:
    output = asyncio.run(run_bm_scout_mission("core", artifacts_dir=tmp_path))

    assert (tmp_path / f"{output.run_id}.json").exists()


def test_supabase_memory_persists_output_through_atomic_rpc() -> None:
    output = offline_output("core")
    requests = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self):
            return json.dumps(output.run_id).encode("utf-8")

    def fake_urlopen(request, timeout):
        requests.append((request, timeout))
        return Response()

    memory = SupabaseMemory(SupabaseConfig(url="https://example.supabase.co", service_role_key="service"))
    with patch("urllib.request.urlopen", fake_urlopen):
        memory.persist_output(output)

    request, timeout = requests[0]
    assert timeout == 20
    assert request.full_url == "https://example.supabase.co/rest/v1/rpc/scout_persist_mission_output"
    assert request.get_method() == "POST"
    assert json.loads(request.data.decode("utf-8"))["payload"]["run_id"] == output.run_id


def test_supabase_memory_loads_feedback_and_outcomes() -> None:
    responses = [
        [
            {
                "id": "feedback-1",
                "company_id": "company-1",
                "kind": "good_angle",
                "note": "Angle validé par Romu.",
                "created_at": "2026-05-30T10:00:00+00:00",
            }
        ],
        [
            {
                "id": "outcome-1",
                "company_id": "company-1",
                "outcome": "interested",
                "note": "Réponse positive.",
                "occurred_at": "2026-05-30T11:00:00+00:00",
            }
        ],
    ]

    class Response:
        def __init__(self, payload):
            self.payload = payload

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self):
            return json.dumps(self.payload).encode("utf-8")

    def fake_urlopen(_request, timeout):
        assert timeout == 20
        return Response(responses.pop(0))

    memory = SupabaseMemory(SupabaseConfig(url="https://example.supabase.co", service_role_key="service"))
    with patch("urllib.request.urlopen", fake_urlopen):
        events = memory.load_feedback_events()

    assert [event.kind for event in events] == ["positive_outcome", "good_angle"]
    assert events[0].note == "Réponse positive."
