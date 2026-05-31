from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import patch

from bm_scout_worker import provider_audit
from bm_scout_worker import tools
from bm_scout_worker.agents import agent_hosted_web_search_enabled, build_manager_agent
from bm_scout_worker.fixtures import offline_output
from bm_scout_worker.providers import (
    CompanySeed,
    ConfiguredWebResearchProvider,
    OpenAIWebResearchProvider,
    OpenWebResearchProvider,
    SearchResult,
    SerpApiResearchProvider,
    build_candidate_batch,
    default_search_queries,
    is_company_related_result,
    openai_search_context_size,
    openai_search_max_output_tokens,
    openai_text_verbosity,
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
from bm_scout_worker.runner import (
    agent_max_turns,
    append_unselected_candidates_as_rejected,
    code_revision,
    derive_provider_scanned_count,
    normalize_rejected_outputs,
    run_bm_scout_mission,
)
from bm_scout_worker.schemas import FeedbackEvent, OutreachPack, QualityGate, RunStep, ScoutLead, StructuredInsights
from bm_scout_worker.tool_recorder import capture_tool_calls, compact_payload


def test_core_offline_produces_actionable_lead() -> None:
    output = offline_output("core")

    assert output.leads
    assert any(lead.verdict == "validate" and lead.quality_decision == "pass" for lead in output.leads)
    assert mission_blockers(output) == []


def test_runner_records_memory_source_metadata() -> None:
    output = asyncio.run(run_bm_scout_mission("core", real=False, persist=False))
    runner_step = next(step for step in output.run_steps if step.step == "runner_complete")

    assert runner_step.payload["feedback_memory_source"] == "offline_fixture"
    assert runner_step.payload["do_not_contact_event_count"] == 0
    assert isinstance(runner_step.payload["duration_ms"], int)
    assert runner_step.payload["started_at"]
    assert runner_step.payload["completed_at"]
    assert runner_step.payload["python_version"]
    assert runner_step.payload["openai_agents_version"] != ""
    assert runner_step.payload["code_revision"] != ""


def test_runner_derives_scanned_count_from_provider_discovery() -> None:
    steps = [
        RunStep(agent_name="bm_scout_provider", step="search_web", event_type="tool_call", payload={"discovered_count": 100}),
        RunStep(agent_name="bm_scout_provider", step="candidate_batch", event_type="tool_call", payload={"candidate_count": 12}),
    ]

    assert derive_provider_scanned_count(steps, fallback=12) == 100
    assert derive_provider_scanned_count([], fallback=12) == 12


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


def test_rejected_outputs_are_persistable_as_qc_blocks() -> None:
    output = offline_output("exploration")
    rejected = output.leads[0].model_copy(deep=True)
    rejected.id = "soft-rejected"
    rejected.company = "Soft Rejected"
    rejected.verdict = "watch"
    rejected.quality_decision = "needs_enrichment"
    rejected.rejection_reason = None
    rejected.quality_gates = [QualityGate(code="signal", passed=True, reason="Signal partiel.")]
    output.rejected = [rejected]

    normalize_rejected_outputs(output)

    assert output.rejected_count == 1
    assert output.rejected[0].verdict == "reject"
    assert output.rejected[0].quality_decision == "blocked"
    assert output.rejected[0].rejection_reason
    assert any(not gate.passed for gate in output.rejected[0].quality_gates)


def test_unselected_provider_candidates_are_persisted_as_exclusions() -> None:
    output = offline_output("exploration")
    candidate = output.leads[0].model_copy(deep=True)
    candidate.id = "provider-unselected"
    candidate.company = "Provider Unselected"
    original_rejected_count = len(output.rejected)

    append_unselected_candidates_as_rejected(output, [candidate])
    normalize_rejected_outputs(output)

    assert len(output.rejected) == original_rejected_count + 1
    rejected = next(lead for lead in output.rejected if lead.id == "provider-unselected")
    assert rejected.verdict == "reject"
    assert rejected.quality_decision == "blocked"
    assert rejected.rejection_reason == "Candidat analysé puis écarté de la shortlist par BM Scout."
    assert any(gate.code == "not_shortlisted" and not gate.passed for gate in rejected.quality_gates)


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


def test_openai_web_search_verbosity_defaults_to_model_compatible_medium(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_TEXT_VERBOSITY", raising=False)

    assert openai_text_verbosity() == "medium"

    monkeypatch.setenv("OPENAI_TEXT_VERBOSITY", "low")

    assert openai_text_verbosity() == "low"


def test_openai_search_context_and_output_tokens_are_safe_defaults(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_SEARCH_CONTEXT_SIZE", raising=False)
    monkeypatch.delenv("OPENAI_SEARCH_MAX_OUTPUT_TOKENS", raising=False)

    assert openai_search_context_size() == "medium"
    assert openai_search_max_output_tokens() == 2400

    monkeypatch.setenv("OPENAI_SEARCH_CONTEXT_SIZE", "bad")
    monkeypatch.setenv("OPENAI_SEARCH_MAX_OUTPUT_TOKENS", "not-a-number")

    assert openai_search_context_size() == "medium"
    assert openai_search_max_output_tokens() == 2400

    monkeypatch.setenv("OPENAI_SEARCH_CONTEXT_SIZE", "high")
    monkeypatch.setenv("OPENAI_SEARCH_MAX_OUTPUT_TOKENS", "400")

    assert openai_search_context_size() == "high"
    assert openai_search_max_output_tokens() == 800


def test_agents_sdk_hosted_web_search_is_opt_in(monkeypatch) -> None:
    monkeypatch.delenv("BM_SCOUT_AGENT_HOSTED_WEB_SEARCH", raising=False)

    manager = build_manager_agent("gpt-5.5")
    tool_names = [getattr(tool, "name", "") for tool in manager.tools]

    assert agent_hosted_web_search_enabled() is False
    assert "web_search" not in tool_names
    assert "search_web" in tool_names
    assert "run_exploration" in tool_names
    assert "summarize_learning" in tool_names

    monkeypatch.setenv("BM_SCOUT_AGENT_HOSTED_WEB_SEARCH", "1")
    manager_with_hosted_search = build_manager_agent("gpt-5.5")

    assert agent_hosted_web_search_enabled() is True
    assert "web_search" in [getattr(tool, "name", "") for tool in manager_with_hosted_search.tools]


def test_agents_sdk_max_turns_is_bounded(monkeypatch) -> None:
    monkeypatch.delenv("BM_SCOUT_AGENT_MAX_TURNS", raising=False)

    assert agent_max_turns() == 6

    monkeypatch.setenv("BM_SCOUT_AGENT_MAX_TURNS", "2")
    assert agent_max_turns() == 3

    monkeypatch.setenv("BM_SCOUT_AGENT_MAX_TURNS", "99")
    assert agent_max_turns() == 10


def test_code_revision_prefers_explicit_runtime_revision(monkeypatch) -> None:
    monkeypatch.setenv("BM_SCOUT_CODE_REVISION", "abc123runtime")
    monkeypatch.setenv("GITHUB_SHA", "github-sha")

    assert code_revision() == "abc123runtime"


def test_default_queries_cover_prd_volume_scan_surface() -> None:
    assert len(default_search_queries("core")) >= 5
    assert len(default_search_queries("exploration")) >= 12
    assert any("M&A" in query or "corporate finance" in query for query in default_search_queries("core"))
    assert any("DAF" in query for query in default_search_queries("exploration"))
    assert any("immobilier" in query for query in default_search_queries("exploration"))


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


def test_core_provider_passed_qc_lead_is_validable() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Test M&A", website="https://example.com", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: "M&A transaction"

    lead = provider.build_candidates("core")[0]

    assert lead.score == 77
    assert lead.quality_decision == "pass"
    assert lead.verdict == "validate"


def test_public_named_email_is_usable_with_source() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Test M&A", website="https://example.com", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: "Contact: partner@example.com M&A transaction reporting document"

    lead = provider.build_candidates("core")[0]
    persona = lead.personas[0]

    assert persona.email == "partner@example.com"
    assert persona.email_type == "public_named"
    assert persona.email_source_url == "https://example.com"
    assert persona.email_confidence == "high"
    assert persona.email_status == "usable"


def test_generic_public_email_keeps_generic_type() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Test M&A", website="https://example.com", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: "Contact: contact@example.com M&A transaction reporting document"

    persona = provider.build_candidates("core")[0].personas[0]

    assert persona.email == "contact@example.com"
    assert persona.email_type == "generic"
    assert persona.email_confidence == "medium"
    assert persona.email_status == "verify"


def test_probable_pattern_email_is_marked_to_verify() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Test M&A", website="https://example.com", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: "Pour nous écrire: firstname.lastname@example.com M&A transaction reporting document"

    persona = provider.build_candidates("core")[0].personas[0]

    assert persona.email == "firstname.lastname@example.com"
    assert persona.email_type == "probable_pattern"
    assert persona.email_confidence == "low"
    assert persona.email_status == "verify"


def test_provider_does_not_invent_probable_email_pattern() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Test M&A", website="https://example.com", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: "M&A transaction reporting document sans email public"

    persona = provider.build_candidates("core")[0].personas[0]

    assert persona.email is None
    assert persona.email_type == "unknown"
    assert persona.email_confidence == "low"
    assert persona.email_status == "not_usable"


def test_provider_ignores_no_reply_email() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Test M&A", website="https://example.com", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: "noreply@example.com M&A transaction reporting document"

    persona = provider.build_candidates("core")[0].personas[0]

    assert persona.email is None
    assert persona.email_status == "not_usable"


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


def test_configured_provider_dedupes_same_legal_name_without_same_domain() -> None:
    provider = ConfiguredWebResearchProvider(
        [
            CompanySeed(company="Cambon Partners SAS", website="https://cambon.fr", segment="Conseil M&A", city="Paris"),
            CompanySeed(company="Cambon Partner France", website="https://cambonpartners.eu", segment="Conseil M&A", city="Paris"),
        ]
    )
    provider.fetch_company_site = lambda _url: "M&A transaction reporting document"

    leads = provider.build_candidates("core")

    assert len(leads) == 1
    skipped = [step for step in provider.run_steps if step.step == "dedupe_company" and step.payload["decision"] == "skipped_duplicate"]
    assert skipped
    assert any(str(key).startswith("name:cambon|country:fr|city:paris") for key in skipped[0].payload["duplicate_keys"])


def test_configured_provider_keeps_same_name_when_city_differs() -> None:
    provider = ConfiguredWebResearchProvider(
        [
            CompanySeed(company="Altitude Conseil", website="https://altitude-paris.example", segment="Conseil M&A", city="Paris"),
            CompanySeed(company="Altitude Conseil", website="https://altitude-lyon.example", segment="Conseil M&A", city="Lyon"),
        ]
    )
    provider.fetch_company_site = lambda _url: "M&A transaction reporting document"

    leads = provider.build_candidates("core")

    assert len(leads) == 2


def test_parse_company_seeds_keeps_dedupe_fields() -> None:
    seeds = parse_company_seeds(
        json.dumps(
            [
                {
                    "company": "Eight Advisory",
                    "website": "https://www.8advisory.com",
                    "segment": "Conseil M&A",
                    "city": "Paris",
                    "country": "fr",
                    "linkedin_url": "https://www.linkedin.com/company/eight-advisory",
                    "siren": "123456789",
                }
            ]
        )
    )
    provider = ConfiguredWebResearchProvider(seeds)

    keys = provider.dedupe_company_keys(seeds[0])

    assert "name:eight-advisory|country:fr|city:paris" in keys
    assert "linkedin:https://www.linkedin.com/company/eight-advisory" in keys
    assert "registration:fr:123456789" in keys


def test_provider_score_uses_negative_feedback_notes() -> None:
    seed = CompanySeed(company="Test Finance Ops", website="https://example.com", segment="Finance ops")
    provider = ConfiguredWebResearchProvider([seed])
    evidence = []

    neutral = provider.score_candidate(seed, evidence, [])
    unrelated = provider.score_candidate(seed, evidence, ["Mauvais secteur pour Romu, trop petit : Autre segment."])
    penalized = provider.score_candidate(seed, evidence, ["Finance ops mauvais secteur pour Romu, trop petit."])

    assert unrelated == neutral
    assert penalized < neutral


def test_provider_feedback_memory_blocks_rejected_company() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Test Finance Ops", website="https://example.com", segment="Finance ops")]
    )

    def fail_fetch(_url):
        raise AssertionError("Un lead déjà rejeté ne doit pas être fetché avant blocage.")

    provider.fetch_company_site = fail_fetch
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
    reject_step = next(step for step in provider.run_steps if step.step == "feedback_reject_pre_generation_gate")
    assert reject_step.payload["stage"] == "seed"
    assert reject_step.payload["message_generation"] == "skipped"


def test_provider_feedback_memory_does_not_block_neutral_outcome() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="Neutral M&A", website="https://neutral.example", segment="Conseil M&A")]
    )
    provider.fetch_company_site = lambda _url: "M&A transaction reporting document client team"
    feedbacks = [
        FeedbackEvent(
            id="outcome-no-response",
            lead_id="neutral.example",
            kind="neutral_outcome",
            note="Pas de réponse : à surveiller sans opt-out.",
            created_at="2026-05-30T10:00:00+00:00",
            website="https://neutral.example",
            segment="Conseil M&A",
        )
    ]

    lead = provider.build_candidates("core", feedback_events=feedbacks)[0]

    assert lead.quality_decision != "blocked"
    assert lead.verdict != "reject"
    assert "do-not-contact" not in lead.outreach.cold_email.lower()


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
    effects = next(step.payload for step in provider.run_steps if step.step == "feedback_memory_effects")
    assert effects["impact_count"] == 1
    assert effects["score_changed_count"] == 1
    assert effects["message_regenerated_count"] == 1
    assert effects["angle_reinforced_count"] == 1


