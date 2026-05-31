# BM Scout

Console interne de prospection agentique pour BM Automation.

Statut actuel : `production_not_ready`.

BM Scout n'est pas un CRM, pas un SaaS standard et pas un générateur de messages froids. Le produit vise un employé IA d'acquisition : il prépare le travail, filtre le bruit, source les signaux, bloque les risques et demande seulement les décisions commerciales sensibles à Romu.

## Ce qui existe maintenant

- Console Next.js centrée sur la prochaine décision Romu.
- Schéma Supabase pour runs, leads, preuves, messages, feedbacks, outcomes, DNC, run steps, tasks et action events.
- RPC Supabase de persistance qui fusionne les entreprises par `external_id` puis domaine, priorise Core si un même compte apparaît aussi en Exploration, et trace `dedupe_decision`.
- Worker Python OpenAI Agents SDK avec `Runner.run`, `trace`, agents spécialisés et outputs Pydantic.
- Recherche métier provider : découverte web, fetch site, extraction signaux, job search public, emails publics, déduplication domaine/nom/pays/ville/LinkedIn/identifiant et scoring.
- Scheduler local reproductible qui crée les routines Core, Exploration, Daily Brief, Learning, DNC check et followup review.
- Runner de queue `scout_agent_tasks` qui claim les tâches `queued -> running`, récupère explicitement les `running` trop anciennes, puis passe en `completed/blocked/failed` seulement si elles sont encore `running`.
- Routines Daily Brief, Learning Review, DNC check et followup review exécutables depuis les runs Supabase persistés, avec blocage explicite si elles n'ont que les fixtures.
- Workflow GitHub Actions `.github/workflows/bm-scout-agent-tasks.yml` pour cron/dispatch, avec artefact de preuve `artifacts/agent-tasks/latest-ci-run.json`, à activer avec secrets.
- Workflow manuel `.github/workflows/bm-scout-readiness.yml` pour lancer toute la chaîne de preuves readiness : provider comparison, feedback loop, workers Core/Exploration persistés, cron P0 complet, `verify:supabase`, puis `quality:readiness`, avec upload des artefacts même si une étape échoue.
- Actions UI branchées sur une API serveur : valider, surveiller, rejeter, exclure, enrichir, relancer QC, copier, DNC, outcomes, raisons feedback en 1 clic, lancer routines. Les copies ne sont écrites dans le presse-papiers qu'après validation serveur.
- Les actions message ne mutent que les `scout_messages.id` explicitement validés par le serveur ; `scout_action_events` trace le `message_id`, le canal et les IDs utilisés manuellement.
- Feedbacks et outcomes Romu persistés dans `scout_feedback` / `scout_outcomes` : bon/mauvais lead, raisons de fit ou rejet, feedback message, RDV, positif/négatif, timing, mauvais interlocuteur. Les outcomes neutres (`no_response`, `not_now`, mauvais interlocuteur) ne sont plus assimilés à un opt-out.
- DNC hard gate côté qualité TS, côté worker offline, côté provider réel avant génération d'outreach et côté DB pour empêcher un message non bloqué sur une cible DNC ou un outcome négatif.
- Feedback memory TS + worker provider : mauvais lead/secteur/outcome négatif pénalisé, angle validé renforcé, message générique régénéré, DNC bloquant, rejet/outcome négatif court-circuité avant outreach, contexte entreprise/segment et table `scout_do_not_contact` chargés depuis Supabase.
- Observé/Inféré/Incertain, email confidence, run steps provider et tool calls Agents SDK persistés via Supabase/RPC. Les emails publics nominatifs sourcés peuvent être `usable`; les emails génériques ou patterns probables restent `verify`; aucun pattern n'est inventé sans signal public.
- RLS Supabase durcie : policies `authenticated` restreintes aux rôles internes via `app_metadata`, service role réservée au serveur/worker, advisor sécurité Supabase sans lint après migration.
- Auth interne Supabase SSR branchée : login magic link, refresh cookies via proxy Next, API actions bloquée si l'utilisateur n'a pas de claim `app_metadata` BM Scout. Le mode démo local reste explicite via `BM_SCOUT_AUTH_MODE=demo`.
- Rapport qualité qui distingue le harnais fixture de la readiness produit réelle.
- Console qui n'utilise les fixtures que sans env Supabase serveur ; une base Supabase configurée mais vide reste affichée comme vide.

