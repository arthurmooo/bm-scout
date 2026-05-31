from __future__ import annotations

import hashlib
import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlparse

from .fixtures import candidate_leads
from .feedback_memory import apply_provider_feedback_memory, build_provider_feedback_memory
from .schemas import Evidence, FeedbackEvent, OutreachPack, Persona, QualityGate, RunStep, ScoutLead, ScoutMode, StructuredInsights


@dataclass(frozen=True)
class CompanySeed:
    company: str
    website: str
    segment: str = "M&A / finance ops"
    region: str = "fr"
    source_url: str | None = None
    city: str | None = None
    country: str = "fr"
    linkedin_url: str | None = None
    registration_id: str | None = None


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str


@dataclass(frozen=True)
class CandidateBatch:
    leads: list[ScoutLead]
    run_steps: list[RunStep]


class ResearchProvider(Protocol):
    def search_web(self, query: str, region: str, limit: int) -> list[SearchResult]:
        ...

    def fetch_company_site(self, url: str) -> str:
        ...

    def extract_company_signals(self, text: str) -> list[str]:
        ...

    def search_jobs(self, company_name: str, domain: str, region: str) -> list[SearchResult]:
        ...

    def find_public_emails(self, company_name: str, domain: str, pages: list[str]) -> list[dict[str, str]]:
        ...

    def dedupe_company(self, seed: CompanySeed) -> str:
        ...

    def score_candidate(self, seed: CompanySeed, evidence: list[Evidence], feedback_notes: list[str]) -> int:
        ...

    def save_evidence(self, evidence: list[Evidence]) -> list[Evidence]:
        ...


class DemoFixtureProvider:
    def build_candidates(self, mode: ScoutMode, include_weak: bool = False) -> list[ScoutLead]:
        return candidate_leads(mode, include_weak=include_weak)

    def search_web(self, query: str, region: str, limit: int) -> list[SearchResult]:
        leads = candidate_leads("core" if "m&a" in query.lower() else "exploration")
        return [
            SearchResult(title=lead.company, url=lead.website, snippet=lead.short_card)
            for lead in leads[:limit]
        ]

    def fetch_company_site(self, url: str) -> str:
        return f"Demo fixture page for {url}"

    def extract_company_signals(self, text: str) -> list[str]:
        return [text[:180]] if text else []

    def search_jobs(self, company_name: str, domain: str, region: str) -> list[SearchResult]:
        return []

    def find_public_emails(self, company_name: str, domain: str, pages: list[str]) -> list[dict[str, str]]:
        return []

    def dedupe_company(self, seed: CompanySeed) -> str:
        return normalized_domain(seed.website) or normalized_name(seed.company)

    def score_candidate(self, seed: CompanySeed, evidence: list[Evidence], feedback_notes: list[str]) -> int:
        return 80 if evidence else 40

    def save_evidence(self, evidence: list[Evidence]) -> list[Evidence]:
        return evidence


