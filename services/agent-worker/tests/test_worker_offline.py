from __future__ import annotations

import asyncio
import json
from unittest.mock import patch

from bm_scout_worker.fixtures import offline_output
from bm_scout_worker.memory import SupabaseConfig, SupabaseMemory
from bm_scout_worker.providers import (
    CompanySeed,
    ConfiguredWebResearchProvider,
    OpenAIWebResearchProvider,
    OpenWebResearchProvider,
    SearchResult,
    build_candidate_batch,
    parse_company_seeds,
    parse_duckduckgo_lite_results,
    parse_openai_search_results,
    parse_search_queries,
    provider_from_env,
)
from bm_scout_worker.quality import mission_blockers
from bm_scout_worker.runner import run_bm_scout_mission
from bm_scout_worker.schemas import OutreachPack, QualityGate, ScoutLead, StructuredInsights


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


def test_do_not_contact_cannot_remain_in_shortlist() -> None:
    output = offline_output("core")
    dnc = output.leads[0].model_copy(deep=True)
    dnc.company = "DNC Core"
    dnc.personas[0].do_not_contact = True
    output.leads.append(dnc)

    assert "DNC Core: do-not-contact encore présent dans la shortlist." in mission_blockers(output)


def test_observed_insight_without_evidence_id_is_blocked() -> None:
    output = offline_output("core")
    invalid = output.leads[0].model_copy(deep=True)
    invalid.insights = StructuredInsights(
        observed=[{"text": "Signal inventé sans preuve", "evidence_id": "missing"}],
        inferred=invalid.pain_hypotheses,
        uncertain=[],
    )

    assert f"{invalid.company}: insight Observé sans evidence_id sourcé." in mission_blockers(
        output.model_copy(update={"leads": [invalid]})
    )


def test_real_provider_requires_explicit_sources(monkeypatch) -> None:
    monkeypatch.delenv("BM_SCOUT_PROVIDER", raising=False)
    monkeypatch.delenv("BM_SCOUT_REAL_SEEDS", raising=False)
    monkeypatch.setenv("BM_SCOUT_PROVIDER", "configured")

    try:
        build_candidate_batch("core", include_weak=False, feedback_notes=[])
    except RuntimeError as error:
        assert "BM_SCOUT_REAL_SEEDS requis" in str(error)
    else:
        raise AssertionError("Le mode réel ne doit pas retomber silencieusement sur les fixtures.")


def test_open_web_provider_builds_candidates_without_seed(monkeypatch) -> None:
    monkeypatch.setenv("BM_SCOUT_CORE_TARGET", "3")
    monkeypatch.setenv("BM_SCOUT_FETCH_LIMIT", "2")
    provider = OpenWebResearchProvider(["conseil M&A France"])
    provider.search_web = lambda _query, _region, _limit: [
        SearchResult(title="Conseil en Deals - PwC", url="https://www.pwc.fr/fr/expertises/transactions.html", snippet="Deals"),
        SearchResult(title="Transaction Services | Deloitte France", url="https://www.deloitte.com/fr/fr/services/mergers-and-acquisitions.html", snippet="TS"),
        SearchResult(title="LinkedIn post", url="https://linkedin.com/posts/test", snippet="blocked"),
    ]
    provider.fetch_company_site = lambda _url: "M&A transaction reporting document client team"

    leads = provider.build_candidates("core")

    assert [lead.company for lead in leads] == ["PwC", "Deloitte France"]
    assert all(lead.evidence for lead in leads)
    assert leads[0].website == "https://www.pwc.fr"
    assert leads[0].evidence[0].url == "https://www.pwc.fr/fr/expertises/transactions.html"
    assert any(step.step == "search_web" for step in provider.run_steps)
    assert any(step.step == "fetch_company_site" for step in provider.run_steps)


def test_open_web_provider_adds_job_search_evidence(monkeypatch) -> None:
    monkeypatch.setenv("BM_SCOUT_CORE_TARGET", "1")
    monkeypatch.setenv("BM_SCOUT_FETCH_LIMIT", "1")
    provider = OpenWebResearchProvider(["conseil M&A France"])

    def fake_search(query: str, _region: str, _limit: int) -> list[SearchResult]:
        if "recrutement" in query.lower() or "careers" in query.lower():
            return [
                SearchResult(
                    title="HelloWork - offres d'emploi",
                    url="https://duckduckgo.com/y.js?ad_domain=hellowork.com&u3=https%3A%2F%2Fwww.bing.com%2Faclick",
                    snippet="Annonce emploi sponsorisée sans lien prouvé avec PwC.",
                ),
                SearchResult(
                    title="PwC recrute - Transaction Services",
                    url="https://www.pwc.fr/fr/carrieres/offres/transaction-services.html",
                    snippet="Offre d'emploi publique mentionnant transaction services, reporting et coordination client.",
                )
            ]
        return [
            SearchResult(
                title="Conseil en Deals - PwC",
                url="https://www.pwc.fr/fr/expertises/transactions.html",
                snippet="Deals",
            )
        ]

    provider.search_web = fake_search
    provider.fetch_company_site = lambda _url: "M&A transaction reporting document client team"

    lead = provider.build_candidates("core")[0]

    assert any(item.label == "Recrutement public" for item in lead.evidence)
    assert any("recrutement publique" in signal for signal in lead.observed_signals)
    assert any(step.step == "search_jobs" and step.payload["job_count"] == 1 for step in provider.run_steps)


