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
            dedupe_key = self.dedupe_company(seed)
            if dedupe_key in seen_keys:
                self.record_step(
                    "dedupe_company",
                    {"company": seed.company, "website": seed.website, "dedupe_key": dedupe_key, "decision": "skipped_duplicate"},
                )
                continue
            seen_keys.add(dedupe_key)
            self.record_step("dedupe_company", {"company": seed.company, "website": seed.website, "dedupe_key": dedupe_key, "decision": "kept"})
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
                self.record_step(
                    "apply_feedback_memory",
                    {
                        "company": lead.company,
                        "before_score": lead.score,
                        "after_score": adjusted.score,
                        "before_verdict": lead.verdict,
                        "after_verdict": adjusted.verdict,
                        "after_quality_decision": adjusted.quality_decision,
                    },
                )
            candidates.append(adjusted)
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
            with urllib.request.urlopen(request, timeout=12) as response:
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
        pattern = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
        for page in pages:
            for email in pattern.findall(page):
                if domain and not email.lower().endswith("@" + domain):
                    continue
                normalized = email.lower()
                local_part = normalized.split("@", 1)[0]
                email_type = "generic" if local_part in {"contact", "info", "hello", "bonjour", "support"} else "public_named"
                emails.append({"email": normalized, "type": email_type, "confidence": "medium"})
        return emails[:3]

    def dedupe_company(self, seed: CompanySeed) -> str:
        return normalized_domain(seed.website) or normalized_name(seed.company)

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
        per_query_limit = max(10, min(30, target_scan))
        for query in queries:
            for result in self.search_web(query, "fr", per_query_limit):
                seed = seed_from_search_result(result, query)
                if not seed:
                    continue
                key = self.dedupe_company(seed)
                if key in seen:
                    continue
                seen.add(key)
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
                tools=[{"type": "web_search", "search_context_size": "low", "external_web_access": True}],
                tool_choice="required",
                max_output_tokens=1200,
            )
        except Exception as error:
            self.record_step("openai_web_search_error", {"query": query, "error": str(error), "model": model})
            return []
        text = getattr(response, "output_text", "") or ""
        results = parse_openai_search_results(text, limit)
        self.record_step(
            "openai_web_search",
            {"query": query, "region": region, "limit": limit, "result_count": len(results), "model": model},
        )
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
            )
            for item in payload
        ]
    seeds = []
    for item in value.split(";"):
        parts = [part.strip() for part in item.split("|")]
        if len(parts) >= 2:
            seeds.append(CompanySeed(company=parts[0], website=parts[1], segment=parts[2] if len(parts) > 2 else "M&A / finance ops"))
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
            "deal advisory transaction services Paris"
        ]
    return [
        "opérations formation B2B inscriptions documents relances France",
        "finance operations reporting multi sites documents France",
        "services B2B processus documents relances CRM France"
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


def parse_openai_search_results(text: str, limit: int) -> list[SearchResult]:
    payload = extract_json_payload(text)
    if not payload:
        return []
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return []
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
    return results


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
    tokens = [token for token in re.split(r"[^a-z0-9]+", company_name.lower()) if len(token) >= 3]
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
        verdict="validate" if mode == "core" and score >= 80 else "watch",
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
                email=emails[0]["email"] if emails else None,
                email_type=emails[0]["type"] if emails else "unknown",
                email_confidence=emails[0]["confidence"] if emails else "low",
                email_status="verify" if emails else "not_usable",
                email_source_url=evidence[0].url if emails and evidence else None,
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


def normalized_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def strip_html(value: str) -> str:
    return re.sub(r"<[^>]+>", " ", value)
