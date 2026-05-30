# BM Scout - Etat d'intégration

Date : 2026-05-31

## Verdict PM actuel

Statut : `production_not_ready`.

Le repo n'est plus présenté comme V1 prête. La passe actuelle transforme la démo en socle plus pilotable : tâches proactives, traces d'actions, DNC hard gate, feedback memory causale, Observé/Inféré/Incertain full-stack et dashboard moins fictif. Ce n'est pas encore un employé IA complet : la recherche web OpenAI/fallback public existe, mais les volumes PRD et le cron production restent à prouver.

## Décisions reprises de l'audit

- Ne plus assimiler fixtures et readiness produit.
- Introduire `scout_agent_tasks` pour représenter le travail proactif attendu.
- Tracer les actions Romu dans `scout_action_events`.
- Remplacer la routine UI codée en dur par un brief construit depuis runs/tasks.
- Mettre `quality:readiness` en échec tant que les preuves runtime réelles manquent.
- Bloquer le DNC avant copie/message, pas seulement dans une table décorative.
- Faire influencer le run suivant par les feedbacks Romu, pas seulement produire une synthèse ou enrichir un prompt.
- Stocker Observé/Inféré/Incertain et les statuts d'email dans Supabase.

## Implémenté dans cette passe

- Module scheduler TS : `src/domain/scheduler.ts`.
- Runner de queue : `src/server/agent-task-runner.ts` et `scripts/run-agent-task-queue.ts`.
- Routines non-worker : Daily Brief, Learning Review, DNC check et followup review lisent le snapshot Supabase runtime, produisent un résumé actionnable ou se bloquent si aucun run persistant n'existe.
- Cron GitHub Actions versionné : `.github/workflows/bm-scout-agent-tasks.yml`.
- Tests scheduler avec routines Core, Exploration, Daily Brief, Learning, DNC, followup.
- Migration Supabase `20260530210927_agent_tasks_and_actions.sql`.
- API `POST /api/scout/actions`.
- Actions UI : valider, enrichir, rejeter, copier email/relance/LinkedIn, DNC, lancer routines.
- Actions feedback/outcome : bon lead, mauvais lead, bon angle, message trop générique, RDV pris, positif/négatif, mauvais timing, mauvais interlocuteur, douleur confirmée/non confirmée. Ces actions écrivent `scout_feedback` ou `scout_outcomes`, pas seulement `scout_action_events`.
- Trigger DB `scout_prevent_dnc_message` pour empêcher un message non bloqué sur une cible DNC.
- QC TS : DNC déterministe et Observé relié à une preuve.
- Worker offline : DNC interdit en shortlist.
- Worker réel : provider `auto` avec seeds, OpenAI `web_search` ou fallback web public, plus `WebSearchTool` hébergé OpenAI et 8 tools métier Agents SDK.
- `search_jobs` n'est plus décoratif : le provider web cherche des sources recrutement publiques, les transforme en preuves et les trace dans `run_steps`.
- Scripts `worker:real:*` : exécution reproductible Core/Exploration réelle, avec artefacts `latest-real-*.json` consommés par `quality:readiness`.
- Mémoire feedback TS : rejet lead, pénalité secteur, bonus angle validé, régénération anti-générique.
- Mémoire feedback worker : chargement feedbacks/outcomes Supabase avec contexte entreprise/segment/site, blocage DNC/rejets, pénalités segments faibles, bonus angles validés et régénération anti-générique dans le provider Python.
- Worker Pydantic : contrat Observé/Inféré/Incertain, email confidence, run steps.
- Recorder Agents SDK : les function tools poussent maintenant leurs entrées/sorties compactées dans `run_steps` pendant `Runner.run`.
- Migration Supabase `20260530214847_bm_scout_structured_insights_email_confidence_steps.sql` appliquée au projet interne.
- Documentation et rapport qualité repassés en statut honnête.

## Encore fixture/demo

- `quality:runs` reste un harnais fixture.
- `demoSnapshot()` reste le fallback sans env Supabase serveur.
- Le worker réel peut découvrir des candidats sans seeds via OpenAI `web_search` ou fallback web public, mais ce n'est pas encore prouvé à volume PRD ni enrichi par SerpAPI.
- Les providers `search_web`, `fetch_company_site`, `search_jobs`, `find_public_emails`, `dedupe_company` existent ; `search_jobs` reste minimal et la robustesse search dépend encore des sources publiques.
- Les volumes 15 Core / 100 Exploration sont paramétrés mais non prouvés en run réel.
- Le feedback influence le moteur TS et le provider Python en tests locaux, mais il n'est pas encore prouvé sur un run réel Supabase à volume.

## Réellement end-to-end aujourd'hui

- Scheduler dry-run reproductible : `npm run agent:schedule`.
- Runner queue reproductible : `npm run agent:tasks:offline` ou `npm run agent:tasks:real` avec env Supabase serveur ; les routines brief/learning/DNC/followup ne s'appuient pas sur les fixtures demo.
- Artefacts de run réel reproductibles : `npm run worker:real:core`, `npm run worker:real:exploration`, puis variantes `:persist` avec env Supabase.
- Actions API persistantes si `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` existent.
- DNC bloque côté TS, worker offline et trigger Supabase.
- Feedback Romu influence le scoring et les messages dans le moteur TS et le worker provider testés.
- Run steps et email confidence sont écrits par le worker/RPC quand `--persist` est exécuté.
- Console Next buildée avec route d'action dynamique.

## Vérifications exécutées

- `npm run test` : 28 tests pass.
- `npm run typecheck` : pass.
- `npm run lint` : pass.
- `npm run build` : pass.
- `npm run quality:runs` : pass fixture, décision produit `production_not_ready`.
- `npm run quality:readiness` : fail attendu, décision produit `production_not_ready`.
- `.venv/bin/python -m pytest services/agent-worker/tests` / `npm run worker:test` : 28 tests pass.
- Import Agents SDK manager : 13 tools disponibles, dont `WebSearchTool` et 8 tools métier provider.
- `npm run agent:schedule` : pass, 6 routines planifiées.
- `npm run agent:tasks` sans env serveur : fail attendu avec message env Supabase requis.
- `npm exec tsx -- scripts/run-agent-worker-evidence.ts --offline --mode=core` : pass, artefact `latest-offline-core.json` écrit.
- `npm run test:e2e` : pass, smoke Playwright sur `http://localhost:3030` ; statut `production_not_ready`, actions feedback/outcome/routines visibles, bouton feedback hydraté, screenshot locale `artifacts/browser-smoke/playwright-dashboard-feedback-actions.png`.
- Browser intégré : smoke manuel sur `http://localhost:3030`, clic feedback `Bon lead` testé ; sans env Supabase serveur, l'action passe en état `Erreur` comme attendu au lieu de prétendre être persistée.
- Supabase interne `Interne_Agentic_prospection` : migrations `agent_tasks_and_actions` et `bm_scout_structured_insights_email_confidence_steps` appliquées.

## Prochaine tranche P0

1. Fournir l'env service role au runner local/cron et tester `agent:tasks:offline` contre Supabase.
2. Prouver `openai_web` à volume, puis brancher SerpAPI si la couverture ou le coût OpenAI web search n'est pas suffisant.
3. Prouver les volumes PRD 15 Core / 100 Exploration avec artefacts réels.
4. Prouver la feedback loop sur scoring, messages et recommandations dans un run réel Supabase.
5. Exécuter le cron GitHub Actions avec secrets et vérifier les transitions `queued -> completed`.
