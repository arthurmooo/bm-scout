# Audit thermo-nuclear - BM Scout

Date : 2026-05-31

Verdict : `production_not_ready`.

## Findings prioritaires

1. La recherche réelle existe maintenant via OpenAI `web_search` et fallback public, mais elle n'est pas encore prouvée à volume PRD.
   - Risque : le produit ressemble encore à une démo agentique bien formée.
   - Remède : exécuter Core/Exploration réels à volume, comparer sources/shortlists entre SerpAPI, OpenAI web et fallback public.
   - Garde-fou ajouté : une comparaison Core seule reste un smoke technique, mais ne peut plus produire `prd_volume_proven=true`.

2. Le scheduler met maintenant en file les 6 routines P0 de façon idempotente et le runner consomme une queue, mais aucune exécution CI avec secrets n'est encore prouvée.
   - Risque : proactivité structurée, mais pas encore démontrée en production.
   - Remède : exécuter le workflow avec secrets et vérifier les transitions sur le projet interne.

3. La feedback loop causale existe localement côté TS et worker Python, mais elle n'est pas encore prouvée en run réel Supabase à volume.
   - Risque : les moteurs testés changent bien le scoring/message, mais le pilote réel peut rester sous-exercé.
   - Remède : exécuter Core/Exploration réels avec feedbacks/outcomes Supabase et comparer avant/après.

4. Les run steps couvrent maintenant provider et function tools Agents SDK, mais le tracing OpenAI hébergé doit encore être corrélé à des runs réels persistés.
   - Risque : Arthur peut auditer les tools internes, mais pas encore prouver toute la chaîne OpenAI web/traces sur Supabase à volume.
   - Remède : exécuter les runs réels persistés, conserver les trace IDs et vérifier la présence des tool calls dans `scout_run_steps`.

## Ce qui est plus sain après la passe

- Les routines sont dans un module dédié, pas dispersées dans l'UI.
- Le scheduler de cron couvre maintenant `dnc_check` et `followup_review`, pas seulement les 4 actions lançables depuis l'UI.
- Un index unique partiel bloque les doublons actifs `queued/running` côté Supabase pour les tâches agentiques.
- Les foreign keys de persistance/actions/messages/evidence/learning sont couvertes par indexes ; l'advisor Supabase ne remonte plus de `unindexed_foreign_keys`.
- Les tâches `queued` peuvent maintenant passer par un runner `running -> completed/blocked/failed`.
- Les routines Daily Brief, Learning Review, DNC check et followup review ne restent plus bloquées par défaut : elles lisent le runtime Supabase et refusent les fixtures comme preuve opérationnelle.
- Le worker réel ne retombe plus silencieusement sur fixtures et expose `WebSearchTool` OpenAI plus 8 tools métier Agents SDK.
- `search_jobs` produit maintenant des preuves recrutement publiques et des run steps au lieu d'être un no-op.
- La mémoire feedback TS et worker pénalise les secteurs faibles, bloque les leads rejetés/DNC, renforce les angles validés et régénère les messages trop génériques.
- Observé/Inféré/Incertain et email confidence sont maintenant portés par TS, worker Pydantic, DB et RPC.
- Le RPC écrit des run steps minimaux (`mission_start`, `lead_persisted`, steps worker, `mission_complete`).
- Le provider réel ajoute des run steps outil-par-outil pour déduplication, fetch, extraction, email discovery, evidence save et scoring.
- Les function tools Agents SDK enregistrent leurs entrées/sorties compactées pendant `Runner.run`.
- Les scripts `worker:real:*` et le runner de queue écrivent maintenant les artefacts `latest-real-*.json` attendus par `quality:readiness`.
- Un workflow GitHub Actions cron/dispatch existe pour consommer `scout_agent_tasks`.
- Les actions Romu passent par une route serveur et une table d'événements.
- Les copies email/relance/LinkedIn ne touchent plus le presse-papiers avant validation serveur, et le serveur bloque une copie ou approbation de message DNC, QC bloquée ou email non utilisable.
- Les actions feedback/outcome Romu alimentent maintenant `scout_feedback` et `scout_outcomes`, donc la mémoire agentique ne dépend plus seulement de notes fictives.
- Le DNC est un gate déterministe côté TS, worker offline et DB.
- `quality:readiness` ne peut plus transformer des fixtures en claim de readiness.
- Le dashboard ne contient plus de routine codée en dur.
- Le provider OpenAI web est branché et testé avec une verbosité compatible `gpt-4.1-mini`, mais le dernier smoke réel reste sous les volumes PRD (`14/15` Core, `75/100` Exploration).
- Les runs réels Agents SDK Core et Exploration passent sans persistance Supabase, après séparation du schéma strict modèle et du `MissionOutput` runtime avec `run_steps`.

## Tests exécutés

- `npm run test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run quality:runs`
- `npm run quality:readiness` échoue comme attendu en `production_not_ready`
- `npm exec tsx -- scripts/run-agent-worker-evidence.ts --offline --mode=core` : pass, harnais d'artefact vérifié sans Supabase.
- `npm run worker:real:core` : pass réel Agents SDK sans persistance Supabase.
- `npm run worker:real:exploration` : pass réel Agents SDK sans persistance Supabase.
- `npm run agent:tasks` échoue sans env Supabase avec un message explicite.
- Tests runner TS : routines brief/learning/DNC/followup couvertes.
- Tests actions TS : feedback bon angle, message générique, outcome RDV et DNC vers mémoire couverts.
- Tests sécurité Supabase : policies RLS internes, absence de service role côté client, fermeture RPC security definer.
- Import manager Agents SDK : 13 tools dont `WebSearchTool` et 8 tools métier.
- `.venv/bin/python -m pytest services/agent-worker/tests` / `npm run worker:test` : 44 tests
- Supabase interne : migrations feedback/outcome et RLS appliquées ; advisor sécurité à 0 lint.

## Décision

Ne pas approuver comme V1 prête. La branche est acceptable comme étape de correction P0/P1, mais doit encore prouver le cron GitHub Actions avec secrets, la recherche réelle autonome à volume, les volumes PRD et la feedback loop sur données Supabase réelles.
