# Audit thermo-nuclear final - BM Scout V1

Date : 2026-05-30

Verdict : pas pret.

Cet audit a ete repasse apres integration du worker Agents SDK, de Supabase, des runs reels Core/Exploration, des feedbacks Romu persistés, du durcissement du fallback console, de la RPC de persistance atomique et du gate `quality:readiness`.

## Findings corriges depuis le dernier audit

### Persistance Supabase worker rendue atomique

Fichiers :

- `supabase/migrations/20260530145828_bm_scout_atomic_persist_and_feedback_memory.sql`
- `services/agent-worker/bm_scout_worker/memory.py`

Avant :

`SupabaseMemory.persist_output()` inserait `scout_runs` en `succeeded`, puis chaque enfant via des appels REST sequentiels. Un echec intermediaire pouvait laisser un run partiel lisible par Romu.

Apres :

Le worker appelle `rpc/scout_persist_mission_output`. La fonction Postgres insere le run en `running`, persiste companies, contacts, preuves, scores, fiches, messages, QC et lessons dans une seule transaction, puis passe le run en `succeeded` a la fin. Si la fonction echoue, la transaction est rollback.

Preuves :

- tests worker : `test_supabase_memory_persists_output_through_atomic_rpc` ;
- Supabase : RPC appliquee sur le projet interne ;
- Supabase : smoke `rpc-smoke-atomic-20260530` a produit 1 run `succeeded`, 1 company, 1 preuve, 3 messages, 1 rapport QC, 1 lesson.

### Boucle feedback Supabase -> worker branchee

Fichiers :

- `services/agent-worker/bm_scout_worker/memory.py`
- `services/agent-worker/bm_scout_worker/runner.py`
- `services/agent-worker/tests/test_worker_offline.py`

Avant :

Le run reel Agents SDK construisait le prompt avec `seed_feedbacks()` meme quand Supabase contenait des feedbacks Romu et outcomes.

Apres :

Quand `SUPABASE_URL` ou `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` existent, le worker charge `scout_feedback` et `scout_outcomes`, transforme les outcomes en feedback events, puis injecte cette memoire dans le prompt Agents SDK. Sans env serveur, le seed local reste le fallback de developpement.

Preuves :

- tests worker : `test_supabase_memory_loads_feedback_and_outcomes` ;
- Supabase : 7 feedbacks Romu et 2 outcomes persistés ;
- code : `_run_with_agents_sdk(..., feedbacks=feedbacks)` ne lit plus directement `seed_feedbacks()`.

### Gate readiness separe du harnais fixture

Fichiers :

- `package.json`
- `scripts/run-quality-runs.ts`

Avant :

`quality:runs` sortait un exit code 0 si les fixtures etaient bonnes, meme avec `productReadiness = not_ready`.

Apres :

`quality:runs` reste le harnais fixture. `quality:readiness` active `--readiness` et echoue tant que `productReadiness !== "ready"`. Le JSON indique aussi `readinessMode`.

## Findings restants

### P1 - Console Supabase non verifiee en runtime serveur

Fichiers :

- `src/server/scout-repository.ts`
- `app/page.tsx`

Le code de lecture Supabase est en place et le fallback silencieux a ete supprime pour les erreurs de requete. Il manque encore une execution Next avec `SUPABASE_SERVICE_ROLE_KEY` locale pour prouver que la console Romu lit vraiment les runs Supabase au lieu de `demoSnapshot()`.

### P1 - CLI `--persist` non executee avec service role locale

Fichiers :

- `services/agent-worker/bm_scout_worker/cli.py`
- `services/agent-worker/bm_scout_worker/runner.py`
- `services/agent-worker/bm_scout_worker/memory.py`

Le chemin code est corrige et teste par mock. La RPC est appliquee et smoke-testee via Supabase. Il manque encore l'execution CLI directe avec `--persist` dans l'environnement local serveur, car aucune `SUPABASE_SERVICE_ROLE_KEY` n'est disponible dans l'environnement actuel.

### P1 - Learning Supabase -> Agents SDK non valide en run reel avec env serveur locale

Le worker lit maintenant Supabase si l'env existe, mais le dernier run reel OpenAI Agents SDK a ete execute avant ce changement. Il faut relancer un run reel avec env Supabase serveur locale pour prouver que les feedbacks persistés changent effectivement les recommandations du Learning Agent.

## Hypotheses challengees

- Plus petit delta : les corrections restent concentrees sur RPC, memory worker, runner et quality script.
- Abstraction inutile : la RPC remplace une orchestration REST fragile par une frontiere claire `persist mission output`.
- Spaghetti : le worker a moins de logique de persistance detaillee qu'avant ; le detail est dans la couche DB.
- Boundary leak : la memoire Supabase est maintenant lue par le worker quand l'env serveur existe.
- Bug maintenabilite : le risque de run partiel `succeeded` est traite par transaction.

## Decision

BM Scout V1 reste `not_ready`.

Les blockers code majeurs de l'audit precedent sont corriges, mais les preuves runtime serveur manquent encore : console branchée Supabase, CLI `--persist` avec service role locale, et run reel Learning alimente par feedbacks Supabase.
