# BM Scout

Console interne de prospection agentique pour BM Automation.

Statut actuel : `production_not_ready`.

BM Scout n'est pas un CRM, pas un SaaS standard et pas un générateur de messages froids. Le produit vise un employé IA d'acquisition : il prépare le travail, filtre le bruit, source les signaux, bloque les risques et demande seulement les décisions commerciales sensibles à Romu.

## Ce qui existe maintenant

- Console Next.js centrée sur la prochaine décision Romu.
- Schéma Supabase pour runs, leads, preuves, messages, feedbacks, outcomes, DNC, run steps, tasks et action events.
- Worker Python OpenAI Agents SDK avec `Runner.run`, `trace`, agents spécialisés et outputs Pydantic.
- Recherche métier provider : découverte web, fetch site, extraction signaux, job search public, emails publics, déduplication et scoring.
- Scheduler local reproductible qui crée les routines Core, Exploration, Daily Brief, Learning, DNC check et followup review.
- Runner de queue `scout_agent_tasks` qui passe les tâches `queued -> running -> completed/blocked/failed`.
- Routines Daily Brief, Learning Review, DNC check et followup review exécutables depuis les runs Supabase persistés, avec blocage explicite si elles n'ont que les fixtures.
- Workflow GitHub Actions `.github/workflows/bm-scout-agent-tasks.yml` pour cron/dispatch, à activer avec secrets.
- Actions UI branchées sur une API serveur : valider, rejeter, enrichir, copier, DNC, lancer routines.
- Feedbacks et outcomes Romu persistés dans `scout_feedback` / `scout_outcomes` : bon/mauvais lead, bon angle, message générique, RDV, positif/négatif, timing, mauvais interlocuteur.
- DNC hard gate côté qualité TS, côté worker offline et côté DB pour empêcher un message non bloqué sur une cible DNC.
- Feedback memory TS + worker provider : mauvais lead/secteur pénalisé, angle validé renforcé, message générique régénéré, DNC bloquant, contexte entreprise/segment chargé depuis Supabase.
- Observé/Inféré/Incertain, email confidence, run steps provider et tool calls Agents SDK persistés via Supabase/RPC.
- RLS Supabase durcie : policies `authenticated` restreintes aux rôles internes via `app_metadata`, service role réservée au serveur/worker, advisor sécurité Supabase sans lint après migration.
- Auth interne Supabase SSR branchée : login magic link, refresh cookies via proxy Next, API actions bloquée si l'utilisateur n'a pas de claim `app_metadata` BM Scout. Le mode démo local reste explicite via `BM_SCOUT_AUTH_MODE=demo`.
- Rapport qualité qui distingue le harnais fixture de la readiness produit réelle.

## Ce qui n'est pas encore prêt

- Cron GitHub Actions versionné, mais pas encore prouvé par un run CI avec secrets.
- Pas de preuve volume 15 Core / 100 Exploration en run réel.
- Recherche marché réelle encore limitée : le worker peut utiliser OpenAI `web_search` ou un fallback web public avec job search minimal, mais les volumes PRD et la qualité des sources restent à prouver en run réel.
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
- `BM_SCOUT_PROVIDER=auto|openai_web|web|configured|demo`, par défaut `auto`
- `BM_SCOUT_SEARCH_QUERIES` optionnel pour piloter les requêtes web, format JSON ou `;`
- `BM_SCOUT_REAL_SEEDS` pour le mode `configured`, ex. `[{"company":"Cambon Partners","website":"https://www.cambonpartners.com","segment":"Conseil M&A"}]`
- `BM_SCOUT_PROVIDER=demo` uniquement pour forcer explicitement le mode fixtures.

## Scheduler local

```bash
npm run agent:schedule
npm run agent:schedule:run
npm run agent:tasks
npm run agent:tasks:offline
npm run agent:tasks:real
```

`agent:schedule` affiche le plan sans persistance. `agent:schedule:run` met des tâches en file dans Supabase si l'env serveur est configurée.
`agent:tasks` lit la queue Supabase sans exécuter. `agent:tasks:offline` consomme la queue avec le worker déterministe. `agent:tasks:real` consomme la queue avec OpenAI Agents SDK et `--persist`.

## Tests

```bash
npm run test
npm run typecheck
npm run lint
npm run build
npm run quality:runs
npm run quality:readiness
npm run worker:test
```

`quality:runs` valide seulement le socle fixture. `quality:readiness` doit rester bloquant tant que BM Scout est `production_not_ready`.

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
Le chemin réel expose le `WebSearchTool` hébergé OpenAI dans l'orchestration Agents SDK, plus les tools métier `search_web`, `fetch_company_site`, `extract_company_signals`, `search_jobs`, `find_public_emails`, `dedupe_company`, `score_candidate`, `save_evidence`.
Les scripts `worker:real:*` écrivent les artefacts `artifacts/agent-worker-real/latest-real-*.json` consommés par `quality:readiness`.
SerpAPI pourra remplacer ou compléter `openai_web` plus tard sans changer le contrat métier du provider. OpenAI `web_search` est le provider réel par défaut utile en V1 ; SerpAPI reste pertinent si Arthur veut une SERP plus brute, contrôlable et comparable.

## Documentation

- `docs/architecture-v1.md`
- `docs/launch-runbook.md`
- `docs/demo-scenario.md`
- `docs/v1-limits.md`
- `docs/prd-completion-audit.md`
- `docs/thermo-nuclear-final-audit.md`