def test_auto_provider_prefers_openai_web_when_key_is_present(monkeypatch) -> None:
    monkeypatch.delenv("BM_SCOUT_PROVIDER", raising=False)
    monkeypatch.delenv("BM_SCOUT_REAL_SEEDS", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    assert isinstance(provider_from_env(), OpenAIWebResearchProvider)


def test_configured_provider_builds_candidates_from_public_seed() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Test M&A", website="https://example.com", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: "M&A transaction reporting document client team"

    leads = provider.build_candidates("core")

    assert leads[0].company == "Test M&A"
    assert leads[0].id.startswith("core-")
    assert leads[0].evidence
    assert leads[0].quality_gates[0].code == "provider_real"
    assert leads[0].insights is not None
    assert leads[0].insights.observed[0].evidence_id == "https://example.com"
    assert {step.step for step in provider.run_steps} >= {
        "dedupe_company",
        "fetch_company_site",
        "extract_company_signals",
        "search_jobs",
        "find_public_emails",
        "save_evidence",
        "score_candidate",
    }


def test_public_email_is_marked_to_verify_with_source() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Test M&A", website="https://example.com", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: "Contact: partner@example.com M&A transaction reporting document"

    lead = provider.build_candidates("core")[0]
    persona = lead.personas[0]

    assert persona.email == "partner@example.com"
    assert persona.email_type == "public_named"
    assert persona.email_source_url == "https://example.com"
    assert persona.email_confidence == "medium"
    assert persona.email_status == "verify"


def test_generic_public_email_keeps_generic_type() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Test M&A", website="https://example.com", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: "Contact: contact@example.com M&A transaction reporting document"

    persona = provider.build_candidates("core")[0].personas[0]

    assert persona.email == "contact@example.com"
    assert persona.email_type == "generic"
    assert persona.email_status == "verify"


def test_configured_provider_dedupes_same_domain() -> None:
    provider = ConfiguredWebResearchProvider(
        [
            CompanySeed(company="Test M&A", website="https://www.example.com", segment="Conseil M&A"),
            CompanySeed(company="Test M&A Duplicate", website="https://example.com", segment="Conseil M&A"),
        ]
    )
    provider.fetch_company_site = lambda _url: "M&A transaction reporting document"

    leads = provider.build_candidates("core")

    assert len(leads) == 1


def test_provider_score_uses_negative_feedback_notes() -> None:
    seed = CompanySeed(company="Test Finance Ops", website="https://example.com", segment="Finance ops")
    provider = ConfiguredWebResearchProvider([seed])
    evidence = []

    neutral = provider.score_candidate(seed, evidence, [])
    penalized = provider.score_candidate(seed, evidence, ["Mauvais secteur pour Romu, trop petit."])

    assert penalized < neutral


def test_parse_company_seeds_supports_json_and_compact_format() -> None:
    json_seeds = parse_company_seeds('[{"company":"A","website":"https://a.test","segment":"M&A"}]')
    compact_seeds = parse_company_seeds("B|https://b.test|Finance ops")

    assert json_seeds[0].company == "A"
    assert compact_seeds[0].segment == "Finance ops"


def test_parse_search_queries_and_duckduckgo_results() -> None:
    queries = parse_search_queries('["conseil M&A France", "finance ops"]')
    html = """
      <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.pwc.fr%2Ffr%2Fexpertises%2Ftransactions.html">Conseil en Deals - PwC</a>
      <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.linkedin.com%2Fposts%2Fx">LinkedIn</a>
      <a rel="nofollow" href="https://duckduckgo.com/y.js?ad_domain=hellowork.com">Annonce emploi</a>
    """
    results = parse_duckduckgo_lite_results(html, 5)

    assert queries == ["conseil M&A France", "finance ops"]
    assert len(results) == 1
    assert results[0].url == "https://www.pwc.fr/fr/expertises/transactions.html"


def test_parse_openai_search_results_filters_non_candidates() -> None:
    text = """
    {
      "results": [
        {"title":"Cambon Partners - Corporate Finance","url":"https://www.cambonpartners.com/fr/","snippet":"Conseil M&A"},
        {"title":"LinkedIn Cambon","url":"https://www.linkedin.com/company/cambon-partners","snippet":"Réseau social"}
      ]
    }
    """

    results = parse_openai_search_results(text, 5)

    assert [result.url for result in results] == ["https://www.cambonpartners.com/fr/"]


def test_parse_openai_search_results_tolerates_invalid_json() -> None:
    assert parse_openai_search_results("pas du json", 5) == []


def test_runner_writes_artifact(tmp_path) -> None:
    output = asyncio.run(run_bm_scout_mission("core", artifacts_dir=tmp_path))

    assert (tmp_path / f"{output.run_id}.json").exists()
    assert output.run_steps[0].event_type == "offline_run"


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