def test_provider_feedback_memory_hard_blocks_dnc() -> None:
    provider = ConfiguredWebResearchProvider(
        [CompanySeed(company="DNC M&A", website="https://dnc.example", segment="Conseil M&A")]
    )

    def fail_fetch(_url):
        raise AssertionError("Un domaine DNC ne doit pas être fetché avant blocage.")

    provider.fetch_company_site = fail_fetch
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
    dnc_step = next(step for step in provider.run_steps if step.step == "dnc_pre_generation_gate")
    assert dnc_step.payload["stage"] == "seed"
    assert dnc_step.payload["message_generation"] == "skipped"
    effects = next(step.payload for step in provider.run_steps if step.step == "feedback_memory_effects")
    assert effects["blocked_count"] == 1
    assert effects["blocked_do_not_contact_count"] == 1


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


def test_openai_provider_requires_hosted_web_search_call(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeResponses:
        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                output_text=json.dumps(
                    {
                        "results": [
                            {
                                "title": "Transaction Services | Deloitte France",
                                "url": "https://www.deloitte.com/fr/fr/services/mergers-and-acquisitions.html",
                                "snippet": "Conseil transaction services.",
                            }
                        ]
                    }
                ),
                output=[
                    SimpleNamespace(
                        type="web_search_call",
                        action=SimpleNamespace(sources=[]),
                    )
                ],
            )

    class FakeOpenAI:
        def __init__(self) -> None:
            self.responses = FakeResponses()

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_SEARCH_MODEL", "gpt-4.1-mini")
    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)

    provider = OpenAIWebResearchProvider(["conseil M&A France"])
    results = provider.search_web("conseil M&A France", "fr", 1)

    assert results[0].url == "https://www.deloitte.com/fr/fr/services/mergers-and-acquisitions.html"
    assert captured["tool_choice"] == "required"
    assert captured["max_tool_calls"] == 1
    assert captured["store"] is False
    assert captured["tools"] == [
        {
            "type": "web_search",
            "search_context_size": "medium",
            "external_web_access": True,
            "user_location": {"type": "approximate", "country": "FR"},
        }
    ]
    search_step = next(step for step in provider.run_steps if step.step == "openai_web_search")
    assert search_step.payload["tool_choice"] == "required"
    assert search_step.payload["external_web_access"] is True


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
    monkeypatch.setenv("BM_SCOUT_CODE_REVISION", "provider-audit-test-revision")

    report = compare_providers(["serpapi"], ["core", "exploration"])

    assert report.verdict == "pass"
    assert report.recommended_default == "serpapi"
    assert report.prd_volume_proven is True
    assert report.code_revision == "provider-audit-test-revision"
    assert report.python_version
    assert report.openai_sdk_version != ""


def test_provider_audit_does_not_claim_prd_volume_for_core_only_smoke(monkeypatch) -> None:
    class FakeProvider:
        run_steps: list[RunStep]

        def build_candidates(self, _mode, **_kwargs):
            self.run_steps = [
                RunStep(
                    agent_name="bm_scout_provider",
                    step="search_web",
                    event_type="tool_call",
                    payload={"discovered_count": 15, "target_scan": 15},
                )
            ]
            return offline_output("core").leads[:1]

    monkeypatch.setattr(provider_audit, "provider_unavailable_reason", lambda _name: None)
    monkeypatch.setattr(provider_audit, "build_named_provider", lambda _name: FakeProvider())

    report = compare_providers(["openai_web"], ["core"])

    assert report.verdict == "pass"
    assert report.recommended_default == "openai_web"
    assert report.prd_volume_proven is False


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


def test_agent_output_schema_is_strict_compatible() -> None:
    from agents.agent_output import AgentOutputSchema
    from bm_scout_worker.schemas import MissionAgentOutput

    AgentOutputSchema(MissionAgentOutput)
