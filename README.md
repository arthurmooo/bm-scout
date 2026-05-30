# BM Scout

Console interne de prospection agentique pour BM Automation.

Statut actuel : `production_not_ready`.

BM Scout n'est pas un CRM, pas un SaaS standard et pas un générateur de messages froids. Le produit vise un employé IA d'acquisition : il prépare le travail, filtre le bruit, source les signaux, bloque les risques et demande seulement les décisions commerciales sensibles à Romu.

## Ce qui existe maintenant

- Console Next.js centrée sur la prochaine décision Romu.
- Schéma Supabase pour runs, leads, preuves, messages, feedbacks, outcomes, DNC, run steps, tasks et action events.
- Worker Python OpenAI Agents SDK avec `Runner.run`, `trace`, agents spécialisés et outputs Pydantic.
- Scheduler local reproductible qui crée les routines Core, Exploration, Daily Brief, Learning, DNC check et followup review.
- Runner de queue `scout_agent_tasks` qui passe les tâches `queued -> running -> completed/blocked/failed`.
- Actions UI branchées sur une API serveur : valider, rejeter, enrichir, copier, DNC, lancer routines.
- DNC hard gate côté qualité TS, côté worker offline et côté DB pour empêcher un message non bloqué sur une cible DNC.
- Feedback memory locale : mauvais lead/secteur pénalisé, angle validé renforcé, message générique régénéré, DNC bloquant.
- Observé/Inféré/Incertain, email confidence et run steps persistés via Supabase/RPC.
- Rapport qualité qui distingue le harnais fixture de la readiness produit réelle.

## Ce qui n'est pas encore prêt

- Pas de cron production branché.
- Pas de preuve volume 15 Core / 100 Exploration en run réel.
- Recherche marché réelle encore limitée : le worker réel passe par un provider configuré et des tools métier, mais pas encore par un moteur de recherche web industrialisé à volume PRD.
- Feedback loop prouvée localement, pas encore validée sur un run réel Supabase à volume.
- `quality:readiness` échoue volontairement tant que ces preuves ne sont pas là.
- RLS/auth restent internes et à durcir avant production.

## Lancer

```bash
npm install
npm run dev
```

Variables serveur :

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` optionnel, par défaut `gpt-5.5`
- `BM_SCOUT_REAL_SEEDS` pour le mode réel sans fixtures, ex. `[{"company":"Cambon Partners","website":"https://www.cambonpartners.com","segment":"Conseil M&A"}]`
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
cd services/agent-worker
../../.venv/bin/python -m bm_scout_worker.cli --real --mode core
../../.venv/bin/python -m bm_scout_worker.cli --real --mode core --persist
```

La persistance `--persist` passe par la RPC Supabase transactionnelle `scout_persist_mission_output`.
Le chemin réel expose des tools Agents SDK : `search_web`, `fetch_company_site`, `extract_company_signals`, `search_jobs`, `find_public_emails`, `dedupe_company`, `score_candidate`, `save_evidence`.

## Documentation

- `docs/architecture-v1.md`
- `docs/launch-runbook.md`
- `docs/demo-scenario.md`
- `docs/v1-limits.md`
- `docs/prd-completion-audit.md`
- `docs/thermo-nuclear-final-audit.md`
