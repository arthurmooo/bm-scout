# Audit thermo-nuclear - BM Scout

Date : 2026-05-30

Verdict : `production_not_ready`.

## Findings prioritaires

1. Le worker Agents SDK reste trop dépendant d'un batch candidat structuré.
   - Risque : le produit ressemble encore à une démo agentique bien formée.
   - Remède : isoler des providers réels `search_web`, `fetch_company_site`, `search_jobs`, `find_public_emails`, `dedupe_company` et faire du mode real le chemin par défaut hors tests.

2. Le scheduler existe mais ne consomme pas encore une queue.
   - Risque : proactivité visible dans l'UI, mais exécution encore manuelle.
   - Remède : runner serveur qui prend `scout_agent_tasks queued`, passe `running`, persiste run/result, puis `completed/failed/blocked`.

3. La feedback loop n'est pas encore causale.
   - Risque : feedback stocké et prompté, sans preuve que le scoring suivant change.
   - Remède : modèle de mémoire explicite par secteur/angle/signal avec tests de pénalisation et bonus.

4. Observé/Inféré/Incertain n'est pas encore un contrat full-stack.
   - Risque : le TS bloque mieux les insights, mais le worker et la DB peuvent encore produire l'ancien format.
   - Remède : porter le contrat dans Pydantic, migration DB et RPC.

## Ce qui est plus sain après la passe

- Les routines sont dans un module dédié, pas dispersées dans l'UI.
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
- `.venv/bin/python -m pytest services/agent-worker/tests`

## Décision

Ne pas approuver comme V1 prête. La branche est acceptable comme étape de correction P0/P1, mais doit encore brancher l'exécution agentique réelle, les providers, la queue runner et la feedback loop causale.
