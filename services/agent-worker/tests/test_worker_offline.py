from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import patch

from bm_scout_worker import provider_audit
from bm_scout_worker import tools
from bm_scout_worker.fixtures import offline_output
from bm_scout_worker.memory import SupabaseConfig, SupabaseMemory
from bm_scout_worker.providers import (
    CompanySeed,
    ConfiguredWebResearchProvider,
    OpenAIWebResearchProvider,
    OpenWebResearchProvider,
    SearchResult,
    SerpApiResearchProvider,
    build_candidate_batch,
    is_company_related_result,
    parse_company_seeds,
    parse_duckduckgo_lite_results,
    parse_openai_response_sources,
    parse_openai_search_results,
    parse_serpapi_results,
    parse_search_queries,
    provider_from_env,
)
from bm_scout_worker.provider_audit import compare_providers, parse_provider_list, provider_unavailable_reason
from bm_scout_worker.quality import mission_blockers
from bm_scout_worker.runner import run_bm_scout_mission
from bm_scout_worker.schemas import FeedbackEvent, OutreachPack, QualityGate, RunStep, ScoutLead, StructuredInsights
from bm_scout_worker.tool_recorder import capture_tool_calls, compact_payload


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
    monkeypatch.delenv("SERPAPI_API_KEY", raising=False)
    monkeypatch.delenv("SERP_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    assert isinstance(provider_from_env(), OpenAIWebResearchProvider)


def test_auto_provider_prefers_serpapi_when_key_is_present(monkeypatch) -> None:
    monkeypatch.delenv("BM_SCOUT_PROVIDER", raising=False)
    monkeypatch.delenv("BM_SCOUT_REAL_SEEDS", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("SERPAPI_API_KEY", "serpapi-key")

    assert isinstance(provider_from_env(), SerpApiResearchProvider)


def test_serpapi_provider_requires_key(monkeypatch) -> None:
    monkeypatch.setenv("BM_SCOUT_PROVIDER", "serpapi")
    monkeypatch.delenv("SERPAPI_API_KEY", raising=False)
    monkeypatch.delenv("SERP_API_KEY", raising=False)

    try:
        provider_from_env()
    except RuntimeError as error:
        assert "SERPAPI_API_KEY requis" in str(error)
    else:
        raise AssertionError("SerpAPI explicite ne doit pas retomber sur un provider faible sans clé.")


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


def test_provider_feedback_memory_blocks_rejected_company() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Test Finance Ops", website="https://example.com", segment="Finance ops")]
    )
    provider.fetch_company_site = lambda _url: "Finance reporting document client team"
    feedbacks = [
        FeedbackEvent(
            id="fb-reject-company",
            lead_id="company-uuid",
            kind="bad_lead",
            note="À exclure : mauvais secteur.",
            created_at="2026-05-30T10:00:00+00:00",
            company_name="Test Finance Ops",
            segment="Finance ops",
        )
    ]

    lead = provider.build_candidates("core", feedback_events=feedbacks)[0]

    assert lead.verdict == "reject"
    assert lead.quality_decision == "blocked"
    assert lead.score <= 15
    assert "déjà rejeté" in (lead.rejection_reason or "")
    assert any(step.step == "apply_feedback_memory" for step in provider.run_steps)


def test_provider_feedback_memory_penalizes_weak_segment_without_exact_reject() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Another Finance Ops", website="https://another.example", segment="Finance ops")]
    )
    provider.fetch_company_site = lambda _url: "Finance reporting document client team"
    feedbacks = [
        FeedbackEvent(
            id="fb-sector-bad",
            lead_id="other-company",
            kind="bad_lead",
            note="Mauvais secteur et douleur faible.",
            created_at="2026-05-30T10:00:00+00:00",
            company_name="Different Company",
            segment="Finance ops",
        )
    ]

    neutral = provider.build_candidates("core")[0]
    adjusted = provider.build_candidates("core", feedback_events=feedbacks)[0]

    assert adjusted.score < neutral.score
    assert "Mémoire Romu" in adjusted.score_justification


def test_provider_feedback_memory_rewrites_generic_message_and_angle() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Angle M&A", website="https://angle.example", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: "M&A transaction reporting document client team"
    feedbacks = [
        FeedbackEvent(
            id="fb-angle",
            lead_id="company-uuid",
            kind="good_angle",
            note="Très bon angle reporting documents.",
            created_at="2026-05-30T10:00:00+00:00",
            segment="Conseil M&A",
        ),
        FeedbackEvent(
            id="fb-generic",
            lead_id="company-uuid",
            kind="generic_message",
            note="Message trop générique.",
            created_at="2026-05-30T11:00:00+00:00",
        ),
    ]

    lead = provider.build_candidates("core", feedback_events=feedbacks)[0]

    assert "Angle validé Romu" in lead.score_justification
    assert "message régénéré" in lead.score_justification
    assert "J'ai relevé un signal public précis" in lead.outreach.cold_email


