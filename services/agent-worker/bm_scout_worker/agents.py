from __future__ import annotations

from agents import Agent, GuardrailFunctionOutput, RunContextWrapper, WebSearchTool, output_guardrail

from .quality import mission_blockers
from .schemas import MissionAgentOutput
from .tools import (
    dedupe_company,
    extract_company_signals,
    fetch_company_site,
    find_public_emails,
    save_evidence,
    score_candidate,
    search_jobs,
    search_web,
)


MANAGER_INSTRUCTIONS = """
Tu es le Manager BM Scout. Orchestration obligatoire :
1. Utilise l'agent Core Research pour les missions Core, Exploration pour les missions Exploration.
2. Utilise l'agent Outreach uniquement si le QC autorise un brouillon.
3. Fais passer la sortie par Quality Control. Si QC bloque, le verdict final doit être not_ready.
4. Produis un MissionOutput strict : sources, hypothèses prudentes, score justifié, messages manuels, learning.
5. N'envoie rien. Ne promets aucune action externe. Ne génère pas de message direct en Exploration.
6. Chaque insight Observé doit recopier un `evidence_id` exact depuis `lead.evidence[].url` ou `lead.evidence[].label`.
7. La synthèse learning doit toujours contenir 3 à 5 apprentissages exploitables.
"""

CORE_INSTRUCTIONS = """
Tu qualifies des entreprises Core BM : M&A, corporate finance, deal advisory, finance ops.
Ne garde que les comptes avec signaux publics concrets et douleur de tâche grise crédible.
"""

EXPLORATION_INSTRUCTIONS = """
Tu explores large mais tu ne remontes qu'une shortlist. Tu expliques pourquoi les comptes faibles sont écartés.
En Exploration, aucun email froid direct : seulement un brouillon bloqué ou une recommandation de promotion.
"""

OUTREACH_INSTRUCTIONS = """
Tu rédiges seulement des messages manuels, spécifiques à l'entreprise et au persona.
Chaque message doit contenir BM Automation, un fait public, une hypothèse prudente, une question et une opposition simple.
"""

QC_INSTRUCTIONS = """
Tu es Quality Control. Bloque tout output sans source, générique, non ICP, non conforme, ou do-not-contact.
Explique toujours pourquoi bloquer, enrichir ou laisser passer.
"""

LEARNING_INSTRUCTIONS = """
Tu synthétises les feedbacks Romu en 3 à 5 apprentissages exploitables pour la semaine suivante.
Un do-not-contact bloque toute relance et doit passer avant toute recommandation commerciale.
Si la mémoire feedback est faible, produis quand même 3 apprentissages prudents à partir des décisions QC et limites du run.
"""


@output_guardrail(name="bm_scout_output_quality")
async def bm_scout_output_quality(
    _context: RunContextWrapper[None],
    _agent: Agent[None],
    output: MissionAgentOutput,
) -> GuardrailFunctionOutput:
    blockers = mission_blockers(output.to_mission_output())
    return GuardrailFunctionOutput(
        output_info={"blockers": blockers},
        tripwire_triggered=bool(blockers),
    )


def build_manager_agent(model: str) -> Agent[None]:
    hosted_web_search = WebSearchTool(search_context_size="low", external_web_access=True)
    core_agent = Agent(
        name="Core Research Agent",
        handoff_description="Recherche et qualification Core BM.",
        instructions=CORE_INSTRUCTIONS,
        model=model,
        tools=[hosted_web_search, search_web, fetch_company_site, extract_company_signals, search_jobs],
        output_type=MissionAgentOutput,
    )
    exploration_agent = Agent(
        name="Exploration Agent",
        handoff_description="Exploration large filtrée.",
        instructions=EXPLORATION_INSTRUCTIONS,
        model=model,
        tools=[hosted_web_search, search_web, fetch_company_site, extract_company_signals, search_jobs],
        output_type=MissionAgentOutput,
    )
    outreach_agent = Agent(
        name="Outreach Agent",
        handoff_description="Rédaction de messages manuels spécifiques.",
        instructions=OUTREACH_INSTRUCTIONS,
        model=model,
        output_type=MissionAgentOutput,
    )
    learning_agent = Agent(
        name="Learning Agent",
        handoff_description="Synthèse des feedbacks et apprentissages.",
        instructions=LEARNING_INSTRUCTIONS,
        model=model,
        output_type=MissionAgentOutput,
    )
    quality_control_agent = Agent(
        name="quality_control_agent",
        handoff_description="Décision finale bloquante si la sortie est faible.",
        instructions=QC_INSTRUCTIONS,
        model=model,
        output_type=MissionAgentOutput,
        output_guardrails=[bm_scout_output_quality],
    )

    return Agent(
        name="BM Scout Manager",
        instructions=MANAGER_INSTRUCTIONS,
        model=model,
        tools=[
            hosted_web_search,
            search_web,
            fetch_company_site,
            extract_company_signals,
            search_jobs,
            find_public_emails,
            dedupe_company,
            score_candidate,
            save_evidence,
            core_agent.as_tool("run_core_research", "Qualifier un batch Core BM avec preuves et score."),
            exploration_agent.as_tool("run_exploration", "Scanner large, filtrer et produire une shortlist."),
            outreach_agent.as_tool("draft_manual_outreach", "Rédiger email, relance et LinkedIn manuels si QC le permet."),
            learning_agent.as_tool("summarize_learning", "Transformer feedbacks Romu en apprentissages."),
        ],
        handoffs=[quality_control_agent],
        output_type=MissionAgentOutput,
        output_guardrails=[bm_scout_output_quality],
    )
