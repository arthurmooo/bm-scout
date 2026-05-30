# Audit de couverture PRD - BM Scout V1

Source : `PRD_BM_Scout_v1.docx`, version 1.0 du 30 mai 2026.

Verdict courant : `ready_v1_internal`.

## Couverture livree

| Exigence PRD | Etat | Preuve |
| --- | --- | --- |
| Console interne premium orientee Romu | Couvert | `app/page.tsx`, `src/ui/ScoutDashboard.tsx`, build Next OK, `verify:supabase` OK |
| Separation Core BM / Exploration | Couvert | `src/domain/types.ts`, fixtures, worker schemas, rapport qualite |
| Leads avec signaux, hypotheses, score justifie | Couvert sur fixtures + runs reels Core/Exploration | `quality:runs`, artefacts reels Core/Exploration |
| Fiche courte et fiche profonde | Couvert sur modele et affichage | `ScoutLead.shortCard`, `ScoutLead.deepCard`, dashboard |
| Messages email, relance, LinkedIn | Couvert en copier-coller | `OutreachPack`, QC anti-generique |
| Aucun envoi autonome | Couvert | Aucun endpoint ou tool d'envoi ; README/runbook |
| Feedback Romu | Couvert en schema + Supabase | `scout_feedback`, feedbacks persistés |
| Outcomes | Couvert en schema + Supabase | `scout_outcomes`, outcomes persistés |
| Do-not-contact | Couvert | `scout_do_not_contact`, fonction `scout_is_do_not_contact`, verification SQL |
| Learning hebdo 3 a 5 apprentissages | Couvert | runs reels Supabase persist : 5 lessons Core, 5 lessons Exploration |
| Agents specialises code-first | Couvert | `services/agent-worker/bm_scout_worker/agents.py` |
| OpenAI Agents SDK avec Runner.run + trace | Couvert | `runner.py`, artefacts reels |
| Outputs structures | Couvert | Pydantic schemas + TS types |
| Guardrails QC | Couvert | Python guardrail + TS/Python tests |
| Supabase memoire persistante | Couvert | migrations + RPC + CLI `--persist` + console serveur |
| Observabilite traces/runs | Couvert V1 | traces OpenAI + `scout_runs`; couts/outils detailles hors V1 |
| Dashboard < 6 blocs conceptuels | Couvert dans intention UI | `ScoutDashboard.tsx`, build OK |
| Rapport qualite obligatoire | Couvert | `artifacts/quality-runs/latest-report.md`, `quality:readiness` OK |
| Scenario demo | Couvert | `docs/demo-scenario.md` |
| Documentation lancement | Couvert | `docs/launch-runbook.md` |
| Liste limites V1 | Couvert | `docs/v1-limits.md` |

## Requirements verifies

1. Console Supabase serveur :
   - preuve : `npm run verify:supabase` avec `SUPABASE_SERVICE_ROLE_KEY`.
   - resultat : pass, Cambon prioritaire, 3 runs, 4 leads, 2 rejets, 4 lessons.

2. CLI `--persist` :
   - preuve : `python -m bm_scout_worker.cli --offline --mode core --persist`.
   - resultat : pass, trace `trace_bm_scout_core_offline` creee en Supabase via RPC.

3. Learning Agent avec memoire Supabase :
   - preuve : runs reels Agents SDK avec env Supabase serveur.
   - resultat Core : trace `qc-candidates-json-romu-seed`, Eight bloque do-not-contact, 5 apprentissages issus feedback Romu.
   - resultat Exploration : trace `qc-exploration-candidates-user-provided`, compte faible bloque, 5 apprentissages.

4. Quality readiness :
   - preuve : `npm run quality:readiness`.
   - resultat : pass, decision produit `pret`.

## Limites assumées V1

1. Volumes hebdo PRD 15 Core / scan 100 Exploration :
   - preuve attendue : mission batch reelle avec ces volumes ou simulation controllée.
   - etat : MVP teste sur petits batches realistes ; volume production a monitorer en usage reel.

2. Sources web gratuites et emails publics :
   - preuve attendue : tools de recherche web/fetch/email confidence ou documentation de limite.
   - etat : V1 actuelle travaille sur batch structure/fixtures ; exploration web gratuite non industrialisee.

## Decision

BM Scout V1 peut etre marquee complete pour usage interne pilote.

La decision ne couvre pas :

- prospection autonome ;
- envoi automatique ;
- volume production sans monitoring ;
- scraping web/email industrialise.