def test_provider_feedback_memory_hard_blocks_dnc() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="DNC M&A", website="https://dnc.example", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: "M&A transaction reporting document client team"
    feedbacks = [
        FeedbackEvent(
            id="fb-dnc",
            lead_id="company-uuid",
            kind="do_not_contact",
            note="Ne plus contacter.",
            created_at="2026-05-30T10:00:00+00:00",
            website="https://dnc.example",
        )
    ]

    lead = provider.build_candidates("core", feedback_events=feedbacks)[0]

    assert lead.quality_decision == "blocked"
    assert all(persona.do_not_contact for persona in lead.personas)
    assert "do-not-contact" in lead.outreach.cold_email.lower()


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


def test_parse_openai_search_results_falls_back_to_urls() -> None:
    text = "Source officielle: https://www.8advisory.com/fr/services/transaction-services/ pour Transaction Services."

    results = parse_openai_search_results(text, 5)

    assert results[0].url == "https://www.8advisory.com/fr/services/transaction-services/"
    assert "8advisory.com" in results[0].title


def test_parse_openai_response_sources_falls_back_to_web_sources() -> None:
    response = SimpleNamespace(
        output=[
            SimpleNamespace(
                type="web_search_call",
                action=SimpleNamespace(
                    sources=[
                        SimpleNamespace(
                            title="Transaction Services | Deloitte France",
                            url="https://www.deloitte.com/fr/fr/services/mergers-and-acquisitions.html",
                            snippet="Conseil transaction services.",
                        ),
                        SimpleNamespace(title="LinkedIn", url="https://www.linkedin.com/company/deloitte", snippet="Réseau social."),
                    ]
                ),
            )
        ]
    )

    results = parse_openai_response_sources(response, 5)

    assert [result.url for result in results] == ["https://www.deloitte.com/fr/fr/services/mergers-and-acquisitions.html"]
    assert results[0].snippet == "Conseil transaction services."


def test_openai_provider_uses_fallback_jobs_search_by_default(monkeypatch) -> None:
    provider = OpenAIWebResearchProvider(["conseil M&A France"])
    monkeypatch.delenv("BM_SCOUT_OPENAI_SEARCH_JOBS", raising=False)

    def fake_fallback_search(_self, query, _region, _limit):
        assert "8advisory" in query.lower() or "eight advisory" in query.lower()
        return [
            SearchResult(
                title="Eight Advisory careers analyst M&A",
                url="https://www.8advisory.com/fr/careers/",
                snippet="Offre analyste transaction services.",
            )
        ]

    def fail_openai_search(*_args, **_kwargs):
        raise AssertionError("OpenAI search_web should not be called for jobs by default")

    monkeypatch.setattr(OpenWebResearchProvider, "search_web", fake_fallback_search)
    monkeypatch.setattr(provider, "search_web", fail_openai_search)

    results = provider.search_jobs("Eight Advisory", "8advisory.com", "fr")

    assert results[0].url == "https://www.8advisory.com/fr/careers/"


def test_company_related_result_ignores_domain_suffix_tokens() -> None:
    result = SearchResult(title="Accenture careers", url="https://www.accenture.com/us-en/careers", snippet="Global jobs")

    assert not is_company_related_result(result, "eightadvisory.com", "eightadvisory.com")


def test_parse_serpapi_results_filters_non_candidates() -> None:
    payload = {
        "organic_results": [
            {
                "title": "Cambon Partners - Corporate Finance",
                "link": "https://www.cambonpartners.com/fr/",
                "snippet": "Conseil M&A et opérations de croissance.",
            },
            {
                "title": "LinkedIn Cambon",
                "link": "https://www.linkedin.com/company/cambon-partners",
                "snippet": "Réseau social.",
            },
            {
                "title": "Article générique",
                "link": "https://example.com/blog/top-m-and-a",
                "snippet": "Classement générique.",
            },
        ]
    }

    results = parse_serpapi_results(payload, 5)

    assert [result.url for result in results] == ["https://www.cambonpartners.com/fr/"]
    assert results[0].snippet == "Conseil M&A et opérations de croissance."


