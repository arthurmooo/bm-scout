from __future__ import annotations

from agents import function_tool

from .providers import CompanySeed, provider_from_env
from .tool_recorder import record_tool_call


@function_tool
def search_web(query: str, region: str = "fr", limit: int = 5) -> list[dict[str, str]]:
    """Recherche des candidats publics via le provider BM Scout configuré."""
    provider = provider_from_env()
    inputs = {"query": query, "region": region, "limit": limit}
    try:
        output = [result.__dict__ for result in provider.search_web(query, region, limit)]
    except Exception as error:
        record_tool_call("search_web", inputs, error=error)
        raise
    record_tool_call("search_web", inputs, {"result_count": len(output), "results": output})
    return output


@function_tool
def fetch_company_site(url: str) -> str:
    """Récupère le contenu public d'un site entreprise."""
    inputs = {"url": url}
    try:
        output = provider_from_env().fetch_company_site(url)
    except Exception as error:
        record_tool_call("fetch_company_site", inputs, error=error)
        raise
    record_tool_call("fetch_company_site", inputs, {"chars": len(output), "failed": output.startswith("Fetch failed")})
    return output


@function_tool
def extract_company_signals(html_or_text: str) -> list[str]:
    """Extrait des signaux observés depuis un contenu public."""
    inputs = {"chars": len(html_or_text)}
    try:
        output = provider_from_env().extract_company_signals(html_or_text)
    except Exception as error:
        record_tool_call("extract_company_signals", inputs, error=error)
        raise
    record_tool_call("extract_company_signals", inputs, {"signal_count": len(output), "signals": output})
    return output


@function_tool
def search_jobs(company_name: str, domain: str, region: str = "fr") -> list[dict[str, str]]:
    """Recherche des signaux d'offres d'emploi publiques."""
    provider = provider_from_env()
    inputs = {"company_name": company_name, "domain": domain, "region": region}
    try:
        output = [result.__dict__ for result in provider.search_jobs(company_name, domain, region)]
    except Exception as error:
        record_tool_call("search_jobs", inputs, error=error)
        raise
    record_tool_call("search_jobs", inputs, {"result_count": len(output), "results": output})
    return output


@function_tool
def find_public_emails(company_name: str, domain: str, pages: list[str]) -> list[dict[str, str]]:
    """Détecte uniquement des emails publics observés, jamais des patterns inventés."""
    inputs = {"company_name": company_name, "domain": domain, "page_count": len(pages)}
    try:
        output = provider_from_env().find_public_emails(company_name, domain, pages)
    except Exception as error:
        record_tool_call("find_public_emails", inputs, error=error)
        raise
    record_tool_call("find_public_emails", inputs, {"email_count": len(output), "emails": output})
    return output


@function_tool
def dedupe_company(
    company_name: str,
    website: str,
    segment: str = "M&A / finance ops",
    city: str | None = None,
    country: str = "fr",
    linkedin_url: str | None = None,
    registration_id: str | None = None,
) -> str:
    """Retourne une clé de déduplication prudente domaine/nom/pays/ville/identifiant."""
    inputs = {
        "company_name": company_name,
        "website": website,
        "segment": segment,
        "city": city,
        "country": country,
        "has_linkedin_url": bool(linkedin_url),
        "has_registration_id": bool(registration_id),
    }
    try:
        output = provider_from_env().dedupe_company(
            CompanySeed(
                company=company_name,
                website=website,
                segment=segment,
                city=city,
                country=country,
                linkedin_url=linkedin_url,
                registration_id=registration_id,
            )
        )
    except Exception as error:
        record_tool_call("dedupe_company", inputs, error=error)
        raise
    record_tool_call("dedupe_company", inputs, {"dedupe_key": output})
    return output


@function_tool
def score_candidate(company_name: str, website: str, segment: str, observed_facts: list[str], feedback_notes: list[str]) -> int:
    """Score un candidat depuis preuves observées et mémoire feedback."""
    from .schemas import Evidence

    inputs = {
        "company_name": company_name,
        "website": website,
        "segment": segment,
        "observed_fact_count": len(observed_facts),
        "feedback_notes_count": len(feedback_notes),
    }
    evidence = [
        Evidence(label="Fait observé", url=website, observed_fact=fact, reliability="medium")
        for fact in observed_facts
    ]
    try:
        output = provider_from_env().score_candidate(
            CompanySeed(company=company_name, website=website, segment=segment),
            evidence,
            feedback_notes,
        )
    except Exception as error:
        record_tool_call("score_candidate", inputs, error=error)
        raise
    record_tool_call("score_candidate", inputs, {"score": output})
    return output


@function_tool
def save_evidence(company_name: str, website: str, observed_facts: list[str]) -> list[dict[str, str]]:
    """Prépare les preuves observées pour persistance Supabase."""
    from .schemas import Evidence

    inputs = {"company_name": company_name, "website": website, "observed_fact_count": len(observed_facts)}
    try:
        evidence = provider_from_env().save_evidence(
            [
                Evidence(label=f"Preuve publique - {company_name}", url=website, observed_fact=fact, reliability="medium")
                for fact in observed_facts
            ]
        )
        output = [item.model_dump(mode="json") for item in evidence]
    except Exception as error:
        record_tool_call("save_evidence", inputs, error=error)
        raise
    record_tool_call("save_evidence", inputs, {"evidence_count": len(output), "evidence": output})
    return output