## Ce qui n'est pas encore prêt

- Cron GitHub Actions versionné, mais pas encore prouvé par un run CI avec secrets.
- La comparaison provider OpenAI web prouve désormais le scan PRD 15 Core / 100 Exploration, mais pas encore un run Agents SDK persisté Supabase à ce volume.
- Recherche marché réelle encore limitée : le worker peut utiliser SerpAPI, OpenAI `web_search` ou un fallback web public avec job search minimal ; la couverture OpenAI est prouvée en smoke provider, mais la qualité commerciale des sources reste à valider sur runs persistés.
- Feedback loop prouvée localement côté TS et worker Python, pas encore validée sur un run réel Supabase à volume.
- `quality:readiness` échoue volontairement tant que ces preuves ne sont pas là.
- Attribution réelle des comptes Romu/Arthur dans Supabase Auth à faire dans le dashboard projet : `app_metadata.bm_scout_role`, `app_metadata.bm_scout_roles` ou `app_metadata.bm_scout_access`.

## Lancer

```bash
npm install
npm run dev
```

Variables serveur :

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` recommandé pour Auth SSR, ou `NEXT_PUBLIC_SUPABASE_ANON_KEY` legacy.
- `SUPABASE_SERVICE_ROLE_KEY`
- `BM_SCOUT_AUTH_MODE=internal|auto|demo` ; utiliser `internal` hors démo, `demo` seulement en local/test.
- `OPENAI_API_KEY`
- `OPENAI_MODEL` optionnel, par défaut `gpt-5.5`
- `OPENAI_SEARCH_MODEL` optionnel pour la découverte web OpenAI, par défaut `OPENAI_MODEL`
- `OPENAI_SEARCH_CONTEXT_SIZE=low|medium|high` optionnel, par défaut `medium`
- `OPENAI_SEARCH_MAX_OUTPUT_TOKENS` optionnel, par défaut `2400`
- `BM_SCOUT_AGENT_HOSTED_WEB_SEARCH=1` optionnel pour autoriser le `WebSearchTool` hébergé dans les agents ; désactivé par défaut pour éviter une double recherche quand le provider `openai_web` a déjà sourcé le batch.
- `BM_SCOUT_AGENT_MAX_TURNS` optionnel, borné entre 3 et 10, par défaut `6`
- `BM_SCOUT_WORKER_TIMEOUT_MS` optionnel, par défaut `300000`
- `SERPAPI_API_KEY` optionnel ; si présent, `auto` choisit SerpAPI avant OpenAI web.
- `BM_SCOUT_PROVIDER=auto|serpapi|openai_web|web|configured|demo`, par défaut `auto`
- `BM_SCOUT_SEARCH_QUERIES` optionnel pour piloter les requêtes web, format JSON ou `;`
- `BM_SCOUT_REAL_SEEDS` pour le mode `configured`, ex. `[{"company":"Cambon Partners","website":"https://www.cambonpartners.com","segment":"Conseil M&A","city":"Paris","country":"fr","linkedin_url":"https://www.linkedin.com/company/cambon-partners"}]`
- `BM_SCOUT_PROVIDER=demo` uniquement pour forcer explicitement le mode fixtures.

## Scheduler local

```bash
npm run agent:schedule
npm run agent:schedule:run
npm run agent:tasks
npm run agent:tasks:offline
npm run agent:tasks:real
npm run agent:tasks:recover-stale
npm run agent:cron:evidence -- --mode=real --limit=10
npm run feedback:evidence
npm run provider:compare
```

`agent:schedule` affiche le plan sans persistance. `agent:schedule:run` met des tâches en file dans Supabase si l'env serveur est configurée.
`agent:tasks` lit la queue Supabase sans exécuter. `agent:tasks:offline` consomme la queue avec le worker déterministe. `agent:tasks:real` consomme la queue avec OpenAI Agents SDK et `--persist`.
Les tâches Core/Exploration transmettent leurs objectifs au worker : `coreWeeklyTarget` devient `BM_SCOUT_CORE_TARGET`, `explorationScanTarget` devient `BM_SCOUT_EXPLORATION_SCAN_TARGET` et `explorationShortlistTarget` borne `BM_SCOUT_FETCH_LIMIT`.
`agent:tasks:recover-stale` marque comme failed les tâches `running` depuis plus de 90 minutes avant de consommer la queue offline ; utiliser `-- --stale-minutes=...` pour ajuster. Si une tâche stale est récupérée, la commande sort en échec pour rendre l'incident visible.
`agent:cron:evidence` est le wrapper utilisé par GitHub Actions : il met en file les routines dues, consomme jusqu'à 10 tâches, écrit `artifacts/agent-tasks/latest-ci-run.json` et échoue si le run n'est pas une vraie preuve `agent:tasks:real` avec secrets, les 6 routines P0 complétées et des traces worker Core/Exploration.
Pour une preuve readiness manuelle, GitHub Actions lance `agent:cron:evidence -- --all-p0` afin de forcer les 6 routines P0 au lieu de dépendre du calendrier du jour.
`feedback:evidence` seed un scénario contrôlé dans Supabase (`scout_feedback`, `scout_outcomes`, `scout_do_not_contact`), lance un worker Agents SDK Core persisté, écrit `artifacts/feedback-loop/latest-feedback-loop.json` et vérifie que `feedback_memory_effects` montre un impact score/message/blocage/angle ainsi qu'une synthèse Learning de 3 à 5 apprentissages exploitant feedback Romu + do-not-contact. Ce scénario utilise `BM_SCOUT_PROVIDER=configured` et ne compte donc pas comme preuve de recherche marché ou de volume PRD.
Ce scénario porte aussi `BM_SCOUT_EVIDENCE_PURPOSE=feedback_loop` : il doit prouver la causalité mémoire et la persistance, pas le scan 15/100.
`provider:compare` compare SerpAPI, OpenAI web et fallback web sur Core/Exploration et écrit `artifacts/provider-comparison/latest-comparison.json`.

## Tests

```bash
npm run test
npm run typecheck
npm run lint
npm run build
npm run quality:runs
npm run quality:readiness
npm run worker:test
npm run feedback:evidence
npm run provider:compare
```

`quality:runs` valide seulement le socle fixture. `quality:readiness` doit rester bloquant tant que BM Scout est `production_not_ready`; les artefacts réels doivent indiquer une mémoire Supabase, des feedbacks/outcomes chargés, un DNC Supabase chargé, les run steps `dnc_pre_generation_gate` et `feedback_reject_pre_generation_gate` prouvant les court-circuits avant outreach, des compteurs `feedback_memory_effects` prouvant un impact sur score/message/blocage/angle, des métadonnées runtime auditables et une révision code compatible avec le commit courant pour prouver le learning runtime.
Le rapport affiche un ancien artefact brut `pass` comme `fail (artefact pass inéligible)` si ses métadonnées ou sa révision ne prouvent pas le code courant.
Les artefacts worker réels ne comptent plus pour la readiness s'ils ne prouvent pas `scanned_count >= 15` en Core et `scanned_count >= 100` en Exploration.
Les runs issus de seeds configurées (`BM_SCOUT_PROVIDER=configured` ou `BM_SCOUT_REAL_SEEDS`) peuvent prouver une boucle feedback contrôlée via `artifacts/feedback-loop/latest-feedback-loop.json`, mais ne prouvent pas la recherche marché Core/Exploration ; `quality:readiness` ne les accepte pas pour les volumes opérationnels.
`quality:readiness` attend aussi un artefact cron GitHub Actions `artifacts/agent-tasks/latest-ci-run.json` en mode `real`, avec secrets Supabase/OpenAI présents, les 6 routines P0 complétées, des traces worker Core/Exploration, zéro tâche récupérée/échouée/bloquée et révision courante.
`verify:supabase` écrit aussi `artifacts/supabase-runtime/latest-verify.json`. `quality:readiness` peut utiliser cet artefact si l'env Supabase serveur n'est pas présente au moment du gate, mais uniquement si l'artefact est `pass`, porte la révision courante, contient des compteurs runtime complets, prouve la fusion RPC par domaine avec priorité Core + cleanup à zéro, et n'a pas été produit par un worktree `-dirty`.
`provider:compare` est un gate de recherche réelle : sans `SERPAPI_API_KEY` ou `OPENAI_API_KEY`, un échec est attendu et doit rester visible. Sa preuve `latest-comparison.json` doit aussi porter une révision code courante pour compter dans `quality:readiness`.
OpenAI a bien un tool officiel de recherche web via Responses API (`web_search`) et le provider `openai_web` l'utilise avec `tool_choice=required` pour éviter une recherche optionnelle. Dans le dernier smoke réel provider, OpenAI web passe Core et Exploration à volume PRD (`15/15` Core, `100/100` Exploration) ; SerpAPI reste utile pour comparer coût, stabilité et qualité des sources.

## Worker agentique

```bash
npm run worker:install
npm run worker:offline
npm run worker:real:core
npm run worker:real:exploration
npm run worker:real:core:persist
npm run worker:real:exploration:persist
cd services/agent-worker
../../.venv/bin/python -m bm_scout_worker.cli --real --mode core
../../.venv/bin/python -m bm_scout_worker.cli --real --mode core --persist
```

La persistance `--persist` passe par la RPC Supabase transactionnelle `scout_persist_mission_output`.
Le chemin réel utilise OpenAI Agents SDK avec `Runner.run`, `trace`, agents spécialisés, handoff QC, agents-as-tools et les tools métier `search_web`, `fetch_company_site`, `extract_company_signals`, `search_jobs`, `find_public_emails`, `dedupe_company`, `score_candidate`, `save_evidence`. Le `WebSearchTool` hébergé OpenAI reste disponible via `BM_SCOUT_AGENT_HOSTED_WEB_SEARCH=1`, mais il est désactivé par défaut parce que le provider `openai_web` utilise déjà le tool officiel Responses API `web_search` forcé pour sourcer le batch.
Les scripts `worker:real:*` écrivent les artefacts `artifacts/agent-worker-real/latest-real-*.json` consommés par `quality:readiness`, avec modèle, provider, version SDK, révision code, timestamps et durée dans `runner_complete`. Un artefact ancien ne compte pas pour la readiness si sa révision ne correspond pas au code courant ; un worktree sale est marqué `-dirty` et reste non éligible.
Les variantes `worker:real:*:persist` échouent maintenant si le worker réel ne prouve pas le volume PRD attendu (`15` Core, `100` Exploration ou objectifs env) ou si le step `persist_complete` Supabase est absent.
SerpAPI est branché derrière le même contrat métier que `openai_web`. En `auto`, `BM_SCOUT_REAL_SEEDS` reste prioritaire, puis `SERPAPI_API_KEY`, puis OpenAI web, puis le fallback web public. OpenAI web couvre déjà le smoke volume PRD ; SerpAPI reste à comparer avant un choix définitif de provider par défaut.

## Documentation

- `docs/architecture-v1.md`
- `docs/launch-runbook.md`
- `docs/demo-scenario.md`
- `docs/v1-limits.md`
- `docs/prd-completion-audit.md`
- `docs/thermo-nuclear-final-audit.md`
