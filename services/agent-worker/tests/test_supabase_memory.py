from __future__ import annotations

import asyncio
import json
from hashlib import sha256
from unittest.mock import patch

from bm_scout_worker.fixtures import offline_output
from bm_scout_worker.memory import SupabaseConfig, SupabaseMemory, outcome_feedback_kind
from bm_scout_worker.providers import CompanySeed, ConfiguredWebResearchProvider
from bm_scout_worker.runner import run_bm_scout_mission
from bm_scout_worker.schemas import FeedbackEvent


def test_provider_feedback_memory_hard_blocks_dnc_domain_from_table() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="DNC Domain M&A", website="https://dnc-domain.example", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: "M&A transaction reporting document client team"
    feedbacks = [
        FeedbackEvent(
            id="dnc-domain",
            lead_id="dnc-domain.example",
            kind="do_not_contact",
            note="Domaine exclu via table do-not-contact.",
            created_at="2026-05-30T10:00:00+00:00",
            normalized_domain="dnc-domain.example",
        )
    ]

    lead = provider.build_candidates("core", feedback_events=feedbacks)[0]

    assert lead.quality_decision == "blocked"
    assert lead.rejection_reason == "Do-not-contact issu du feedback Romu."


def test_provider_feedback_memory_hard_blocks_dnc_email_hash() -> None:
    email = "ops@dnc-email.example"
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="DNC Email M&A", website="https://dnc-email.example", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: f"M&A transaction reporting document client team {email}"
    feedbacks = [
        FeedbackEvent(
            id="dnc-email",
            lead_id="hash-only",
            kind="do_not_contact",
            note="Email exclu via hash do-not-contact.",
            created_at="2026-05-30T10:00:00+00:00",
            normalized_email_hash=sha256(email.encode("utf-8")).hexdigest(),
        )
    ]

    lead = provider.build_candidates("core", feedback_events=feedbacks)[0]

    assert lead.quality_decision == "blocked"
    assert all(persona.do_not_contact for persona in lead.personas)


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


def test_runner_persist_payload_includes_persist_complete_step(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    payloads = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self):
            return json.dumps("ok").encode("utf-8")

    def fake_urlopen(request, timeout):
        assert timeout == 20
        payloads.append(json.loads(request.data.decode("utf-8"))["payload"])
        return Response()

    with patch("urllib.request.urlopen", fake_urlopen):
        output = asyncio.run(run_bm_scout_mission("core", persist=True))

    persisted_steps = payloads[0]["run_steps"]
    assert any(step["step"] == "persist_complete" and step["event_type"] == "supabase_persist" for step in persisted_steps)
    assert output.run_steps[-1].step == "persist_complete"


def test_supabase_memory_loads_feedback_outcomes_and_dnc() -> None:
    responses = [
        [
            {
                "id": "feedback-1",
                "company_id": "company-1",
                "kind": "good_angle",
                "note": "Angle validé par Romu.",
                "created_at": "2026-05-30T10:00:00+00:00",
                "scout_companies": {
                    "name": "Cambon Partners",
                    "segment": "Conseil M&A",
                    "website": "https://www.cambonpartners.com",
                },
            }
        ],
        [
            {
                "id": "outcome-1",
                "company_id": "company-1",
                "outcome": "interested",
                "note": "Réponse positive.",
                "occurred_at": "2026-05-30T11:00:00+00:00",
                "scout_companies": {
                    "name": "Cambon Partners",
                    "segment": "Conseil M&A",
                    "website": "https://www.cambonpartners.com",
                },
            }
        ],
        [
            {
                "id": "dnc-1",
                "scope": "domain",
                "normalized_email_hash": None,
                "normalized_domain": "blocked.example",
                "company_id": None,
                "contact_id": None,
                "reason": "Opt-out domaine.",
                "created_at": "2026-05-30T12:00:00+00:00",
                "scout_companies": None,
                "scout_contacts": None,
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

    assert [event.kind for event in events] == ["do_not_contact", "positive_outcome", "good_angle"]
    assert events[0].normalized_domain == "blocked.example"
    assert events[0].website == "https://blocked.example"
    assert events[1].note == "Réponse positive."
    assert events[1].company_name == "Cambon Partners"
    assert events[1].segment == "Conseil M&A"


def test_outcome_feedback_kind_keeps_non_blocking_outcomes_neutral() -> None:
    assert outcome_feedback_kind("interested", "Réponse positive.") == "positive_outcome"
    assert outcome_feedback_kind("meeting_booked", "RDV pris.") == "positive_outcome"
    assert outcome_feedback_kind("negative", "Réponse négative : ne pas relancer.") == "negative_outcome"
    assert outcome_feedback_kind("no_response", "Pas de réponse.") == "neutral_outcome"
    assert outcome_feedback_kind("not_now", "Timing mauvais : à retenter plus tard.") == "neutral_outcome"
    assert outcome_feedback_kind("not_relevant", "Mauvais interlocuteur.") == "neutral_outcome"
    assert outcome_feedback_kind("not_relevant", "Douleur non confirmée.") == "negative_outcome"
