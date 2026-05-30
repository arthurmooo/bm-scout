# Audit thermo-nuclear - BM Scout

Date : 2026-05-30

Verdict : `production_not_ready`.

## Findings prioritaires

1. La recherche réelle existe maintenant via OpenAI `web_search` et fallback public, mais elle n'est pas encore prouvée à volume PRD.
   - Risque : le produit ressemble encore à une démo agentique bien formée.
   - Remède : exécuter Core/Exploration réels à volume, comparer sources/shortlists et brancher SerpAPI si la couverture OpenAI/fallback public est insuffisante.

2. Le runner consomme une queue et un cron GitHub Actions est versionné, mais aucune exécution CI avec secrets n'est encore prouvée.
   - Risque : proactivité configurable, mais pas encore démontrée en production.
   - Remède : exécuter le workflow avec secrets et vérifier les transitions sur le projet interne.

3. La feedback loop causale existe localement, mais elle n'est pas encore prouvée en run réel Supabase à volume.
   - Risque : le moteur local change bien le scoring/message, mais le pilote réel peut rester sous-exercé.
   - Remède : exécuter Core/Exploration réels avec feedbacks/outcomes Supabase et comparer avant/après.

4. Les run steps sont persistés au niveau run/lead, mais pas encore au niveau de chaque tool call fin.
   - Risque : Arthur peut auditer un lead, mais pas encore toute la chaîne outil par outil.
   - Remède : enrichir les tools Agents SDK pour pousser leurs appels et résultats dans `run_steps`.

## Ce qui est plus sain après la passe

- Les routines sont dans un module dédié, pas dispersées dans l'UI.
- Les tâches `queued` peuvent maintenant passer par un runner `running -> completed/blocked/failed`.
- Le worker réel ne retombe plus silencieusement sur fixtures et expose `WebSearchTool` OpenAI plus 8 tools métier Agents SDK.
- La mémoire feedback locale pénalise les secteurs faibles, bloque les leads rejetés, renforce les angles validés et régénère les messages trop génériques.
- Observé/Inféré/Incertain et email confidence sont maintenant portés par TS, worker Pydantic, DB et RPC.
- Le RPC écrit des run steps minimaux (`mission_start`, `lead_persisted`, steps worker, `mission_complete`).
- Le provider réel ajoute des run steps outil-par-outil pour déduplication, fetch, extraction, email discovery, evidence save et scoring.
- Un workflow GitHub Actions cron/dispatch existe pour consommer `scout_agent_tasks`.
- Les actions Romu passent par une route serveur et une table d'événements.
- Le DNC est un gate déterministe côté TS, worker offline et DB.
- `quality:readiness` ne peut plus transformer des fixtures en claim de readiness.
- Le dashboard ne contient plus de routine codée en dur.

## Tests exécutés

- `npm run test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run quality:runs`
- `npm run quality:readiness` échoue comme attendu en `production_not_ready`
- `npm run agent:tasks` échoue sans env Supabase avec un message explicite.
- Import manager Agents SDK : 13 tools dont `WebSearchTool` et 8 tools métier.
- `.venv/bin/python -m pytest services/agent-worker/tests` / `npm run worker:test` : 21 tests
- Supabase interne : migration `bm_scout_structured_insights_email_confidence_steps` appliquée.

## Décision

Ne pas approuver comme V1 prête. La branche est acceptable comme étape de correction P0/P1, mais doit encore prouver le cron GitHub Actions avec secrets, la recherche réelle autonome à volume, les volumes PRD et la feedback loop sur données Supabase réelles.
