from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from .providers import (
    ConfiguredWebResearchProvider,
    OpenAIWebResearchProvider,
    OpenWebResearchProvider,
    SerpApiResearchProvider,
    fetch_limit_for_mode,
    scan_target_for_mode,
)
from .runtime import code_revision, package_version
from .schemas import RunStep, ScoutLead, ScoutMode

ProviderAuditStatus = Literal["pass", "fail", "unavailable"]
PRD_MODES: set[ScoutMode] = {"core", "exploration"}


@dataclass
class ProviderModeAudit:
    provider: str
    mode: ScoutMode
    status: ProviderAuditStatus
    target_scan: int
    fetch_limit: int
    discovered_count: int
    candidate_count: int
    quality_pass_count: int
    evidence_count: int
    sourced_observed_count: int
    source_domains: list[str]
    scan_target_reached: bool
    fetch_target_reached: bool
    blockers: list[str]
    run_steps: list[dict[str, object]]
    error: str | None = None


@dataclass
class ProviderComparisonReport:
    verdict: Literal["pass", "fail"]
    generated_at: str
    code_revision: str
    python_version: str
    openai_sdk_version: str
    providers: list[str]
    modes: list[ScoutMode]
    prd_volume_proven: bool
    recommended_default: str | None
    blockers: list[str]
    results: list[ProviderModeAudit]


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare les providers réels BM Scout sans passer par fixtures.")
    parser.add_argument("--providers", default=os.getenv("BM_SCOUT_PROVIDER_COMPARISON", "serpapi,openai_web,web"))
    parser.add_argument("--modes", default="core,exploration")
    parser.add_argument("--artifacts-dir", default="artifacts/provider-comparison")
    args = parser.parse_args()

    providers = parse_provider_list(args.providers)
    modes = parse_modes(args.modes)
    report = compare_providers(providers, modes)

    artifacts_dir = Path(args.artifacts_dir)
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    payload = report_to_dict(report)
    (artifacts_dir / "latest-comparison.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (artifacts_dir / "latest-comparison.md").write_text(render_markdown(report), encoding="utf-8")

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report.verdict == "pass" else 1)


def compare_providers(providers: list[str], modes: list[ScoutMode]) -> ProviderComparisonReport:
    results = [audit_provider_mode(provider, mode) for provider in providers for mode in modes]
    blockers = comparison_blockers(results, modes)
    return ProviderComparisonReport(
        verdict="pass" if not blockers else "fail",
        generated_at=datetime.now(UTC).isoformat(),
        code_revision=code_revision(),
        python_version=sys.version.split()[0],
        openai_sdk_version=package_version("openai"),
        providers=providers,
        modes=modes,
        prd_volume_proven=prd_volume_proven(results, modes),
        recommended_default=recommended_default_provider(results, modes),
        blockers=blockers,
        results=results,
    )


def audit_provider_mode(provider_name: str, mode: ScoutMode) -> ProviderModeAudit:
    target_scan = scan_target_for_mode(mode)
    fetch_limit = fetch_limit_for_mode(mode, target_scan)
    unavailable = provider_unavailable_reason(provider_name)
    if unavailable:
        return ProviderModeAudit(
            provider=provider_name,
            mode=mode,
            status="unavailable",
            target_scan=target_scan,
            fetch_limit=fetch_limit,
            discovered_count=0,
            candidate_count=0,
            quality_pass_count=0,
            evidence_count=0,
            sourced_observed_count=0,
            source_domains=[],
            scan_target_reached=False,
            fetch_target_reached=False,
            blockers=[unavailable],
            run_steps=[],
            error=unavailable,
        )

    provider = None
    try:
        provider = build_named_provider(provider_name)
        leads = provider.build_candidates(mode, include_weak=False, feedback_notes=[], feedback_events=[])
        run_steps = getattr(provider, "run_steps", [])
        discovered_count = discovered_count_from_steps(run_steps)
        source_domains = sorted({domain_from_url(item.url) for lead in leads for item in lead.evidence if domain_from_url(item.url)})
        blockers = provider_mode_blockers(provider_name, mode, leads)
        return ProviderModeAudit(
            provider=provider_name,
            mode=mode,
            status="pass" if not blockers else "fail",
            target_scan=target_scan,
            fetch_limit=fetch_limit,
            discovered_count=discovered_count,
            candidate_count=len(leads),
            quality_pass_count=sum(1 for lead in leads if lead.quality_decision == "pass"),
            evidence_count=sum(len(lead.evidence) for lead in leads),
            sourced_observed_count=sum(1 for lead in leads if has_sourced_observed(lead)),
            source_domains=source_domains,
            scan_target_reached=discovered_count >= target_scan,
            fetch_target_reached=len(leads) >= fetch_limit,
            blockers=blockers,
            run_steps=compact_run_steps(run_steps),
        )
    except Exception as error:
        run_steps = getattr(provider, "run_steps", []) if provider else []
        discovered_count = discovered_count_from_steps(run_steps)
        return ProviderModeAudit(
            provider=provider_name,
            mode=mode,
            status="fail",
            target_scan=target_scan,
            fetch_limit=fetch_limit,
            discovered_count=discovered_count,
            candidate_count=0,
            quality_pass_count=0,
            evidence_count=0,
            sourced_observed_count=0,
            source_domains=[],
            scan_target_reached=discovered_count >= target_scan,
            fetch_target_reached=False,
            blockers=[str(error)],
            run_steps=compact_run_steps(run_steps),
            error=str(error),
        )


