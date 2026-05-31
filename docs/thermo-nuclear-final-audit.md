# Audit thermo-nuclear - BM Scout

Date : 2026-05-31

Verdict : `production_not_ready`.

## Findings prioritaires

1. La recherche réelle OpenAI `web_search` prouve maintenant les volumes PRD en smoke provider, mais pas encore en routine Agents SDK persistée Supabase.
   - Risque : le provider est crédible, mais la preuve opérationnelle bout-en-bout reste incomplète.
   - Remède : exécuter Core/Exploration réels persistés à volume, comparer sources/shortlists entre SerpAPI, OpenAI web et fallback public.
   - Garde-fou ajouté : une comparaison Core seule reste un smoke technique, mais ne peut plus produire `prd_volume_proven=true`.

2. Le scheduler met maintenant en file les 6 routines P0 de façon idempotente et le runner consomme une queue, mais aucune exécution CI avec secrets n'est encore prouvée.
   - Risque : proactivité structurée, mais pas encore démontrée en production.
   - Remède : exécuter le workflow avec secrets, télécharger l'artefact `bm-scout-agent-task-evidence` et vérifier les transitions sur le projet interne.

3. La feedback loop causale existe localement côté TS et worker Python, avec compteurs d'impact, synthèse Learning vérifiée et script de preuve Supabase, mais elle n'est pas encore exécutée avec secrets ni prouvée en run marché à volume.
   - Risque : les moteurs testés changent bien le scoring/message/blocage/angle, mais le pilote réel peut rester sous-exercé.
   - Remède : exécuter `npm run feedback:evidence`, vérifier `feedback_memory_effects.impact_count > 0` et `learning_uses_feedback=true`, puis confirmer la même mémoire sur Core/Exploration réels à volume.

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
- La mémoire feedback TS et worker pénalise les secteurs faibles, bloque les leads rejetés/DNC, renforce les angles validés et régénère les messages trop génériques. Le worker charge aussi `scout_do_not_contact` directement, court-circuite DNC/rejets avant outreach quand possible et expose les impacts dans `feedback_memory_effects`.
- Observé/Inféré/Incertain et email confidence sont maintenant portés par TS, worker Pydantic, DB et RPC.
- Le RPC écrit des run steps minimaux (`mission_start`, `lead_persisted`, steps worker, `mission_complete`).
- Le provider réel ajoute des run steps outil-par-outil pour déduplication, fetch, extraction, email discovery, evidence save et scoring.
- Les function tools Agents SDK enregistrent leurs entrées/sorties compactées pendant `Runner.run`.
- Les scripts `worker:real:*` et le runner de queue écrivent maintenant les artefacts `latest-real-*.json` attendus par `quality:readiness`.
- Le runner de queue transmet les volumes PRD au worker ; le worker dérive `scanned_count` des steps provider, et la readiness vérifie explicitement les volumes Core/Exploration.
- La readiness distingue le provider runtime : `configured` ne compte plus comme preuve de recherche marché, même si le run Agents SDK est réel et persisté.
- Un workflow GitHub Actions cron/dispatch existe pour consommer `scout_agent_tasks` et écrire une preuve `latest-ci-run.json`.
- Les actions Romu passent par une route serveur et une table d'événements.
- Les copies email/relance/LinkedIn ne touchent plus le presse-papiers avant validation serveur, et le serveur bloque une copie ou un marquage `used_manually` de message DNC, QC bloqué ou email non utilisable.
- Les actions feedback/outcome Romu alimentent maintenant `scout_feedback` et `scout_outcomes`, donc la mémoire agentique ne dépend plus seulement de notes fictives.
- Le DNC et les rejets/outcomes négatifs sont des gates déterministes côté TS/worker/provider/DB selon leur portée ; la base bloque les nouveaux messages DNC et passe aussi les messages existants en `blocked` quand une cible devient DNC via table DNC, contact ou entreprise. `feedback:evidence` exige désormais les run steps `dnc_pre_generation_gate` et `feedback_reject_pre_generation_gate`.
- `quality:readiness` ne peut plus transformer des fixtures en claim de readiness.
- Le dashboard ne contient plus de routine codée en dur.
- Le provider OpenAI web est branché et testé avec contexte `medium`, verbosité compatible `gpt-4.1-mini` et surface de requêtes élargie ; le dernier smoke réel atteint les volumes PRD (`15/15` Core, `100/100` Exploration).
- Les runs réels Agents SDK Core et Exploration passent sans persistance Supabase, après séparation du schéma strict modèle et du `MissionOutput` runtime avec `run_steps`.

## Tests exécutés

- `npm run test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run quality:runs`
- `npm run quality:readiness` échoue comme attendu en `production_not_ready`
- `npm exec tsx -- scripts/run-agent-worker-evidence.ts --offline --mode=core` : pass, harnais d'artefact vérifié sans Supabase.
- `npm run worker:real:core` : pass réel Agents SDK sans persistance Supabase sur l'artefact de référence précédent ; la dernière tentative de relance OpenAI a été arrêtée après blocage long, et le runner dispose maintenant d'un timeout explicite.
- `npm run worker:real:exploration` : pass réel Agents SDK sans persistance Supabase sur l'artefact de référence précédent.
- `npm run agent:tasks` échoue sans env Supabase avec un message explicite.
- Tests runner TS : routines brief/learning/DNC/followup couvertes.
- Tests actions TS : feedback bon angle, message générique, outcome RDV et DNC vers mémoire couverts.
- Tests sécurité Supabase : policies RLS internes, absence de service role côté client, fermeture RPC security definer.
- Import manager Agents SDK : 13 tools dont `WebSearchTool` et 8 tools métier.
- `.venv/bin/python -m pytest services/agent-worker/tests` / `npm run worker:test` : 54 tests
- Supabase interne : migrations feedback/outcome et RLS appliquées ; advisor sécurité à 0 lint.

## Décision

Ne pas approuver comme V1 prête. La branche est acceptable comme étape de correction P0/P1, mais doit encore prouver le cron GitHub Actions avec secrets, les volumes PRD en runs persistés Supabase et la feedback loop sur données Supabase réelles.
