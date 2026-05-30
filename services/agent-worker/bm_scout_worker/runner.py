from __future__ import annotations

import os
from pathlib import Path

from .fixtures import candidate_leads, offline_output, seed_feedbacks
from .memory import SupabaseConfig, SupabaseMemory
from .schemas import FeedbackEvent, MissionOutput, ScoutMode


async def run_bm_scout_mission(
    mode: ScoutMode,
    *,
    include_weak: bool = False,
    real: bool = False,
    persist: bool = False,
    artifacts_dir: Path | None = None,
) -> MissionOutput:
    config = SupabaseConfig.from_env()
    memory = SupabaseMemory(config) if config else None

    if real:
        feedbacks = memory.load_feedback_events() if memory else seed_feedbacks()
        output = await _run_with_agents_sdk(mode, include_weak=include_weak, feedbacks=feedbacks)
    else:
        output = offline_output(mode, include_weak=include_weak)

    if persist:
        if memory is None:
            raise RuntimeError("Persistance demandée mais SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manque.")
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

    model = os.getenv("OPENAI_MODEL", "gpt-5.5")
    manager = build_manager_agent(model)
    candidates_json = "[" + ",".join(
        lead.model_dump_json() for lead in candidate_leads(mode, include_weak=include_weak)
    ) + "]"
    feedback_json = "[" + ",".join(feedback.model_dump_json() for feedback in feedbacks) + "]"
    prompt = f"""
Mission BM Scout V1.
Mode: {mode}
Inclure cas faibles pour QC négatif: {include_weak}

Batch structuré à analyser. Tu dois partir de ces données, les vérifier qualitativement, filtrer, enrichir la décision et produire un MissionOutput complet. Ne retourne jamais une liste vide si un compte passe les critères.

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
- En Core, conserve au moins Cambon Partners si les preuves et le message passent.
- En Exploration, ne génère aucun message direct.
- Pour chaque lead Exploration retenu, `outreach.cold_email`, `outreach.follow_up` et `outreach.linkedin` doivent commencer par `Brouillon bloqué`.
- Tout contact non confirmé reste `role_only` ou `uncertain`.
- Les textes doivent rester en français.
"""
    with trace("BM Scout V1", metadata={"mode": mode, "include_weak": str(include_weak).lower()}):
        result = await Runner.run(manager, prompt, max_turns=8)
    final_output = result.final_output
    if isinstance(final_output, MissionOutput):
        return final_output
    return MissionOutput.model_validate(final_output)