class ConfiguredWebResearchProvider:
    def __init__(self, seeds: list[CompanySeed]):
        if not seeds:
            raise RuntimeError(
                "BM_SCOUT_REAL_SEEDS requis en mode réel. Utilise BM_SCOUT_PROVIDER=demo uniquement pour une démo explicite."
            )
        self.seeds = seeds
        self.run_steps: list[RunStep] = []

    @classmethod
    def from_env(cls) -> "ConfiguredWebResearchProvider":
        return cls(parse_company_seeds(os.getenv("BM_SCOUT_REAL_SEEDS", "")))

    def build_candidates(
        self,
        mode: ScoutMode,
        include_weak: bool = False,
        feedback_notes: list[str] | None = None,
        feedback_events: list[FeedbackEvent] | None = None,
    ) -> list[ScoutLead]:
        candidates: list[ScoutLead] = []
        seen_keys: set[str] = set()
        feedback_effects: list[dict[str, object]] = []
        feedback_memory = build_provider_feedback_memory(feedback_events or [])
        self.run_steps = []
        self.record_step(
            "feedback_memory",
            {
                "feedback_event_count": len(feedback_events or []),
                "segment_delta_count": len(feedback_memory.segment_deltas),
                "rejected_target_count": len(feedback_memory.rejected_targets),
                "dnc_target_count": len(feedback_memory.do_not_contact_targets),
                "preferred_angle_count": len(feedback_memory.preferred_angles),
                "generic_message_feedback": feedback_memory.generic_message_feedback,
            },
        )
        for seed in self.seeds:
            dedupe_keys = self.dedupe_company_keys(seed)
            duplicate_keys = sorted(dedupe_keys & seen_keys)
            if duplicate_keys:
                self.record_step(
                    "dedupe_company",
                    {
                        "company": seed.company,
                        "website": seed.website,
                        "dedupe_key": self.dedupe_company(seed),
                        "dedupe_keys": sorted(dedupe_keys),
                        "duplicate_keys": duplicate_keys,
                        "decision": "skipped_duplicate",
                    },
                )
                continue
            seen_keys.update(dedupe_keys)
            self.record_step(
                "dedupe_company",
                {
                    "company": seed.company,
                    "website": seed.website,
                    "dedupe_key": self.dedupe_company(seed),
                    "dedupe_keys": sorted(dedupe_keys),
                    "decision": "kept",
                },
            )
            source_url = seed.source_url or seed.website
            page = self.fetch_company_site(source_url)
            self.record_step("fetch_company_site", {"company": seed.company, "url": source_url, "chars": len(page), "failed": page.startswith("Fetch failed")})
            signals = self.extract_company_signals(page)
            self.record_step("extract_company_signals", {"company": seed.company, "signal_count": len(signals), "signals": signals[:3]})
            domain = normalized_domain(seed.website)
            job_results = self.search_jobs(seed.company, domain, seed.region)
            self.record_step("search_jobs", {"company": seed.company, "domain": domain, "job_count": len(job_results), "urls": [result.url for result in job_results[:3]]})
            job_evidence = job_results_to_evidence(job_results)
            signals = unique_items([*signals, *job_results_to_signals(job_results)])
            emails = self.find_public_emails(seed.company, domain, [page])
            self.record_step("find_public_emails", {"company": seed.company, "domain": domain, "email_count": len(emails)})
            evidence = self.save_evidence(
                [
                    Evidence(
                        label="Site public",
                        url=source_url,
                        observed_fact=signals[0] if signals else f"Page publique consultée pour {seed.company}.",
                        reliability="medium",
                    )
                ]
                + job_evidence
            )
            self.record_step("save_evidence", {"company": seed.company, "evidence_count": len(evidence)})
            score = self.score_candidate(seed, evidence, feedback_notes or [])
            self.record_step("score_candidate", {"company": seed.company, "score": score, "feedback_notes_count": len(feedback_notes or [])})
            lead = to_scout_lead(seed, mode, score, signals, evidence, emails)
            adjusted = apply_provider_feedback_memory(lead, feedback_memory)
            if adjusted != lead:
                effect = feedback_effect_payload(lead, adjusted)
                feedback_effects.append(effect)
                self.record_step(
                    "apply_feedback_memory",
                    {
                        "company": lead.company,
                        **effect,
                    },
                )
            candidates.append(adjusted)
        self.record_step("feedback_memory_effects", summarize_feedback_effects(feedback_effects))
        return candidates

    def record_step(self, step: str, payload: dict[str, object]) -> None:
        self.run_steps.append(
            RunStep(
                agent_name="bm_scout_provider",
                step=step,
                event_type="tool_call",
                payload=payload,
            )
        )

    def search_web(self, query: str, region: str, limit: int) -> list[SearchResult]:
        terms = query.lower().split()
        results = [
            SearchResult(title=seed.company, url=seed.website, snippet=f"Source configurée {seed.segment} {seed.region}")
            for seed in self.seeds
            if not terms or any(term in f"{seed.company} {seed.segment}".lower() for term in terms)
        ]
        return results[:limit]

    def fetch_company_site(self, url: str) -> str:
        request = urllib.request.Request(
            url,
            headers={"user-agent": "BMScout/1.0 internal research; contact: bm-automation"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=float(os.getenv("BM_SCOUT_FETCH_TIMEOUT_SECONDS", "8"))) as response:
                body = response.read(250_000)
        except (urllib.error.URLError, TimeoutError) as error:
            return f"Fetch failed for {url}: {error}"
        return body.decode("utf-8", errors="replace")

    def extract_company_signals(self, text: str) -> list[str]:
        normalized = strip_html(text).lower()
        signals: list[str] = []
        if any(term in normalized for term in ["m&a", "merger", "acquisition", "lbo", "transaction", "deal"]):
            signals.append("Le site public mentionne une activité M&A, transaction ou deal advisory.")
        if any(term in normalized for term in ["reporting", "document", "data room", "dataroom", "client", "portfolio"]):
            signals.append("Le contenu public suggère des flux de documents, reporting ou coordination client.")
        if any(term in normalized for term in ["multi", "office", "bureau", "international", "team"]):
            signals.append("Le site suggère une organisation structurée avec plusieurs équipes ou implantations.")
        return signals[:4] or ["Page publique consultée, signal métier précis à confirmer par enrichissement."]

    def search_jobs(self, company_name: str, domain: str, region: str) -> list[SearchResult]:
        return []

    def find_public_emails(self, company_name: str, domain: str, pages: list[str]) -> list[dict[str, str]]:
        emails: list[dict[str, str]] = []
        seen: set[str] = set()
        pattern = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
        for page in pages:
            for email in pattern.findall(page):
                normalized = email.lower()
                if normalized in seen:
                    continue
                classified = classify_public_email(normalized, domain)
                if not classified:
                    continue
                seen.add(normalized)
                emails.append(classified)
        emails.sort(key=email_priority)
        return emails[:3]

    def dedupe_company(self, seed: CompanySeed) -> str:
        keys = sorted(self.dedupe_company_keys(seed))
        return keys[0] if keys else normalized_name(seed.company)

    def dedupe_company_keys(self, seed: CompanySeed) -> set[str]:
        keys: set[str] = set()
        domain = normalized_domain(seed.website)
        if domain:
            keys.add(f"domain:{domain}")
            registrable = registrable_domain(domain)
            if registrable and registrable != domain:
                keys.add(f"registrable_domain:{registrable}")
        identity = normalized_company_identity(seed.company)
        if identity:
            country = normalized_name(seed.country or seed.region or "")
            city = normalized_name(seed.city or "")
            keys.add(f"name:{identity}|country:{country}|city:{city}")
        if seed.linkedin_url:
            linkedin_key = normalized_url(seed.linkedin_url)
            if linkedin_key:
                keys.add(f"linkedin:{linkedin_key}")
        if seed.registration_id:
            registration = re.sub(r"[^a-z0-9]+", "", seed.registration_id.lower())
            if registration:
                keys.add(f"registration:{normalized_name(seed.country)}:{registration}")
        return keys

    def score_candidate(self, seed: CompanySeed, evidence: list[Evidence], feedback_notes: list[str]) -> int:
        base = 55
        text = f"{seed.company} {seed.segment} {' '.join(item.observed_fact for item in evidence)}".lower()
        if any(term in text for term in ["m&a", "transaction", "deal", "lbo", "corporate finance"]):
            base += 22
        if any(term in text for term in ["reporting", "document", "client", "workflow", "data room"]):
            base += 12
        if any("mauvais secteur" in note.lower() or "trop petit" in note.lower() for note in feedback_notes):
            base -= 10
        return max(0, min(100, base))

    def save_evidence(self, evidence: list[Evidence]) -> list[Evidence]:
        return evidence


class OpenWebResearchProvider(ConfiguredWebResearchProvider):
    def __init__(self, queries: list[str]):
        self.uses_default_queries = not queries
        self.queries = queries or default_search_queries("core")
        self.seeds: list[CompanySeed] = []
        self.run_steps: list[RunStep] = []

    @classmethod
    def from_env(cls) -> "OpenWebResearchProvider":
        return cls(parse_search_queries(os.getenv("BM_SCOUT_SEARCH_QUERIES", "")))

    def build_candidates(
        self,
        mode: ScoutMode,
        include_weak: bool = False,
        feedback_notes: list[str] | None = None,
        feedback_events: list[FeedbackEvent] | None = None,
    ) -> list[ScoutLead]:
        self.run_steps = []
        queries = default_search_queries(mode) if self.uses_default_queries else self.queries
        target_scan = scan_target_for_mode(mode)
        fetch_limit = fetch_limit_for_mode(mode, target_scan)
        discovered = self.discover_seeds(queries, target_scan)
        self.record_step(
            "search_web",
            {
                "mode": mode,
                "queries": queries,
                "target_scan": target_scan,
                "discovered_count": len(discovered),
                "fetch_limit": fetch_limit,
            },
        )
        discovery_steps = [*self.run_steps]
        self.seeds = discovered[:fetch_limit]
        leads = super().build_candidates(
            mode,
            include_weak=include_weak,
            feedback_notes=feedback_notes,
            feedback_events=feedback_events,
        )
        self.run_steps = [*discovery_steps, *self.run_steps]
        return leads

    def discover_seeds(self, queries: list[str], target_scan: int) -> list[CompanySeed]:
        seeds: list[CompanySeed] = []
        seen: set[str] = set()
        per_query_limit = max(10, min(50, (target_scan // max(1, len(queries))) + 8))
        for query in queries:
            for result in self.search_web(query, "fr", per_query_limit):
                seed = seed_from_search_result(result, query)
                if not seed:
                    continue
                keys = self.dedupe_company_keys(seed)
                if keys & seen:
                    continue
                seen.update(keys)
                seeds.append(seed)
                if len(seeds) >= target_scan:
                    return seeds
        if not seeds:
            raise RuntimeError(
                "Aucun candidat trouvé via recherche web publique. Configure BM_SCOUT_REAL_SEEDS ou BM_SCOUT_SEARCH_QUERIES."
            )
        return seeds

    def search_web(self, query: str, region: str, limit: int) -> list[SearchResult]:
        del region
        url = "https://lite.duckduckgo.com/lite/?q=" + urllib.parse.quote(query)
        request = urllib.request.Request(
            url,
            headers={"user-agent": "Mozilla/5.0 BMScout/1.0 internal research"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                body = response.read(180_000).decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError) as error:
            self.record_step("search_web_error", {"query": query, "error": str(error)})
            return []
        return parse_duckduckgo_lite_results(body, limit)

    def search_jobs(self, company_name: str, domain: str, region: str) -> list[SearchResult]:
        results: list[SearchResult] = []
        seen: set[str] = set()
        for query in job_search_queries(company_name, domain, region):
            for result in self.search_web(query, region, 8):
                if not is_candidate_url(result.url) or not is_job_result(result) or not is_company_related_result(result, company_name, domain):
                    continue
                key = normalized_url(result.url)
                if key in seen:
                    continue
                seen.add(key)
                results.append(result)
                if len(results) >= 3:
                    return results
        return results


class OpenAIWebResearchProvider(OpenWebResearchProvider):
    @classmethod
    def from_env(cls) -> "OpenAIWebResearchProvider":
        return cls(parse_search_queries(os.getenv("BM_SCOUT_SEARCH_QUERIES", "")))

    def search_web(self, query: str, region: str, limit: int) -> list[SearchResult]:
        if not os.getenv("OPENAI_API_KEY"):
            self.record_step("openai_web_search_error", {"query": query, "error": "OPENAI_API_KEY manquant"})
            return []
        from openai import OpenAI

        model = os.getenv("OPENAI_SEARCH_MODEL", os.getenv("OPENAI_MODEL", "gpt-5.5"))
        client = OpenAI()
        try:
            response = client.responses.create(
                model=model,
                input=openai_search_prompt(query, region, limit),
                tools=[
                    {
                        "type": "web_search",
                        "search_context_size": openai_search_context_size(),
                        "user_location": openai_user_location(region),
                    }
                ],
                tool_choice="auto",
                include=["web_search_call.action.sources"],
                max_tool_calls=1,
                max_output_tokens=openai_search_max_output_tokens(),
                store=False,
                text={"verbosity": openai_text_verbosity()},
                timeout=float(os.getenv("OPENAI_SEARCH_TIMEOUT_SECONDS", "45")),
            )
        except Exception as error:
            self.record_step("openai_web_search_error", {"query": query, "error": str(error), "model": model})
            return []
        text = getattr(response, "output_text", "") or ""
        results = parse_openai_search_results(text, limit) or parse_openai_response_sources(response, limit)
        self.record_step(
            "openai_web_search",
            {
                "query": query,
                "region": region,
                "limit": limit,
                "result_count": len(results),
                "model": model,
                "output_text_chars": len(text),
                "output_types": openai_response_output_types(response),
                "source_count": openai_response_source_count(response),
            },
        )
        return results

    def search_jobs(self, company_name: str, domain: str, region: str) -> list[SearchResult]:
        if os.getenv("BM_SCOUT_OPENAI_SEARCH_JOBS", "").strip() == "1":
            return super().search_jobs(company_name, domain, region)

        results: list[SearchResult] = []
        seen: set[str] = set()
        for query in job_search_queries(company_name, domain, region):
            for result in OpenWebResearchProvider.search_web(self, query, region, 8):
                if not is_candidate_url(result.url) or not is_job_result(result) or not is_company_related_result(result, company_name, domain):
                    continue
                key = normalized_url(result.url)
                if key in seen:
                    continue
                seen.add(key)
                results.append(result)
                if len(results) >= 3:
                    return results
        return results


class SerpApiResearchProvider(OpenWebResearchProvider):
    def __init__(self, queries: list[str], api_key: str):
        if not api_key.strip():
            raise RuntimeError("SERPAPI_API_KEY requis pour BM_SCOUT_PROVIDER=serpapi.")
        super().__init__(queries)
        self.api_key = api_key.strip()

    @classmethod
    def from_env(cls) -> "SerpApiResearchProvider":
        api_key = os.getenv("SERPAPI_API_KEY", os.getenv("SERP_API_KEY", ""))
        return cls(parse_search_queries(os.getenv("BM_SCOUT_SEARCH_QUERIES", "")), api_key)

    def search_web(self, query: str, region: str, limit: int) -> list[SearchResult]:
        params = {
            "engine": os.getenv("BM_SCOUT_SERPAPI_ENGINE", "google"),
            "q": query,
            "api_key": self.api_key,
            "hl": "fr" if region.lower().startswith("fr") else "en",
            "gl": "fr" if region.lower().startswith("fr") else region.lower()[:2] or "us",
            "num": str(max(1, min(limit, 20))),
        }
        url = "https://serpapi.com/search.json?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(
            url,
            headers={"user-agent": "BMScout/1.0 internal research; contact: bm-automation"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=18) as response:
                body = response.read(300_000).decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError) as error:
            self.record_step("serpapi_search_error", {"query": query, "error": str(error)})
            return []

        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self.record_step("serpapi_search_error", {"query": query, "error": "Réponse JSON invalide"})
            return []

        if isinstance(payload, dict) and payload.get("error"):
            self.record_step("serpapi_search_error", {"query": query, "error": str(payload["error"])})
            return []

        results = parse_serpapi_results(payload, limit)
        self.record_step(
            "serpapi_search",
            {
                "query": query,
                "region": region,
                "limit": limit,
                "engine": params["engine"],
                "result_count": len(results),
            },
        )
        return results


def provider_from_env() -> ResearchProvider:
    provider = os.getenv("BM_SCOUT_PROVIDER", "auto").lower()
    if provider in {"demo", "fixture", "fixtures"}:
        return DemoFixtureProvider()
    if provider in {"serpapi", "serp_api", "google_serp", "google_search"}:
        return SerpApiResearchProvider.from_env()
    if provider in {"openai", "openai_web", "openai_search"}:
        return OpenAIWebResearchProvider.from_env()
    if provider in {"web", "search", "open_web"}:
        return OpenWebResearchProvider.from_env()
    if provider in {"configured", "configured_strict", "seeds"}:
        return ConfiguredWebResearchProvider.from_env()
    if os.getenv("BM_SCOUT_REAL_SEEDS", "").strip():
        return ConfiguredWebResearchProvider.from_env()
    if os.getenv("SERPAPI_API_KEY", os.getenv("SERP_API_KEY", "")).strip():
        return SerpApiResearchProvider.from_env()
    if os.getenv("OPENAI_API_KEY"):
        return OpenAIWebResearchProvider.from_env()
    if provider == "auto":
        return OpenWebResearchProvider.from_env()
    raise RuntimeError(f"BM_SCOUT_PROVIDER inconnu: {provider}")


def build_candidate_batch(
    mode: ScoutMode,
    *,
    include_weak: bool,
    feedback_notes: list[str],
    feedback_events: list[FeedbackEvent] | None = None,
) -> list[ScoutLead]:
    return build_candidate_batch_with_steps(
        mode,
        include_weak=include_weak,
        feedback_notes=feedback_notes,
        feedback_events=feedback_events,
    ).leads


def build_candidate_batch_with_steps(
    mode: ScoutMode,
    *,
    include_weak: bool,
    feedback_notes: list[str],
    feedback_events: list[FeedbackEvent] | None = None,
) -> CandidateBatch:
    provider = provider_from_env()
    if isinstance(provider, DemoFixtureProvider):
        leads = provider.build_candidates(mode, include_weak=include_weak)
        return CandidateBatch(
            leads=leads,
            run_steps=[
                RunStep(
                    agent_name="bm_scout_provider",
                    step="demo_fixture_batch",
                    event_type="fixture_mode",
                    payload={"mode": mode, "candidate_count": len(leads)},
                )
            ],
        )
    if isinstance(provider, ConfiguredWebResearchProvider):
        leads = provider.build_candidates(
            mode,
            include_weak=include_weak,
            feedback_notes=feedback_notes,
            feedback_events=feedback_events,
        )
        return CandidateBatch(leads=leads, run_steps=provider.run_steps)
    raise RuntimeError("Provider BM Scout inconnu.")


def feedback_effect_payload(before: ScoutLead, after: ScoutLead) -> dict[str, object]:
    return {
        "before_score": before.score,
        "after_score": after.score,
        "score_changed": before.score != after.score,
        "before_verdict": before.verdict,
        "after_verdict": after.verdict,
        "verdict_changed": before.verdict != after.verdict,
        "after_quality_decision": after.quality_decision,
        "blocked_by_feedback": after.quality_decision == "blocked"
        or after.verdict == "reject",
        "blocked_do_not_contact": (
            "do-not-contact" in (after.rejection_reason or "").lower()
            or "do-not-contact" in after.outreach.cold_email.lower()
        ),
        "message_regenerated": "message régénéré" in after.score_justification.lower(),
        "angle_reinforced": "angle validé romu" in after.score_justification.lower(),
        "segment_delta_applied": (
            "mémoire romu : bonus segment" in after.score_justification.lower()
            or "mémoire romu : pénalité segment" in after.score_justification.lower()
        ),
    }


def summarize_feedback_effects(effects: list[dict[str, object]]) -> dict[str, object]:
    return {
        "impact_count": len(effects),
        "score_changed_count": sum(1 for effect in effects if effect.get("score_changed") is True),
        "blocked_count": sum(1 for effect in effects if effect.get("blocked_by_feedback") is True),
        "blocked_do_not_contact_count": sum(1 for effect in effects if effect.get("blocked_do_not_contact") is True),
        "message_regenerated_count": sum(1 for effect in effects if effect.get("message_regenerated") is True),
        "angle_reinforced_count": sum(1 for effect in effects if effect.get("angle_reinforced") is True),
        "segment_delta_count": sum(1 for effect in effects if effect.get("segment_delta_applied") is True),
    }


def parse_company_seeds(value: str) -> list[CompanySeed]:
    if not value.strip():
        return []
    if value.strip().startswith("["):
        payload = json.loads(value)
        return [
            CompanySeed(
                company=item["company"],
                website=item["website"],
                segment=item.get("segment", "M&A / finance ops"),
                region=item.get("region", "fr"),
                source_url=item.get("source_url"),
                city=item.get("city"),
                country=item.get("country", item.get("region", "fr")),
                linkedin_url=item.get("linkedin_url"),
                registration_id=item.get("registration_id") or item.get("siren"),
            )
            for item in payload
        ]
    seeds = []
    for item in value.split(";"):
        parts = [part.strip() for part in item.split("|")]
        if len(parts) >= 2:
            seeds.append(
                CompanySeed(
                    company=parts[0],
                    website=parts[1],
                    segment=parts[2] if len(parts) > 2 else "M&A / finance ops",
                    city=parts[3] if len(parts) > 3 else None,
                    country=parts[4] if len(parts) > 4 else "fr",
                )
            )
    return seeds


def parse_search_queries(value: str) -> list[str]:
    if not value.strip():
        return []
    if value.strip().startswith("["):
        payload = json.loads(value)
        return [str(item).strip() for item in payload if str(item).strip()]
    return [item.strip() for item in value.split(";") if item.strip()]


def default_search_queries(mode: ScoutMode) -> list[str]:
    if mode == "core":
        return [
            "conseil M&A transaction services France",
            "cabinet corporate finance fusion acquisition France",
            "deal advisory transaction services Paris",
            "boutique M&A corporate finance dirigeants PME France",
            "transaction services due diligence financière cabinet France",
        ]
    return [
        "opérations formation B2B inscriptions documents relances France",
        "finance operations reporting multi sites documents France",
        "cabinet expertise comptable collecte pièces relances clients France",
        "gestion patrimoine immobilier documents reporting investisseurs France",
        "asset management immobilier reporting portefeuille investisseurs France",
        "conseil RH paie onboarding documents relances France",
        "organisme formation Qualiopi dossiers apprenants relances France",
        "externalisation DAF reporting consolidation PME multi sites France",
        "administrateur de biens reporting propriétaires relances documents France",
        "courtier assurance entreprise conformité dossiers renouvellement France",
        "conseil paie onboarding salariés documents relances clients France",
        "gestionnaire patrimoine immobilier reporting investisseurs documents France",
        "cabinet audit commissariat comptes collecte pièces clients France",
    ]


def scan_target_for_mode(mode: ScoutMode) -> int:
    env_name = "BM_SCOUT_CORE_TARGET" if mode == "core" else "BM_SCOUT_EXPLORATION_SCAN_TARGET"
    default_value = 15 if mode == "core" else 100
    return max(1, int(os.getenv(env_name, str(default_value))))


def fetch_limit_for_mode(mode: ScoutMode, target_scan: int) -> int:
    default_value = min(target_scan, 15 if mode == "core" else 25)
    return max(1, min(target_scan, int(os.getenv("BM_SCOUT_FETCH_LIMIT", str(default_value)))))


def parse_duckduckgo_lite_results(body: str, limit: int) -> list[SearchResult]:
    results: list[SearchResult] = []
    pattern = re.compile(r'<a rel="nofollow" href="([^"]+)"[^>]*>(.*?)</a>', re.S)
    for match in pattern.finditer(body):
        url = unwrap_duckduckgo_url(html.unescape(match.group(1)))
        title = clean_html_text(match.group(2))
        if not url or not title or not is_candidate_url(url):
            continue
        results.append(SearchResult(title=title, url=url, snippet=title))
        if len(results) >= limit:
            break
    return results


def openai_search_prompt(query: str, region: str, limit: int) -> str:
    return f"""
Tu recherches des entreprises B2B françaises pour BM Scout.
Requête: {query}
Région: {region}
Nombre maximum: {limit}

Retourne uniquement un JSON valide, sans markdown :
{{
  "results": [
    {{
      "title": "Nom ou titre de la source",
      "url": "https://domaine-public",
      "snippet": "Signal concret observé en une phrase"
    }}
  ]
}}

Contraintes :
- privilégie sites officiels entreprise, pages services, jobs, communiqués ;
- exclue annuaires faibles, réseaux sociaux, articles génériques et pages impossibles à sourcer ;
- chaque snippet doit contenir un signal utile pour qualification, pas une phrase marketing vague.
"""


def openai_text_verbosity() -> str:
    configured = os.getenv("OPENAI_TEXT_VERBOSITY", "").strip()
    return configured or "medium"


def openai_search_context_size() -> str:
    configured = os.getenv("OPENAI_SEARCH_CONTEXT_SIZE", "").strip()
    return configured if configured in {"low", "medium", "high"} else "medium"


def openai_search_max_output_tokens() -> int:
    configured = os.getenv("OPENAI_SEARCH_MAX_OUTPUT_TOKENS", "").strip()
    try:
        value = int(configured or "2400")
    except ValueError:
        value = 2400
    return max(800, value)


def parse_openai_search_results(text: str, limit: int) -> list[SearchResult]:
    payload = extract_json_payload(text)
    if not payload:
        return parse_url_results_from_text(text, limit)
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return parse_url_results_from_text(text, limit)
    items = data.get("results", data if isinstance(data, list) else [])
    results: list[SearchResult] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url", "")).strip()
        title = str(item.get("title", "")).strip()
        snippet = str(item.get("snippet", "")).strip()
        if not url or not title or not is_candidate_url(url):
            continue
        results.append(SearchResult(title=title, url=url, snippet=snippet or title))
        if len(results) >= limit:
            break
    return results or parse_url_results_from_text(text, limit)


def parse_serpapi_results(payload: object, limit: int) -> list[SearchResult]:
    if not isinstance(payload, dict):
        return []
    organic_results = payload.get("organic_results", [])
    if not isinstance(organic_results, list):
        return []

    results: list[SearchResult] = []
    for item in organic_results:
        if not isinstance(item, dict):
            continue
        url = str(item.get("link", "")).strip()
        title = str(item.get("title", "")).strip()
        snippet = str(item.get("snippet", "")).strip()
        if not url or not title or not is_candidate_url(url):
            continue
        results.append(SearchResult(title=title, url=url, snippet=snippet or title))
        if len(results) >= limit:
            break
    return results


def parse_openai_response_sources(response: object, limit: int) -> list[SearchResult]:
    results: list[SearchResult] = []
    seen: set[str] = set()
    for source in iter_openai_response_sources(response):
        url = str(read_attr(source, "url", "") or "").strip()
        title = str(read_attr(source, "title", "") or "").strip() or normalized_domain(url)
        snippet = str(read_attr(source, "snippet", "") or read_attr(source, "summary", "") or "").strip()
        if not url or not is_candidate_url(url):
            continue
        key = normalized_url(url)
        if key in seen:
            continue
        seen.add(key)
        results.append(SearchResult(title=title, url=url, snippet=snippet or title))
        if len(results) >= limit:
            break
    return results


def parse_url_results_from_text(text: str, limit: int) -> list[SearchResult]:
    results: list[SearchResult] = []
    seen: set[str] = set()
    for match in re.finditer(r"https?://[^\s\"'<>),]+", text):
        url = match.group(0).rstrip(".,;:]}").strip()
        if not url or not is_candidate_url(url):
            continue
        key = normalized_url(url)
        if key in seen:
            continue
        seen.add(key)
        title = normalized_domain(url) or url
        snippet = sentence_around(text, match.start(), match.end()) or title
        results.append(SearchResult(title=title, url=url, snippet=snippet))
        if len(results) >= limit:
            break
    return results


def sentence_around(text: str, start: int, end: int) -> str:
    left = max(text.rfind("\n", 0, start), text.rfind(". ", 0, start))
    right_candidates = [index for index in [text.find("\n", end), text.find(". ", end)] if index >= 0]
    right = min(right_candidates) if right_candidates else min(len(text), end + 180)
    return clean_html_text(text[left + 1 : right]).strip()[:240]


def iter_openai_response_sources(response: object) -> list[object]:
    sources: list[object] = []
    for output_item in read_iterable_attr(response, "output"):
        action = read_attr(output_item, "action")
        sources.extend(read_iterable_attr(action, "sources"))
        sources.extend(read_iterable_attr(output_item, "sources"))
    return sources


def openai_response_source_count(response: object) -> int:
    return len(iter_openai_response_sources(response))


def openai_response_output_types(response: object) -> list[str]:
    return [str(read_attr(item, "type", "unknown") or "unknown") for item in read_iterable_attr(response, "output")]


def read_attr(item: object, name: str, default: object | None = None) -> object | None:
    if item is None:
        return default
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def read_iterable_attr(item: object, name: str) -> list[object]:
    value = read_attr(item, name, [])
    return value if isinstance(value, list) else []


def openai_user_location(region: str) -> dict[str, str]:
    country = "FR" if region.lower().startswith("fr") else region[:2].upper() or "FR"
    return {"type": "approximate", "country": country}


def extract_json_payload(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped).strip()
    if stripped.startswith("{") or stripped.startswith("["):
        return stripped
    start = min((index for index in [stripped.find("{"), stripped.find("[")] if index >= 0), default=-1)
    if start < 0:
        return ""
    end_char = "}" if stripped[start] == "{" else "]"
    end = stripped.rfind(end_char)
    return stripped[start : end + 1] if end > start else ""


def unwrap_duckduckgo_url(value: str) -> str:
    if value.startswith("//"):
        value = "https:" + value
    parsed = urlparse(value)
    if "duckduckgo.com" in parsed.netloc:
        params = urllib.parse.parse_qs(parsed.query)
        target = params.get("uddg", [None])[0]
        return target or ""
    return value


def clean_html_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(value))).strip()


def is_candidate_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False
    domain = parsed.netloc.lower()
    path = parsed.path.lower()
    blocked_domains = ("linkedin.com", "facebook.com", "youtube.com", "wikipedia.org", "duckduckgo.com", "bing.com", "google.com")
    blocked_paths = ("/blog", "/news", "/actualite", "/classement")
    return not any(blocked in domain for blocked in blocked_domains) and not any(blocked in path for blocked in blocked_paths)


def job_search_queries(company_name: str, domain: str, region: str) -> list[str]:
    scoped_query = f"site:{domain} recrutement OR careers OR jobs" if domain else f'"{company_name}" recrutement careers jobs'
    return [
        scoped_query,
        f'"{company_name}" recrutement finance operations reporting {region}',
        f'"{company_name}" careers transaction services operations {region}',
    ]


def is_job_result(result: SearchResult) -> bool:
    text = f"{result.title} {result.url} {result.snippet}".lower()
    job_terms = (
        "career",
        "careers",
        "job",
        "jobs",
        "emploi",
        "offre d'emploi",
        "offres d'emploi",
        "recrutement",
        "recrute",
        "hiring",
        "talent acquisition",
    )
    return any(term in text for term in job_terms)


def is_company_related_result(result: SearchResult, company_name: str, domain: str) -> bool:
    result_domain = normalized_domain(result.url)
    if domain and (result_domain == domain or result_domain.endswith(f".{domain}")):
        return True
    text = f"{result.title} {result.url} {result.snippet}".lower()
    ignored_tokens = {"com", "fr", "www", "net", "org", "io", "co", "eu", "sas", "ltd", "group", "groupe"}
    tokens = [token for token in re.split(r"[^a-z0-9]+", company_name.lower()) if len(token) >= 4 and token not in ignored_tokens]
    return bool(tokens) and any(token in text for token in tokens)


def job_results_to_evidence(results: list[SearchResult]) -> list[Evidence]:
    return [
        Evidence(
            label="Recrutement public",
            url=result.url,
            observed_fact=f"Source recrutement publique détectée : {result.snippet or result.title}",
            reliability="medium",
        )
        for result in results[:2]
    ]


def job_results_to_signals(results: list[SearchResult]) -> list[str]:
    return [
        "Une source de recrutement publique suggère des besoins opérationnels ou de coordination à confirmer."
        for _result in results[:1]
    ]


def unique_items(items: list[str]) -> list[str]:
    seen: set[str] = set()
    values: list[str] = []
    for item in items:
        key = item.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        values.append(item)
    return values


def seed_from_search_result(result: SearchResult, query: str) -> CompanySeed | None:
    domain = normalized_domain(result.url)
    if not domain:
        return None
    company = company_name_from_title(result.title, domain)
    segment = infer_segment(result.title, result.url, query)
    return CompanySeed(company=company, website=origin_from_url(result.url), segment=segment, source_url=result.url)


def company_name_from_title(title: str, domain: str) -> str:
    parts = [part.strip() for part in re.split(r"\s(?:-|–|\|)\s|:", title) if part.strip()]
    generic_terms = ("transaction", "conseil", "service", "deal", "m&a", "fusion", "acquisition", "corporate finance")
    if len(parts) > 1 and any(term in parts[0].lower() for term in generic_terms):
        return parts[-1]
    if parts:
        return parts[0]
    return domain.split(".")[0].replace("-", " ").title()


def infer_segment(title: str, url: str, query: str) -> str:
    text = f"{title} {url} {query}".lower()
    if any(term in text for term in ["m&a", "fusion", "acquisition", "deal", "transaction", "corporate finance"]):
        return "Conseil M&A / deal advisory"
    if "formation" in text:
        return "Formation B2B"
    if any(term in text for term in ["reporting", "finance", "daf", "comptable"]):
        return "Finance ops"
    return "Exploration B2B process-heavy"


def origin_from_url(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def normalized_url(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc.lower()}{parsed.path.rstrip('/')}"


def to_scout_lead(
    seed: CompanySeed,
    mode: ScoutMode,
    score: int,
    signals: list[str],
    evidence: list[Evidence],
    emails: list[dict[str, str]],
) -> ScoutLead:
    lead_id = f"{mode}-{hashlib.sha1((seed.company + seed.website).encode('utf-8')).hexdigest()[:10]}"
    primary_email = emails[0] if emails else {}
    email_source_url = (
        primary_email.get("source_url") or evidence[0].url
        if primary_email and evidence
        else None
    )
    outreach = (
        OutreachPack(
            cold_email=(
                f"Bonjour,\n\nJe suis Arthur de BM Automation. J'ai vu un signal public côté {seed.company} : {signals[0]}\n\n"
                "Hypothèse prudente : une partie du suivi opérationnel repasse peut-être entre emails, documents et reporting.\n\n"
                "Est-ce un workflow utile à vérifier en 15 minutes ? Si vous ne souhaitez pas être recontacté, dites-le simplement."
            ),
            follow_up="Bonjour,\n\nJe me permets une relance courte sur le point workflow entre outils. Utile d'en parler ou préférable que je n'insiste pas ?",
            linkedin=f"Bonjour, j'ai vu un signal public chez {seed.company}. Je cherche à vérifier une friction très ciblée entre emails, documents et reporting. Ouvert à un échange court ?",
        )
        if mode == "core" and score >= 75
        else OutreachPack(
            cold_email="Brouillon bloqué : signal insuffisant ou Exploration non promue.",
            follow_up="Brouillon bloqué.",
            linkedin="Brouillon bloqué.",
        )
    )
    return ScoutLead(
        id=lead_id,
        company=seed.company,
        website=seed.website,
        mode=mode,
        segment=seed.segment,
        score=score,
        verdict="validate" if mode == "core" and score >= 75 else "watch",
        quality_decision="pass" if evidence and score >= 75 else "needs_enrichment",
        observed_signals=signals,
        pain_hypotheses=["Possible tâche grise entre emails, documents, reporting et outils existants."],
        score_justification=f"Score calculé à partir de {len(evidence)} preuve(s) publique(s), segment {seed.segment}, et signaux extraits.",
        short_card=f"{seed.company} : compte issu du provider réel configuré, à valider avant toute action.",
        deep_card="Fiche générée depuis source publique configurée. Les outils internes, volumes exacts et décideurs restent à confirmer.",
        personas=[
            Persona(
                role="Operations / Partner",
                reason="Persona à vérifier : proche des tâches de coordination et arbitrage commercial.",
                contact_confidence="role_only",
                email=primary_email.get("email"),
                email_type=primary_email.get("type", "unknown"),
                email_confidence=primary_email.get("confidence", "low"),
                email_status=email_status_with_source(primary_email, email_source_url),
                email_source_url=email_source_url,
            )
        ],
        evidence=evidence,
        insights=StructuredInsights(
            observed=[
                {"text": signal, "evidence_id": evidence[min(index, len(evidence) - 1)].url if evidence else ""}
                for index, signal in enumerate(signals)
            ],
            inferred=["Possible tâche grise entre emails, documents, reporting et outils existants."],
            uncertain=["Décideur exact, email nominatif et outils internes à confirmer."],
        ),
        outreach=outreach,
        quality_gates=[
            QualityGate(code="provider_real", passed=True, reason="Candidat issu du provider réel configuré."),
            QualityGate(code="source", passed=bool(evidence), reason="Preuve publique enregistrée." if evidence else "Preuve absente."),
        ],
        next_action="Valider la pertinence ICP et enrichir le décideur exact.",
    )


def normalized_domain(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


GENERIC_EMAIL_LOCAL_PARTS = {
    "contact",
    "info",
    "hello",
    "bonjour",
    "support",
    "recrutement",
    "jobs",
    "careers",
}

BLOCKED_EMAIL_LOCAL_PARTS = {"noreply", "no-reply", "donotreply", "do-not-reply", "webmaster"}
PATTERN_EMAIL_MARKERS = {"firstname", "lastname", "first.last", "prenom", "nom", "prénom"}


def classify_public_email(email: str, domain: str) -> dict[str, str] | None:
    local_part, _, email_domain = email.partition("@")
    if not local_part or not email_domain:
        return None
    if domain:
        allowed_domains = {domain, registrable_domain(domain)}
        if email_domain.removeprefix("www.") not in allowed_domains:
            return None
    normalized_local = normalized_name(local_part).replace("-", ".")
    if local_part in BLOCKED_EMAIL_LOCAL_PARTS or normalized_local in BLOCKED_EMAIL_LOCAL_PARTS:
        return None
    if local_part_looks_like_pattern(normalized_local):
        return {"email": email, "type": "probable_pattern", "confidence": "low", "status": "verify"}
    if local_part in GENERIC_EMAIL_LOCAL_PARTS or normalized_local in GENERIC_EMAIL_LOCAL_PARTS:
        return {"email": email, "type": "generic", "confidence": "medium", "status": "verify"}
    return {"email": email, "type": "public_named", "confidence": "high", "status": "usable"}


def email_priority(item: dict[str, str]) -> tuple[int, int, str]:
    status_rank = {"usable": 0, "verify": 1, "not_usable": 2}
    type_rank = {"public_named": 0, "generic": 1, "probable_pattern": 2, "unknown": 3}
    return (status_rank.get(item.get("status", "not_usable"), 2), type_rank.get(item.get("type", "unknown"), 3), item.get("email", ""))


def local_part_looks_like_pattern(normalized_local: str) -> bool:
    tokens = [token for token in re.split(r"[._-]+", normalized_local) if token]
    if any(token in PATTERN_EMAIL_MARKERS for token in tokens):
        return True
    return normalized_local in PATTERN_EMAIL_MARKERS


def email_status_with_source(item: dict[str, str], source_url: str | None) -> str:
    status = item.get("status", "not_usable")
    if status == "usable" and not source_url:
        return "verify"
    return status


def normalized_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def normalized_company_identity(name: str) -> str:
    normalized = normalized_name(
        re.sub(
            r"\b(sas|sasu|sa|sarl|eurl|llc|ltd|limited|inc|gmbh|group|groupe|partners?|partner|associ[eé]s?|france)\b",
            " ",
            name.lower(),
        )
    )
    tokens = [
        token
        for token in normalized.split("-")
        if token and token not in {"the", "and", "et", "of", "de", "du", "des", "la", "le", "les", "cabinet", "conseil"}
    ]
    value = "-".join(tokens)
    generic = {"m-a", "ma", "finance", "consulting", "advisory", "transaction", "services", "contact", "accueil"}
    if len(value.replace("-", "")) < 4 or value in generic:
        return ""
    return value


def registrable_domain(domain: str) -> str:
    parts = [part for part in domain.lower().split(".") if part]
    if len(parts) < 2:
        return domain
    two_part_suffixes = {"co.uk", "com.au", "com.br", "com.tr", "co.jp"}
    suffix = ".".join(parts[-2:])
    if suffix in two_part_suffixes and len(parts) >= 3:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def strip_html(value: str) -> str:
    return re.sub(r"<[^>]+>", " ", value)
