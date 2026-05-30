from __future__ import annotations

from agents import function_tool

from .providers import CompanySeed, provider_from_env


@function_tool
def search_web(query: str, region: str = "fr", limit: int = 5) -> list[dict[str, str]]:
    """Recherche des candidats publics via le provider BM Scout configuré."""
    provider = provider_from_env()
    return [result.__dict__ for result in provider.search_web(query, region, limit)]


@function_tool
def fetch_company_site(url: str) -> str:
    """Récupère le contenu public d'un site entreprise."""
    return provider_from_env().fetch_company_site(url)


@function_tool
def extract_company_signals(html_or_text: str) -> list[str]:
    """Extrait des signaux observés depuis un contenu public."""
    return provider_from_env().extract_company_signals(html_or_text)


@function_tool
def search_jobs(company_name: str, domain: str, region: str = "fr") -> list[dict[str, str]]:
    """Recherche des signaux d'offres d'emploi publiques."""
    provider = provider_from_env()
    return [result.__dict__ for result in provider.search_jobs(company_name, domain, region)]


@function_tool
def find_public_emails(company_name: str, domain: str, pages: list[str]) -> list[dict[str, str]]:
    """Détecte uniquement des emails publics observés, jamais des patterns inventés."""
    return provider_from_env().find_public_emails(company_name, domain, pages)


@function_tool
def dedupe_company(company_name: str, website: str, segment: str = "M&A / finance ops") -> str:
    """Retourne une clé de déduplication prudente domaine/nom."""
    return provider_from_env().dedupe_company(CompanySeed(company=company_name, website=website, segment=segment))


@function_tool
def score_candidate(company_name: str, website: str, segment: str, observed_facts: list[str], feedback_notes: list[str]) -> int:
    """Score un candidat depuis preuves observées et mémoire feedback."""
    from .schemas import Evidence

    evidence = [
        Evidence(label="Fait observé", url=website, observed_fact=fact, reliability="medium")
        for fact in observed_facts
    ]
    return provider_from_env().score_candidate(
        CompanySeed(company=company_name, website=website, segment=segment),
        evidence,
        feedback_notes,
    )


@function_tool
def save_evidence(company_name: str, website: str, observed_facts: list[str]) -> list[dict[str, str]]:
    """Prépare les preuves observées pour persistance Supabase."""
    from .schemas import Evidence

    evidence = provider_from_env().save_evidence(
        [
            Evidence(label=f"Preuve publique - {company_name}", url=website, observed_fact=fact, reliability="medium")
            for fact in observed_facts
        ]
    )
    return [item.model_dump(mode="json") for item in evidence]
