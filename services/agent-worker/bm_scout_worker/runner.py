from __future__ import annotations

import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from .agents import agent_hosted_web_search_enabled
from .fixtures import offline_output, seed_feedbacks
from .memory import SupabaseConfig, SupabaseMemory
from .providers import build_candidate_batch_with_steps
from .runtime import code_revision, package_version
from .schemas import FeedbackEvent, MissionAgentOutput, MissionOutput, RunStep, ScoutMode


async def run_bm_scout_mission(
    mode: ScoutMode,
    *,
    include_weak: bool = False,
    real: bool = False,
    persist: bool = False,
    artifacts_dir: Path | None = None,
) -> MissionOutput:
    started_at = datetime.now(UTC)
    started_perf = time.perf_counter()
    config = SupabaseConfig.from_env()
    memory = SupabaseMemory(config) if config else None
    feedbacks: list[FeedbackEvent] = []
    memory_source = "offline_fixture"

    if real:
        if memory:
            feedbacks = memory.load_feedback_events()
            memory_source = "supabase"
        else:
            feedbacks = seed_feedbacks()
            memory_source = "seed"
        output = await _run_with_agents_sdk(mode, include_weak=include_weak, feedbacks=feedbacks)
    else:
        output = offline_output(mode, include_weak=include_weak)

    output.run_steps = [
        RunStep(
            agent_name="bm_scout_worker",
            step="runner_complete",
            event_type="offline_run" if not real else "agents_sdk_run",
            payload={
                "mode": mode,
                "include_weak": include_weak,
                "persist_requested": persist,
                "feedback_memory_loaded": bool(feedbacks),
                "feedback_memory_source": memory_source,
                "feedback_event_count": len(feedbacks),
                "do_not_contact_event_count": sum(1 for feedback in feedbacks if feedback.kind == "do_not_contact"),
                **runtime_metadata(started_at, started_perf, real=real),
            },
        ),
        *output.run_steps,
    ]

    if persist:
        if memory is None:
            raise RuntimeError("Persistance demandée mais SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manque.")
        output.run_steps.append(
            RunStep(
                agent_name="bm_scout_worker",
                step="persist_complete",
                event_type="supabase_persist",
                payload={"mode": mode, "trace_id": output.trace_id, "run_id": output.run_id},
            )
        )
        memory.persist_output(output)

    if artifacts_dir:
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        (artifacts_dir / f"{output.run_id}.json").write_text(output.model_dump_json(indent=2), encoding="utf-8")

    return output


async def _run_with_agents_sdk(mode: ScoutMode, *, include_weak: bool, feedbacks: list[FeedbackEvent]) -> MissionOutput:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY requis pour --real. Utilise --offline pour les tests sans appel modèle.")

    from agents import Runner, trace

    from .agents import build_manager_agent
    from .tool_recorder import capture_tool_calls

    model = os.getenv("OPENAI_MODEL", "gpt-5.5")
    hosted_web_search_enabled = agent_hosted_web_search_enabled()
    manager = build_manager_agent(model, hosted_web_search_enabled=hosted_web_search_enabled)
    candidate_batch = build_candidate_batch_with_steps(
        mode,
        include_weak=include_weak,
        feedback_notes=[feedback.note for feedback in feedbacks],
        feedback_events=feedbacks,
    )
    candidates = candidate_batch.leads
    provider_step = RunStep(
        agent_name="bm_scout_provider",
        step="candidate_batch",
        event_type="tool_call",
        payload={
            "mode": mode,
            "candidate_count": len(candidates),
            "feedback_count": len(feedbacks),
            "agent_hosted_web_search_enabled": hosted_web_search_enabled,
        },
    )
    candidates_json = "[" + ",".join(
        lead.model_dump_json() for lead in candidates
    ) + "]"
    feedback_json = "[" + ",".join(feedback.model_dump_json() for feedback in feedbacks) + "]"
    prompt = f"""
Mission BM Scout V1.
Mode: {mode}
Inclure cas faibles pour QC négatif: {include_weak}

Batch à analyser fourni par le provider BM Scout configuré. Tu dois partir de ces données, appeler les tools utiles si nécessaire, filtrer, enrichir la décision et produire un MissionOutput complet. Ne retourne jamais une liste vide si un compte passe les critères.

Candidates JSON:
{candidates_json}

Feedbacks Romu disponibles depuis la mémoire Supabase si configurée, sinon depuis le seed local:
{feedback_json}

Produis une mission complète conforme au PRD BM Scout :
- leads sourcés, spécifiques et actionnables ;
- Core BM différent d'Exploration ;
- messages manuels seulement si QC passe ;
- learning hebdo 3 à 5 points ;
- décision finale prête/pas prête.

Contraintes de sortie :
- En Core, conserve les candidats `quality_decision=pass` avec preuves publiques ; le meilleur candidat Core pass doit rester `verdict=validate`.
- En Exploration, ne génère aucun message direct.
- Pour chaque lead Exploration retenu, `outreach.cold_email`, `outreach.follow_up` et `outreach.linkedin` doivent commencer par `Brouillon bloqué`.
- Tout contact non confirmé reste `role_only` ou `uncertain`.
- Pour chaque `insights.observed[]`, `evidence_id` doit être exactement égal à une URL ou un label déjà présent dans `evidence`.
- Produis toujours 3 à 5 `lessons`, même si elles sont prudentes et issues du QC, des exclusions ou des limites de sourcing.
- Les textes doivent rester en français.
"""
    with capture_tool_calls() as tool_steps:
        with trace("BM Scout V1", metadata={"mode": mode, "include_weak": str(include_weak).lower()}):
            result = await Runner.run(manager, prompt, max_turns=agent_max_turns())
    final_output = result.final_output
    if isinstance(final_output, MissionOutput):
        output = final_output
    elif isinstance(final_output, MissionAgentOutput):
        output = final_output.to_mission_output()
    else:
        output = MissionAgentOutput.model_validate(final_output).to_mission_output()
    output.run_steps = [provider_step, *candidate_batch.run_steps, *tool_steps, *output.run_steps]
    return output


def agent_max_turns() -> int:
    try:
        value = int(os.getenv("BM_SCOUT_AGENT_MAX_TURNS", "6"))
    except ValueError:
        return 6
    return max(3, min(value, 10))


def runtime_metadata(started_at: datetime, started_perf: float, *, real: bool) -> dict[str, object]:
    completed_at = datetime.now(UTC)
    return {
        "started_at": started_at.isoformat(),
        "completed_at": completed_at.isoformat(),
        "duration_ms": round((time.perf_counter() - started_perf) * 1000),
        "real_mode": real,
        "openai_model": os.getenv("OPENAI_MODEL", "gpt-5.5") if real else None,
        "openai_search_model": os.getenv("OPENAI_SEARCH_MODEL", os.getenv("OPENAI_MODEL", "gpt-5.5")) if real else None,
        "bm_scout_provider": os.getenv("BM_SCOUT_PROVIDER", "auto"),
        "agent_hosted_web_search_enabled": agent_hosted_web_search_enabled() if real else False,
        "agent_max_turns": agent_max_turns() if real else None,
        "worker_timeout_ms": os.getenv("BM_SCOUT_WORKER_TIMEOUT_MS"),
        "python_version": sys.version.split()[0],
        "openai_agents_version": package_version("openai-agents"),
        "openai_sdk_version": package_version("openai"),
        "code_revision": code_revision(),
    }
