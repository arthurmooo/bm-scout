from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlparse

from .fixtures import candidate_leads
from .schemas import Evidence, OutreachPack, Persona, QualityGate, RunStep, ScoutLead, ScoutMode, StructuredInsights


@dataclass(frozen=True)
class CompanySeed:
    company: str
    website: str
    segment: str = "M&A / finance ops"
    region: str = "fr"


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

    def build_candidates(self, mode: ScoutMode, include_weak: bool = False, feedback_notes: list[str] | None = None) -> list[ScoutLead]:
        candidates: list[ScoutLead] = []
        seen_keys: set[str] = set()
        self.run_steps = []
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
            page = self.fetch_company_site(seed.website)
            self.record_step("fetch_company_site", {"company": seed.company, "url": seed.website, "chars": len(page), "failed": page.startswith("Fetch failed")})
            signals = self.extract_company_signals(page)
            self.record_step("extract_company_signals", {"company": seed.company, "signal_count": len(signals), "signals": signals[:3]})
            domain = normalized_domain(seed.website)
            emails = self.find_public_emails(seed.company, domain, [page])
            self.record_step("find_public_emails", {"company": seed.company, "domain": domain, "email_count": len(emails)})
            evidence = self.save_evidence(
                [
                    Evidence(
                        label="Site public",
                        url=seed.website,
                        observed_fact=signals[0] if signals else f"Page publique consultée pour {seed.company}.",
                        reliability="medium",
                    )
                ]
            )
            self.record_step("save_evidence", {"company": seed.company, "evidence_count": len(evidence)})
            score = self.score_candidate(seed, evidence, feedback_notes or [])
            self.record_step("score_candidate", {"company": seed.company, "score": score, "feedback_notes_count": len(feedback_notes or [])})
            candidates.append(to_scout_lead(seed, mode, score, signals, evidence, emails))
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


def provider_from_env() -> ResearchProvider:
    provider = os.getenv("BM_SCOUT_PROVIDER", "configured").lower()
    if provider in {"demo", "fixture", "fixtures"}:
        return DemoFixtureProvider()
    return ConfiguredWebResearchProvider.from_env()


def build_candidate_batch(
    mode: ScoutMode,
    *,
    include_weak: bool,
    feedback_notes: list[str],
) -> list[ScoutLead]:
    return build_candidate_batch_with_steps(mode, include_weak=include_weak, feedback_notes=feedback_notes).leads


def build_candidate_batch_with_steps(
    mode: ScoutMode,
    *,
    include_weak: bool,
    feedback_notes: list[str],
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
        leads = provider.build_candidates(mode, include_weak=include_weak, feedback_notes=feedback_notes)
        return CandidateBatch(leads=leads, run_steps=provider.run_steps)
    raise RuntimeError("Provider BM Scout inconnu.")


def parse_company_seeds(value: str) -> list[CompanySeed]:
    if not value.strip():
        return []
    if value.strip().startswith("["):
        payload = json.loads(value)
        return [CompanySeed(company=item["company"], website=item["website"], segment=item.get("segment", "M&A / finance ops"), region=item.get("region", "fr")) for item in payload]
    seeds = []
    for item in value.split(";"):
        parts = [part.strip() for part in item.split("|")]
        if len(parts) >= 2:
            seeds.append(CompanySeed(company=parts[0], website=parts[1], segment=parts[2] if len(parts) > 2 else "M&A / finance ops"))
    return seeds


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
                email_source_url=seed.website if emails else None,
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
