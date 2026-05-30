# Runbook de lancement - BM Scout V1

Statut : `production_not_ready`. Socle utilisable pour demo interne, pas pour déclarer la V1 opérationnelle.

## Pre-requis

- Node.js compatible Next 16.
- Python 3.12.
- Projet Supabase interne `Interne_Agentic_prospection`.
- Variables serveur :
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL` optionnel, par defaut `gpt-5.5`

Ne jamais exposer `SUPABASE_SERVICE_ROLE_KEY` dans le navigateur. Elle sert uniquement au worker et au rendu serveur.

## Installation

```bash
npm install
python3 -m venv .venv
npm run worker:install
```

## Base Supabase

Migrations attendues :

- `20260530161000_bm_scout_v1.sql`
- `20260530150744_bm_scout_atomic_persist_and_feedback_memory.sql`
- `20260530210927_agent_tasks_and_actions.sql`

Verification cote Supabase :

```sql
select proname, pg_get_function_arguments(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
and proname = 'scout_persist_mission_output';
```

La fonction doit exister. Les nouvelles tables `scout_agent_tasks` et `scout_action_events` doivent aussi être présentes.

## Lancer la console

```bash
npm run dev
```

Sans variables Supabase serveur, la console affiche les fixtures demo. Avec variables serveur, elle lit `scout_runs` et relations `scout_*`.

Verification runtime :

```bash
npm run verify:supabase
```

Ce script doit retourner `status: pass` avec au moins :

- un run ;
- un lead prioritaire ;
- un rejet/QC ;
- un apprentissage.

## Scheduler local

Planifier sans persister :

```bash
npm run agent:schedule
```

Mettre en file les routines supportées dans Supabase :

```bash
npm run agent:schedule:run
```

Limite actuelle : ce script crée les tâches, mais le cron production et le worker qui consomme automatiquement la queue restent à brancher.

## Lancer le worker

Mode offline :

```bash
npm run worker:offline
```

Mode reel sans persistance :

```bash
cd services/agent-worker
../../.venv/bin/python -m bm_scout_worker.cli --real --mode core
../../.venv/bin/python -m bm_scout_worker.cli --real --mode exploration --include-weak
```

Mode reel avec persistance Supabase :

```bash
cd services/agent-worker
../../.venv/bin/python -m bm_scout_worker.cli --real --mode core --persist
```

Le worker lit `scout_feedback` et `scout_outcomes` si les variables Supabase serveur sont presentes. La persistance passe par la RPC transactionnelle `scout_persist_mission_output`.

## Gates avant usage Romu

```bash
npm run typecheck
npm run lint
npm run test
npm run worker:test
npm run build
npm run quality:runs
npm run verify:supabase
npm run quality:readiness
```

`quality:readiness` doit echouer tant que la V1 n'a pas les preuves runtime serveur completes. Il ne faut pas contourner ce gate en interpretant `quality:runs` comme une validation produit.

## Decision de lancement

BM Scout peut etre utilise en demo interne si :

- la console s'ouvre ;
- les fixtures sont lisibles ;
- les runs Core/Exploration reels existent dans les artefacts ou Supabase ;
- les messages restent en copier-coller manuel ;
- Romu sait que la V1 n'envoie rien.

BM Scout peut etre marque au mieux `pilot_candidate` uniquement si :

- `verify:supabase` passe avec la vraie env serveur ;
- la CLI `--persist` a cree un run lisible dans Supabase ;
- un run reel Agents SDK post-branchement feedback Supabase a produit 3 a 5 apprentissages exploitables ;
- les routines `scout_agent_tasks` sont consommées par un runner reproductible ;
- les providers réels ne se limitent plus au batch candidat structuré ;
- `quality:readiness` passe ;
- l'audit thermo-nuclear ne contient plus de P1 ouvert.
