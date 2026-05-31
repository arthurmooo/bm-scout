# BM Scout - Etat d'intégration

Date : 2026-05-31

## Verdict PM actuel

Statut : `production_not_ready`.

Le repo n'est plus présenté comme V1 prête. La passe actuelle transforme la démo en socle plus pilotable : tâches proactives, traces d'actions, DNC hard gate, feedback memory causale, Observé/Inféré/Incertain full-stack, auth interne SSR et dashboard moins fictif. Ce n'est pas encore un employé IA complet : la recherche web SerpAPI/OpenAI/fallback public existe, mais les volumes PRD et le cron production restent à prouver.

## Décisions reprises de l'audit

- Ne plus assimiler fixtures et readiness produit.
- Introduire `scout_agent_tasks` pour représenter le travail proactif attendu.
- Tracer les actions Romu dans `scout_action_events`.
- Remplacer la routine UI codée en dur par un brief construit depuis runs/tasks.
- Mettre `quality:readiness` en échec tant que les preuves runtime réelles manquent.
- Bloquer le DNC avant copie/message, pas seulement dans une table décorative.
- Faire influencer le run suivant par les feedbacks Romu, pas seulement produire une synthèse ou enrichir un prompt.
- Stocker Observé/Inféré/Incertain et les statuts d'email dans Supabase.
- Ne plus exposer la console hors démo sans Auth Supabase et claims internes `app_metadata`.

## Implémenté dans cette passe

- Module scheduler TS : `src/domain/scheduler.ts`.
- Runner de queue : `src/server/agent-task-runner.ts` et `scripts/run-agent-task-queue.ts`.
- Routines non-worker : Daily Brief, Learning Review, DNC check et followup review lisent le snapshot Supabase runtime, produisent un résumé actionnable ou se bloquent si aucun run persistant n'existe.
- Cron GitHub Actions versionné : `.github/workflows/bm-scout-agent-tasks.yml`.
- Tests scheduler avec routines Core, Exploration, Daily Brief, Learning, DNC, followup.
- Migration Supabase `20260530210927_agent_tasks_and_actions.sql`.
- Migration Supabase `20260531004848_agent_tasks_active_dedupe.sql` : index unique partiel pour empêcher deux tâches `queued/running` identiques sur le même créneau.
- Migration Supabase `20260530232128_restrict_internal_rls_policies.sql` : suppression des policies `using (true)` et restriction aux rôles internes `app_metadata`.
- Migration Supabase `20260530232456_close_security_definer_rpc_exposure.sql` : fermeture des fonctions `SECURITY DEFINER` exposées en RPC publique.
- API `POST /api/scout/actions`.
- Actions UI : valider, enrichir, rejeter, copier email/relance/LinkedIn, DNC, lancer routines.
- Actions feedback/outcome : bon lead, mauvais lead, bon angle, message trop générique, RDV pris, positif/négatif, mauvais timing, mauvais interlocuteur, douleur confirmée/non confirmée. Ces actions écrivent `scout_feedback` ou `scout_outcomes`, pas seulement `scout_action_events`.
- Trigger DB `scout_prevent_dnc_message` pour empêcher un message non bloqué sur une cible DNC.
- QC TS : DNC déterministe et Observé relié à une preuve.
- Worker offline : DNC interdit en shortlist.
- Worker réel : provider `auto` avec seeds, SerpAPI, OpenAI `web_search` ou fallback web public, plus `WebSearchTool` hébergé OpenAI et 8 tools métier Agents SDK.
- Provider OpenAI web : utilise le tool officiel Responses API `{ "type": "web_search" }`, conserve les sources/traces, parse JSON ou sources web, et n'utilise pas OpenAI récursivement pour les recherches jobs sauf opt-in `BM_SCOUT_OPENAI_SEARCH_JOBS=1`.
- Provider SerpAPI : `BM_SCOUT_PROVIDER=serpapi` ou sélection auto via `SERPAPI_API_KEY`, parsing des `organic_results`, filtrage des sources faibles et run step `serpapi_search`.
- `search_jobs` n'est plus décoratif : le provider web cherche des sources recrutement publiques, les transforme en preuves et les trace dans `run_steps`.
- Scripts `worker:real:*` : exécution reproductible Core/Exploration réelle, avec artefacts `latest-real-*.json` consommés par `quality:readiness`.
- Mémoire feedback TS : rejet lead, pénalité secteur, bonus angle validé, régénération anti-générique.
- Mémoire feedback worker : chargement feedbacks/outcomes Supabase avec contexte entreprise/segment/site, blocage DNC/rejets, pénalités segments faibles, bonus angles validés et régénération anti-générique dans le provider Python.
- Worker Pydantic : contrat Observé/Inféré/Incertain, email confidence, run steps.
- Recorder Agents SDK : les function tools poussent maintenant leurs entrées/sorties compactées dans `run_steps` pendant `Runner.run`.
- Migration Supabase `20260530214847_bm_scout_structured_insights_email_confidence_steps.sql` appliquée au projet interne.
- Documentation et rapport qualité repassés en statut honnête.
- Auth Supabase SSR : `@supabase/ssr`, page login magic link, callback/logout, proxy de refresh cookie et garde serveur sur la home/API actions.
- Policy applicative : les décisions d'accès lisent uniquement `app_metadata` (`bm_scout_role`, `bm_scout_roles`, `bm_scout_access`) et ignorent les metadata modifiables utilisateur.