def test_serpapi_provider_search_records_steps(monkeypatch) -> None:
    provider = SerpApiResearchProvider(["conseil M&A France"], "serpapi-key")

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self, *_args):
            return json.dumps(
                {
                    "organic_results": [
                        {
                            "title": "Transaction Services | Deloitte France",
                            "link": "https://www.deloitte.com/fr/fr/services/mergers-and-acquisitions.html",
                            "snippet": "Conseil transaction services.",
                        }
                    ]
                }
            ).encode("utf-8")

    requests = []

    def fake_urlopen(request, timeout):
        requests.append((request, timeout))
        return Response()

    with patch("urllib.request.urlopen", fake_urlopen):
        results = provider.search_web("deal advisory France", "fr", 3)

    assert results[0].title == "Transaction Services | Deloitte France"
    assert "serpapi.com/search.json" in requests[0][0].full_url
    assert "api_key=serpapi-key" in requests[0][0].full_url
    assert any(step.step == "serpapi_search" and step.payload["result_count"] == 1 for step in provider.run_steps)


def test_provider_audit_marks_missing_keys_unavailable(monkeypatch) -> None:
    monkeypatch.delenv("SERPAPI_API_KEY", raising=False)
    monkeypatch.delenv("SERP_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    assert provider_unavailable_reason("serpapi") == "SERPAPI_API_KEY manquant."
    assert provider_unavailable_reason("openai_web") == "OPENAI_API_KEY manquant."

    report = compare_providers(["serpapi", "openai_web"], ["core"])

    assert report.verdict == "fail"
    assert any("Aucun provider réel" in blocker for blocker in report.blockers)
    assert all(item.status == "unavailable" for item in report.results)


def test_provider_audit_can_recommend_real_provider(monkeypatch) -> None:
    class FakeProvider:
        run_steps: list[RunStep]

        def build_candidates(self, mode, **_kwargs):
            target = 15 if mode == "core" else 100
            self.run_steps = [
                RunStep(
                    agent_name="bm_scout_provider",
                    step="search_web",
                    event_type="tool_call",
                    payload={"discovered_count": target, "target_scan": target},
                )
            ]
            return offline_output(mode).leads[:1]

    monkeypatch.setattr(provider_audit, "provider_unavailable_reason", lambda _name: None)
    monkeypatch.setattr(provider_audit, "build_named_provider", lambda _name: FakeProvider())

    report = compare_providers(["serpapi"], ["core", "exploration"])

    assert report.verdict == "pass"
    assert report.recommended_default == "serpapi"
    assert report.prd_volume_proven is True


def test_provider_audit_keeps_run_steps_when_provider_fails(monkeypatch) -> None:
    class FailingProvider:
        def __init__(self) -> None:
            self.run_steps: list[RunStep] = []

        def build_candidates(self, _mode, **_kwargs):
            self.run_steps = [
                RunStep(
                    agent_name="bm_scout_provider",
                    step="search_web",
                    event_type="tool_call",
                    payload={"discovered_count": 0, "target_scan": 15},
                ),
                RunStep(
                    agent_name="bm_scout_provider",
                    step="openai_web_search",
                    event_type="tool_call",
                    payload={"result_count": 0, "source_count": 0, "output_text_chars": 0},
                ),
            ]
            raise RuntimeError("Aucun candidat trouvé")

    monkeypatch.setattr(provider_audit, "provider_unavailable_reason", lambda _name: None)
    monkeypatch.setattr(provider_audit, "build_named_provider", lambda _name: FailingProvider())

    report = compare_providers(["openai_web"], ["core"])
    result = report.results[0]

    assert result.status == "fail"
    assert result.run_steps
    assert result.run_steps[1]["step"] == "openai_web_search"


def test_parse_provider_list_defaults_to_real_provider_order() -> None:
    assert parse_provider_list("") == ["serpapi", "openai_web", "web"]
    assert parse_provider_list("serpapi, openai_web") == ["serpapi", "openai_web"]


def test_agent_sdk_tool_calls_are_recorded(monkeypatch) -> None:
    monkeypatch.setenv("BM_SCOUT_PROVIDER", "demo")

    async def invoke_tool() -> tuple[object, list[str]]:
        context = SimpleNamespace(tool_name="search_web", run_config=None)
        with capture_tool_calls() as steps:
            output = await tools.search_web.on_invoke_tool(
                context,
                '{"query":"m&a","region":"fr","limit":1}',
            )
            return output, [step.step for step in steps]

    output, step_names = asyncio.run(invoke_tool())

    assert isinstance(output, list)
    assert step_names == ["search_web"]


def test_tool_recorder_compacts_large_payloads() -> None:
    compact = compact_payload({"html": "x" * 700, "items": list(range(20))})

    assert isinstance(compact, dict)
    assert str(compact["html"]).endswith("...[truncated]")
    assert len(compact["items"]) == 8


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
    assert events[0].company_name == "Cambon Partners"
    assert events[0].segment == "Conseil M&A"