def provider_mode_blockers(provider_name: str, mode: ScoutMode, leads: list[ScoutLead]) -> list[str]:
    blockers: list[str] = []
    if provider_name in {"demo", "fixture", "fixtures"}:
        blockers.append("Les fixtures ne comptent pas comme provider réel.")
    if not leads:
        blockers.append("Aucun candidat exploitable.")
    if leads and not all(lead.evidence for lead in leads):
        blockers.append("Au moins un candidat n'a aucune preuve publique.")
    if leads and not all(has_sourced_observed(lead) for lead in leads):
        blockers.append("Au moins un Observé n'est pas relié à une evidence.")
    if mode == "core" and not any(lead.quality_decision == "pass" for lead in leads):
        blockers.append("Core ne produit aucun lead qui passe QC.")
    if mode == "exploration" and any(not lead.outreach.cold_email.lower().startswith("brouillon bloqué") for lead in leads):
        blockers.append("Exploration produit un message direct.")
    return blockers


def comparison_blockers(results: list[ProviderModeAudit], modes: list[ScoutMode]) -> list[str]:
    blockers: list[str] = []
    for mode in modes:
        passing = [item for item in results if item.mode == mode and item.status == "pass"]
        if not passing:
            blockers.append(f"Aucun provider réel ne passe le smoke {mode}.")
    if not recommended_default_provider(results, modes):
        blockers.append("Aucun provider ne couvre tous les modes demandés.")
    if not requested_modes_volume_proven(results, modes):
        blockers.append("Aucun provider ne prouve les volumes configurés sur tous les modes demandés.")
    return blockers


def prd_volume_proven(results: list[ProviderModeAudit], modes: list[ScoutMode]) -> bool:
    if set(modes) != PRD_MODES:
        return False
    return requested_modes_volume_proven(results, modes)


def requested_modes_volume_proven(results: list[ProviderModeAudit], modes: list[ScoutMode]) -> bool:
    return all(
        any(item.mode == mode and item.status == "pass" and item.scan_target_reached for item in results)
        for mode in modes
    )


def recommended_default_provider(results: list[ProviderModeAudit], modes: list[ScoutMode]) -> str | None:
    providers = []
    for provider in {item.provider for item in results}:
        provider_results = [item for item in results if item.provider == provider]
        if all(any(item.mode == mode and item.status == "pass" for item in provider_results) for mode in modes):
            providers.append(provider)
    if not providers:
        return None
    priority = {"serpapi": 0, "openai_web": 1, "web": 2, "configured": 3}
    return sorted(providers, key=lambda name: (priority.get(name, 99), name))[0]


def build_named_provider(name: str):
    if name == "serpapi":
        return SerpApiResearchProvider.from_env()
    if name in {"openai", "openai_web", "openai_search"}:
        return OpenAIWebResearchProvider.from_env()
    if name in {"web", "search", "open_web"}:
        return OpenWebResearchProvider.from_env()
    if name in {"configured", "configured_strict", "seeds"}:
        return ConfiguredWebResearchProvider.from_env()
    raise RuntimeError(f"Provider de comparaison inconnu: {name}")