## Encore fixture/demo

- `quality:runs` reste un harnais fixture.
- `demoSnapshot()` reste le fallback sans env Supabase serveur.
- Le worker réel peut découvrir des candidats sans seeds via SerpAPI, OpenAI `web_search` ou fallback web public, mais ce n'est pas encore prouvé à volume PRD.
- Une comparaison provider Core seule ne peut plus déclarer les volumes PRD prouvés ; `prd_volume_proven` exige Core + Exploration.
- Les providers `search_web`, `fetch_company_site`, `search_jobs`, `find_public_emails`, `dedupe_company` existent ; `search_jobs` reste minimal et la robustesse search dépend encore des sources publiques.
- Les volumes 15 Core / 100 Exploration sont paramétrés mais non prouvés en run réel.
- Le feedback influence le moteur TS et le provider Python en tests locaux, mais il n'est pas encore prouvé sur un run réel Supabase à volume.

## Réellement end-to-end aujourd'hui

- Scheduler reproductible : `npm run agent:schedule` affiche le plan et les tâches dues ; `agent:schedule:run` met en file les 6 routines P0 quand elles sont dues, avec déduplication journalière sauf `--force`.
- Runner queue reproductible : `npm run agent:tasks:offline` ou `npm run agent:tasks:real` avec env Supabase serveur ; les routines brief/learning/DNC/followup ne s'appuient pas sur les fixtures demo.
- Artefacts de run réel reproductibles : `npm run worker:real:core`, `npm run worker:real:exploration`, puis variantes `:persist` avec env Supabase.
- Actions API persistantes si `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` existent ; si Auth SSR est configurée, l'API exige aussi un compte interne BM Scout.
- Auth interne : home protégée en mode `BM_SCOUT_AUTH_MODE=internal`, login magic link Supabase, fallback démo seulement si l'auth publique est absente ou explicitement forcée.
- DNC bloque côté TS, worker offline et trigger Supabase.
- Feedback Romu influence le scoring et les messages dans le moteur TS et le worker provider testés.
- Run steps et email confidence sont écrits par le worker/RPC quand `--persist` est exécuté.
- Console Next buildée avec route d'action dynamique.

## Vérifications exécutées

