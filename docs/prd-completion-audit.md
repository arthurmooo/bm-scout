# Audit de couverture PRD - BM Scout V1

Source : `PRD_BM_Scout_v1.docx`, version 1.0 du 30 mai 2026.

Verdict courant : `not_ready`.

## Couverture livree

| Exigence PRD | Etat | Preuve |
| --- | --- | --- |
| Console interne premium orientee Romu | Partiel | `app/page.tsx`, `src/ui/ScoutDashboard.tsx`, build Next OK |
| Separation Core BM / Exploration | Couvert | `src/domain/types.ts`, fixtures, worker schemas, rapport qualite |
| Leads avec signaux, hypotheses, score justifie | Couvert sur fixtures + runs reels Core/Exploration | `quality:runs`, artefacts reels Core/Exploration |
| Fiche courte et fiche profonde | Couvert sur modele et affichage | `ScoutLead.shortCard`, `ScoutLead.deepCard`, dashboard |
| Messages email, relance, LinkedIn | Couvert en copier-coller | `OutreachPack`, QC anti-generique |
| Aucun envoi autonome | Couvert | Aucun endpoint ou tool d'envoi ; README/runbook |
| Feedback Romu | Couvert en schema + Supabase | `scout_feedback`, feedbacks persistés |
| Outcomes | Couvert en schema + Supabase | `scout_outcomes`, outcomes persistés |
| Do-not-contact | Couvert | `scout_do_not_contact`, fonction `scout_is_do_not_contact`, verification SQL |
| Learning hebdo 3 a 5 apprentissages | Partiel | fixtures + lessons Supabase ; run reel post-branchement a refaire |
| Agents specialises code-first | Couvert | `services/agent-worker/bm_scout_worker/agents.py` |
| OpenAI Agents SDK avec Runner.run + trace | Couvert | `runner.py`, artefacts reels |
| Outputs structures | Couvert | Pydantic schemas + TS types |
| Guardrails QC | Couvert | Python guardrail + TS/Python tests |
| Supabase memoire persistante | Couvert, runtime CLI a prouver | migrations + RPC + smoke Supabase |
| Observabilite traces/runs | Partiel | traces OpenAI + `scout_runs`; couts/outils detailles non industrialises |
| Dashboard < 6 blocs conceptuels | Couvert dans intention UI | `ScoutDashboard.tsx`, build OK |
| Rapport qualite obligatoire | Couvert mais readiness bloquee | `artifacts/quality-runs/latest-report.md`, `quality:readiness` |
| Scenario demo | Couvert | `docs/demo-scenario.md` |
| Documentation lancement | Couvert | `docs/launch-runbook.md` |
| Liste limites V1 | Couvert | `docs/v1-limits.md` |

## Requirements non prouves

1. Console Supabase serveur :
   - preuve attendue : `npm run verify:supabase` avec `SUPABASE_SERVICE_ROLE_KEY`.
   - etat : script cree, execution reelle bloquee par absence de service role key locale.

2. CLI `--persist` :
   - preuve attendue : run CLI reel ou offline avec `--persist` creant un run Supabase via RPC.
   - etat : code + tests mock + smoke SQL RPC OK ; execution CLI locale non faite faute de service role key.

3. Learning Agent avec memoire Supabase :
   - preuve attendue : run reel Agents SDK execute apres branchement feedback Supabase, montrant que les feedbacks/outcomes changent les recommandations.
   - etat : code branche, dernier run reel anterieur au branchement.

4. Volumes hebdo PRD 15 Core / scan 100 Exploration :
   - preuve attendue : mission batch reelle avec ces volumes ou simulation controllée.
   - etat : MVP teste sur petits batches realistes ; volume production non prouve.

5. Sources web gratuites et emails publics :
   - preuve attendue : tools de recherche web/fetch/email confidence ou documentation de limite.
   - etat : V1 actuelle travaille sur batch structure/fixtures ; exploration web gratuite non industrialisee.

## Decision

Le MVP technique est avance mais la V1 ne doit pas etre marquee complete.

La prochaine tranche doit produire une preuve runtime serveur de bout en bout :

1. injecter les variables serveur ;
2. executer `npm run verify:supabase` ;
3. executer `python -m bm_scout_worker.cli --real --mode core --persist` ;
4. verifier le run en Supabase ;
5. relancer `quality:readiness`.