def provider_unavailable_reason(name: str) -> str | None:
    if name == "serpapi" and not os.getenv("SERPAPI_API_KEY", os.getenv("SERP_API_KEY", "")).strip():
        return "SERPAPI_API_KEY manquant."
    if name in {"openai", "openai_web", "openai_search"} and not os.getenv("OPENAI_API_KEY", "").strip():
        return "OPENAI_API_KEY manquant."
    if name in {"configured", "configured_strict", "seeds"} and not os.getenv("BM_SCOUT_REAL_SEEDS", "").strip():
        return "BM_SCOUT_REAL_SEEDS manquant."
    return None


def parse_provider_list(value: str) -> list[str]:
    providers = [item.strip().lower() for item in value.split(",") if item.strip()]
    return providers or ["serpapi", "openai_web", "web"]


def parse_modes(value: str) -> list[ScoutMode]:
    modes: list[ScoutMode] = []
    for item in [part.strip().lower() for part in value.split(",") if part.strip()]:
        if item not in {"core", "exploration"}:
            raise RuntimeError("--modes doit contenir seulement core et/ou exploration.")
        modes.append(item)  # type: ignore[arg-type]
    return modes or ["core", "exploration"]


def discovered_count_from_steps(steps: list[RunStep]) -> int:
    for step in steps:
        if step.step == "search_web" and isinstance(step.payload.get("discovered_count"), int):
            return int(step.payload["discovered_count"])
    return 0


def has_sourced_observed(lead: ScoutLead) -> bool:
    if not lead.insights or not lead.insights.observed:
        return False
    evidence_keys = {item.url for item in lead.evidence}
    evidence_keys.update(getattr(item, "id") for item in lead.evidence if getattr(item, "id", None))
    return all(item.evidence_id in evidence_keys for item in lead.insights.observed)


def compact_run_steps(steps: list[RunStep]) -> list[dict[str, object]]:
    compacted: list[dict[str, object]] = []
    for step in steps[:12]:
        compacted.append(
            {
                "agent_name": step.agent_name,
                "step": step.step,
                "event_type": step.event_type,
                "payload": compact_payload(step.payload),
            }
        )
    return compacted


def compact_payload(payload: dict[str, object]) -> dict[str, object]:
    compacted: dict[str, object] = {}
    for key, value in payload.items():
        if isinstance(value, list):
            compacted[key] = value[:8]
        elif isinstance(value, str) and len(value) > 600:
            compacted[key] = value[:600] + "...[truncated]"
        else:
            compacted[key] = value
    return compacted


def domain_from_url(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def report_to_dict(report: ProviderComparisonReport) -> dict[str, object]:
    payload = asdict(report)
    payload["results"] = [asdict(item) for item in report.results]
    return payload


def render_markdown(report: ProviderComparisonReport) -> str:
    lines = [
        "# Comparaison providers BM Scout",
        "",
        f"- Verdict : {report.verdict}",
        f"- Généré : {report.generated_at}",
        f"- Révision code : {report.code_revision}",
        f"- Python : {report.python_version}",
        f"- OpenAI SDK : {report.openai_sdk_version}",
        f"- Provider recommandé : {report.recommended_default or 'aucun'}",
        f"- Volumes PRD prouvés : {'oui' if report.prd_volume_proven else 'non'}",
        "",
        "## Blockers",
        "",
        *(f"- {blocker}" for blocker in report.blockers),
        "",
        "## Résultats",
        "",
    ]
    for item in report.results:
        lines.extend(
            [
                f"### {item.provider} / {item.mode}",
                "",
                f"- Statut : {item.status}",
                f"- Candidats : {item.candidate_count}; pass QC : {item.quality_pass_count}; preuves : {item.evidence_count}",
                f"- Scan cible : {item.target_scan}; découvert : {item.discovered_count}; cible atteinte : {'oui' if item.scan_target_reached else 'non'}",
                f"- Domaines sources : {', '.join(item.source_domains[:8]) or 'aucun'}",
                f"- Blockers : {', '.join(item.blockers) if item.blockers else 'aucun'}",
                "",
            ]
        )
    return "\n".join(lines)


if __name__ == "__main__":
    main()