- `npm run test` : 43 tests pass, dont scheduler idempotent, index anti-doublon Supabase, policy Auth BM Scout et actions Romu.
- `npm run typecheck` : pass.
- `npm run lint` : pass.
- `npm run build` : pass.
- `npm run quality:runs` : pass fixture, décision produit `production_not_ready`.
- `npm run quality:readiness` : fail attendu, décision produit `production_not_ready`.
- `.venv/bin/python -m pytest services/agent-worker/tests` / `npm run worker:test` : 41 tests pass, dont provider SerpAPI, provider OpenAI web, fallback jobs, parsing sources, comparaison provider et anti-faux-positif PRD sur smoke Core seul.
- Avec `OPENAI_API_KEY` présent en env et `BM_SCOUT_FETCH_LIMIT=3`, `npm run provider:compare -- --providers=openai_web --modes=core` : pass réel, Core découvre 15 candidats, enrichit 3 comptes et 3 passent QC ; `prd_volume_proven=false` car ce smoke n'inclut pas Exploration.
- Avec `OPENAI_API_KEY` présent en env et `BM_SCOUT_FETCH_LIMIT=5`, `npm run provider:compare -- --providers=openai_web --modes=exploration` : fail attendu côté volume, Exploration découvre 36/100 comptes, produit une shortlist de 5 avec 2 pass QC et bloque les messages directs. Conclusion : OpenAI `web_search` est utile pour Core/enrichissement ciblé, mais SerpAPI reste à brancher pour prouver le scan large 100 comptes.
- Import Agents SDK manager : 13 tools disponibles, dont `WebSearchTool` et 8 tools métier provider.
- `npm run agent:schedule -- --now=2026-06-01T06:00:00.000Z` : pass, 6 routines planifiées et 6 routines dues le lundi ouvré.
- `npm run agent:schedule:run -- --now=2026-06-01T06:00:00.000Z` sans env serveur : fail attendu avec message env Supabase requis.
- `npm run agent:tasks` sans env serveur : fail attendu avec message env Supabase requis.
- `npm exec tsx -- scripts/run-agent-worker-evidence.ts --offline --mode=core` : pass, artefact `latest-offline-core.json` écrit.
- `npm run test:e2e` : pass, 2 scénarios Playwright ; le smoke force `BM_SCOUT_AUTH_MODE=demo`, vérifie dashboard/actions et page login interne.
- Browser intégré : pass sur `http://127.0.0.1:3030` ; login interne visible, dashboard `production_not_ready` visible, clic feedback `Bon lead` passe en état `Erreur` attendu sans env Supabase serveur.
- `npm audit --omit=dev` : fail modéré connu via `next -> postcss <8.5.10`; `npm audit fix --force` propose un downgrade Next cassant vers 9.x, donc non appliqué dans cette passe.
- Supabase interne `Interne_Agentic_prospection` : migrations `agent_tasks_and_actions`, `bm_scout_structured_insights_email_confidence_steps`, `scout_feedback_outcome_actions`, `restrict_internal_rls_policies` et `close_security_definer_rpc_exposure` appliquées.
- Supabase interne : index `scout_agent_tasks_active_type_schedule_uniq` vérifié en base via MCP après absence de doublons actifs.
- Supabase advisor sécurité : 0 lint après durcissement RLS/RPC.

## Prochaine tranche P0

1. Fournir l'env service role au runner local/cron et tester `agent:tasks:offline` contre Supabase.
2. Ajouter `SERPAPI_API_KEY`, relancer `npm run provider:compare`, puis comparer couverture, coût et qualité des sources contre OpenAI web avant choix par défaut.
3. Prouver les volumes PRD 15 Core / 100 Exploration avec artefacts réels, notamment Exploration 100 comptes.
4. Prouver la feedback loop sur scoring, messages et recommandations dans un run réel Supabase.
5. Exécuter le cron GitHub Actions avec secrets et vérifier les transitions `queued -> completed`.
6. Affecter les claims Supabase réels aux comptes Romu/Arthur et valider le parcours magic link sur le projet interne.
