# Runbook de lancement - BM Scout V1

Statut : `production_not_ready`. Socle utilisable pour demo interne, pas pour déclarer la V1 opérationnelle.

## Pre-requis

- Node.js compatible Next 16.
- Python 3.12.
- Projet Supabase interne `Interne_Agentic_prospection`.
- Variables serveur :
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` pour Supabase Auth SSR, ou `NEXT_PUBLIC_SUPABASE_ANON_KEY` legacy si aucune publishable key n'est encore disponible
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `BM_SCOUT_AUTH_MODE=internal` hors démo ; `BM_SCOUT_AUTH_MODE=demo` seulement pour test local/fixtures
  - `OPENAI_API_KEY`
  - `SERPAPI_API_KEY` optionnel pour utiliser SerpAPI comme recherche SERP réelle
  - `OPENAI_MODEL` optionnel, par defaut `gpt-5.5`
  - `OPENAI_SEARCH_MODEL` optionnel pour la recherche web OpenAI
  - `OPENAI_SEARCH_CONTEXT_SIZE=low|medium|high` optionnel, par défaut `medium`
  - `OPENAI_SEARCH_MAX_OUTPUT_TOKENS` optionnel, par défaut `2400`
- `BM_SCOUT_AGENT_HOSTED_WEB_SEARCH=1` optionnel pour autoriser le `WebSearchTool` hébergé dans l'orchestration Agents SDK ; désactivé par défaut pour éviter une double recherche quand le provider `openai_web` a déjà sourcé le batch.
- `BM_SCOUT_AGENT_MAX_TURNS` optionnel, borné entre 3 et 10, par défaut `6`.
- `BM_SCOUT_WORKER_TIMEOUT_MS` optionnel, par défaut `300000`, pour éviter qu'un run worker reste bloqué sans sortie.
- `BM_SCOUT_PROVIDER=auto|serpapi|openai_web|web|configured|demo`
- `BM_SCOUT_SEARCH_QUERIES` optionnel pour piloter les requêtes web
- `BM_SCOUT_REAL_SEEDS` pour le mode `configured`
- `OPENAI_SEARCH_TIMEOUT_SECONDS` optionnel pour borner les appels OpenAI web search
- `BM_SCOUT_OPENAI_SEARCH_JOBS=1` optionnel si l'on accepte d'utiliser OpenAI aussi pour les recherches jobs ; par défaut les jobs utilisent le fallback web léger
  - `BM_SCOUT_PROVIDER=demo` seulement pour forcer explicitement les fixtures

Ne jamais exposer `SUPABASE_SERVICE_ROLE_KEY` dans le navigateur. Elle sert uniquement au worker et au rendu serveur.

## Auth interne

BM Scout utilise Supabase Auth SSR pour l'accès console :

- `/login` envoie un magic link Supabase avec `shouldCreateUser: false`.
- `/auth/callback` échange le code contre une session cookie.
- le proxy Next rafraîchit les cookies via `getClaims()`.
- la home et `POST /api/scout/actions` acceptent seulement les comptes dont `app_metadata` contient `bm_scout_role`, `bm_scout_roles` ou `bm_scout_access`.

Les claims attendus sont par exemple :

```json
{
  "app_metadata": {
    "bm_scout_roles": ["arthur", "romu"]
  }
}
```

Ne pas mettre ces rôles dans `user_metadata` : c'est modifiable par l'utilisateur et ignoré par le code.

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
- `20260530214847_bm_scout_structured_insights_email_confidence_steps.sql`

Verification cote Supabase :

```sql
select proname, pg_get_function_arguments(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
and proname = 'scout_persist_mission_output';
```

La fonction doit exister. Les nouvelles tables `scout_agent_tasks` et `scout_action_events` doivent aussi être présentes. Les colonnes `structured_insights`, `email_type`, `email_confidence`, `email_status` et des lignes `scout_run_steps` doivent être visibles après un run persisté.

## Lancer la console

```bash
npm run dev
```

Sans variables Supabase serveur, la console affiche les fixtures demo. Avec variables serveur, elle lit `scout_runs`, `scout_agent_tasks` et relations `scout_*`. Si Supabase est configuré mais vide, elle affiche zéro lead et les routines à lancer, pas les fixtures. Si `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` existe ou si `BM_SCOUT_AUTH_MODE=internal` est configuré, la console demande aussi une session Supabase interne.

Verification runtime :

```bash
npm run verify:supabase
```

Ce script doit retourner `status: pass` avec au moins :

- un run ;
- un lead prioritaire ;
- un rejet/QC ;
- 3 apprentissages ;
- une tâche `scout_agent_tasks` ;
- un feedback, un outcome, un DNC, des run steps et une trace d'action.

## Scheduler local

Planifier sans persister :

```bash
npm run agent:schedule
```

Mettre en file les routines dues dans Supabase :

```bash
npm run agent:schedule:run
```

Le scheduler évite les doublons de même journée pour une tâche non annulée. Cadence actuelle :

- lundi ouvré : `weekly_core_research`, `weekly_exploration_scan`, `daily_brief`, `learning_review`, `dnc_check`, `followup_review` ;
- autres jours ouvrés : `daily_brief`, `dnc_check`, `followup_review` ;
- week-end : aucune tâche, sauf lancement manuel ciblé.

La base ajoute aussi l'index unique partiel `scout_agent_tasks_active_type_schedule_uniq`, qui bloque deux tâches `queued/running` identiques sur le même `type` + `scheduled_for`.

Lancement ciblé ou rerun assumé :

```bash
npm run agent:schedule:run -- --task=dnc_check
npm run agent:schedule:run -- --task=weekly_core_research --force
```

Lire la queue sans exécuter :

```bash
npm run agent:tasks
```

Consommer la queue :

```bash
npm run agent:tasks:offline
npm run agent:tasks:real
npm run agent:tasks:recover-stale
```

`agent:tasks:recover-stale` récupère d'abord les tâches `running` depuis plus de 90 minutes en les marquant `failed`, puis consomme la queue offline. Si une tâche stale est récupérée, la commande sort non-zero pour alerter sur l'incident. Pour un seuil différent : `npm run agent:tasks:offline -- --recover-stale --stale-minutes=30`.

Le runner transmet les volumes de `scout_agent_tasks.payload` au worker Python : Core utilise `BM_SCOUT_CORE_TARGET`, Exploration utilise `BM_SCOUT_EXPLORATION_SCAN_TARGET` et borne le fetch par `explorationShortlistTarget`.

Limite actuelle : le scheduler sait mettre en file les 6 routines P0, mais le cron production reste à prouver avec secrets. `agent:tasks:real` lance le worker OpenAI Agents SDK et requiert `OPENAI_API_KEY`.
Les actions Romu de feedback et outcome écrivent `scout_feedback` / `scout_outcomes`, puis les runs suivants les rechargent via le worker. Cela doit être prouvé par comparaison avant/après sur un run Supabase réel avant tout statut pilote.

## Comparer les providers de recherche

```bash
npm run provider:compare
```

La commande écrit :

- `artifacts/provider-comparison/latest-comparison.json`
- `artifacts/provider-comparison/latest-comparison.md`

Elle compare `serpapi`, `openai_web` et `web` sur Core et Exploration. Sans `SERPAPI_API_KEY` ou `OPENAI_API_KEY`, ces providers sont marqués `unavailable` au lieu de retomber silencieusement sur les fixtures. Les artefacts incluent la révision code, la version Python et la version du SDK OpenAI ; `quality:readiness` les refuse si ces métadonnées manquent ou si la révision ne correspond pas au commit courant. Le statut `pass` de cette comparaison ne suffit pas pour déclarer BM Scout prêt : il faut encore des runs Agents SDK réels, persistés, à volume PRD.
Un smoke ciblé `--modes=core` peut passer pour vérifier OpenAI web, mais il marque volontairement `prd_volume_proven=false` tant que Core et Exploration n'ont pas été mesurés ensemble.

Résultat actuel avec OpenAI web seul :

- Core + Exploration (`BM_SCOUT_FETCH_LIMIT=3`) : pass, Core `15/15`, Exploration `100/100`, `prd_volume_proven=true`, provider recommandé `openai_web`.

Décision actuelle : OpenAI `web_search` prouve maintenant le scan large en smoke provider. Brancher SerpAPI reste utile pour comparer coût, stabilité et qualité des sources avant de choisir le provider par défaut.

## Cron GitHub Actions

Le workflow `.github/workflows/bm-scout-agent-tasks.yml` planifie les jours ouvrés à 12:30 UTC, après les six créneaux Paris 08:15 -> 13:15. Il lance `agent:cron:evidence`, qui met en file les routines dues, consomme jusqu'à 10 tâches et écrit `artifacts/agent-tasks/latest-ci-run.json`.

Le déclenchement manuel reste possible en mode `real` ou `offline`, mais seul un artefact GitHub Actions en mode `real`, avec secrets Supabase + OpenAI, transitions `completed` et révision courante peut compter dans `quality:readiness`.

Secrets requis :

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `SERPAPI_API_KEY` optionnel si `BM_SCOUT_PROVIDER=serpapi` ou si le mode `auto` doit préférer SerpAPI

Variables recommandées :

- `OPENAI_MODEL`
- `OPENAI_SEARCH_MODEL`
- `SERPAPI_API_KEY`
- `BM_SCOUT_PROVIDER`
- `BM_SCOUT_SEARCH_QUERIES`
- `BM_SCOUT_REAL_SEEDS`

Le runner exécute Core/Exploration via le worker Python, puis Daily Brief, Learning Review, DNC check et followup review via une lecture déterministe du snapshot Supabase runtime. Ces routines non-worker se bloquent explicitement si aucun run persistant n'existe, afin de ne pas transformer les fixtures demo en preuve opérationnelle.

Le workflow est versionné, mais BM Scout reste `production_not_ready` tant qu'aucune exécution GitHub Actions réelle avec secrets n'a produit un artefact `latest-ci-run.json` valide prouvant les transitions `queued -> completed`.

## Lancer le worker

Mode offline :

```bash
npm run worker:offline
```

Mode reel sans persistance :

```bash
export BM_SCOUT_PROVIDER=openai_web
export BM_SCOUT_SEARCH_QUERIES='["conseil M&A transaction services France","cabinet corporate finance fusion acquisition France"]'
npm run worker:real:core
npm run worker:real:exploration
```

Mode réel avec SerpAPI :

```bash
export SERPAPI_API_KEY=...
export BM_SCOUT_PROVIDER=serpapi
export BM_SCOUT_SEARCH_QUERIES='["conseil M&A transaction services France","cabinet corporate finance fusion acquisition France"]'
npm run worker:real:core
npm run worker:real:exploration
```

Mode reel avec seeds contrôlées :

```bash
cd services/agent-worker
export BM_SCOUT_PROVIDER=configured
export BM_SCOUT_REAL_SEEDS='[{"company":"Cambon Partners","website":"https://www.cambonpartners.com","segment":"Conseil M&A"}]'
../../.venv/bin/python -m bm_scout_worker.cli --real --mode core
../../.venv/bin/python -m bm_scout_worker.cli --real --mode exploration --include-weak
```

Mode reel avec persistance Supabase :

```bash
npm run worker:real:core:persist
npm run worker:real:exploration:persist
```

Les scripts `worker:real:*` lancent la CLI Python et écrivent les artefacts de preuve `artifacts/agent-worker-real/latest-real-*.json` lus par `quality:readiness`. Le runner `agent:tasks:real` écrit les mêmes artefacts quand il consomme les routines `scout_agent_tasks`. Le wrapper tue le worker après `BM_SCOUT_WORKER_TIMEOUT_MS` pour éviter les runs pendus.
Les artefacts sont écrasés même en cas de timeout ou de sortie JSON invalide, avec `verdict=fail`, pour éviter de conserver une ancienne preuve `pass`.
Le worker lit `scout_feedback`, `scout_outcomes` et `scout_do_not_contact` si les variables Supabase serveur sont presentes, avec le contexte `scout_companies(name, segment, website)` quand la relation PostgREST est disponible. Les artefacts exposent `feedback_memory_source`, le nombre d'événements feedback, le nombre d'événements DNC chargés, les compteurs `feedback_memory_effects` montrant les impacts sur score/blocage/DNC/message/angle/segment, le modèle, le provider, les versions SDK, la révision code, les timestamps et la durée. `quality:readiness` ne compte un artefact réel que si ces métadonnées sont complètes et si la révision correspond au code courant ; un worktree sale est marqué `-dirty` et reste non éligible pour éviter les preuves ambiguës. La persistance passe par la RPC transactionnelle `scout_persist_mission_output`, qui écrit aussi les insights structurés, l'email confidence, les run steps provider et les tool calls Agents SDK compactés.
En `BM_SCOUT_PROVIDER=auto`, le worker utilise les seeds si elles existent, sinon SerpAPI si `SERPAPI_API_KEY` est présent, sinon OpenAI `web_search` si `OPENAI_API_KEY` est présent, sinon un fallback web public minimal. En `BM_SCOUT_PROVIDER=configured`, l'absence de `BM_SCOUT_REAL_SEEDS` échoue au lieu de retomber sur fixtures. Pour une demo fixture explicite : `BM_SCOUT_PROVIDER=demo`.
SerpAPI passe par `https://serpapi.com/search.json` avec `engine=google`, `q`, `hl`, `gl` et `num`, puis BM Scout ne garde que les `organic_results` qui passent le filtre source.

## Gates avant usage Romu

```bash
npm run typecheck
npm run lint
npm run test
npm run worker:test
npm run build
npm run quality:runs
npm run feedback:evidence
npm run provider:compare
npm run agent:cron:evidence -- --mode=real --limit=10
npm run verify:supabase
npm run quality:readiness
```

`quality:readiness` doit echouer tant que la V1 n'a pas les preuves runtime serveur completes. Il ne faut pas contourner ce gate en interpretant `quality:runs` comme une validation produit.
Les artefacts `latest-real-*.json` doivent prouver `scanned_count >= 15` pour Core et `scanned_count >= 100` pour Exploration. Un run réel réduit par seeds trop courtes ou un smoke provider ne suffit pas à lever le blocker de volume PRD.
`feedback:evidence` est le run contrôlé pour P0.5 : il écrit des feedbacks/outcomes/DNC dans Supabase, force `BM_SCOUT_PROVIDER=configured`, lance Core en `--persist`, puis exige des compteurs `feedback_memory_effects`. Il prouve la causalité mémoire, pas la découverte marché ; un artefact configured ne doit pas être utilisé pour lever les blockers Core/Exploration à volume.
`verify:supabase` écrit `artifacts/supabase-runtime/latest-verify.json` à chaque exécution, y compris en échec d'env. `quality:readiness` accepte cette preuve uniquement si elle est `pass`, générée par la révision courante, non `-dirty`, avec runs, leads, rejets QC, lessons, tasks, feedbacks, outcomes, DNC, run steps, traces et actions Romu persistés.

## Decision de lancement

BM Scout peut etre utilise en demo interne si :

- la console s'ouvre ;
- les fixtures sont lisibles ;
- les runs Core/Exploration reels existent dans les artefacts ou Supabase, avec métadonnées runtime complètes et révision code courante ;
- les messages restent en copier-coller manuel ;
- Romu sait que la V1 n'envoie rien.

BM Scout peut etre marque au mieux `pilot_candidate` uniquement si :

- `verify:supabase` passe avec la vraie env serveur ;
- l'artefact `artifacts/supabase-runtime/latest-verify.json` correspond au commit courant et n'est pas un run ancien ;
- la CLI `--persist` a cree un run lisible dans Supabase ;
- un run reel Agents SDK post-branchement feedback Supabase a produit 3 a 5 apprentissages exploitables ;
- les feedbacks/outcomes/DNC Supabase changent réellement le scoring, l'angle, le blocage DNC, le message ou la shortlist suivante, avec `feedback_memory_effects.impact_count > 0` ;
- les routines `scout_agent_tasks` sont consommées par un runner reproductible et par un cron GitHub Actions réellement vert ;
- les providers réels ne se limitent plus aux seeds configurées et prouvent un volume Core/Exploration suffisant ;
- `quality:readiness` passe ;
- un compte Romu/Arthur réel passe le login et un compte sans `app_metadata` est bloqué ;
- l'audit thermo-nuclear ne contient plus de P1 ouvert.
