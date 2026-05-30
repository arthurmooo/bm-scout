# Audit thermo-nuclear final - BM Scout V1

Date : 2026-05-30

Verdict : pret V1 interne.

Cet audit a ete repasse apres les preuves runtime finales : console Supabase serveur, CLI `--persist`, runs reels OpenAI Agents SDK post-feedback Supabase, et gate `quality:readiness`.

## Findings corriges

### Persistance Supabase worker atomique

Fichiers :

- `supabase/migrations/20260530150744_bm_scout_atomic_persist_and_feedback_memory.sql`
- `services/agent-worker/bm_scout_worker/memory.py`

Avant, le worker pouvait laisser un run partiel si une ecriture enfant echouait. Maintenant, `SupabaseMemory.persist_output()` appelle `rpc/scout_persist_mission_output`, qui persiste run, companies, contacts, preuves, scores, fiches, messages, QC et lessons dans une transaction.

Preuves :

- test `test_supabase_memory_persists_output_through_atomic_rpc` ;
- smoke SQL `rpc-smoke-atomic-20260530` ;
- CLI `--persist` : trace `trace_bm_scout_core_offline` en `succeeded`.

### Boucle feedback Supabase -> Agents SDK prouvee

Fichiers :

- `services/agent-worker/bm_scout_worker/memory.py`
- `services/agent-worker/bm_scout_worker/runner.py`

Le worker charge `scout_feedback` et `scout_outcomes` quand `NEXT_PUBLIC_SUPABASE_URL` ou `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` existent, puis injecte ces events dans le prompt Agents SDK.

Preuves :

- Supabase : 7 feedbacks Romu, 2 outcomes ;
- Core reel persiste : `qc-candidates-json-romu-seed`, Eight bloque do-not-contact, 5 lessons ;
- Exploration reelle persiste : `qc-exploration-candidates-user-provided`, compte faible bloque, 5 lessons.

### Readiness gate rendu factuel

Fichiers :

- `scripts/run-quality-runs.ts`
- `scripts/verify-supabase-runtime.ts`

Le gate ne se contente plus des fixtures. Il verifie :

- artefacts Core/Exploration reels pass ;
- artefacts reels avec Supabase persist ;
- lessons 3 a 5 avec feedback Romu et do-not-contact ;
- CLI `--persist` ;
- traces visibles par la console Supabase serveur.

Preuve :

- `npm run quality:readiness` passe avec env serveur.

### Console Romu verifiee avec Supabase serveur

Fichiers :

- `src/server/scout-repository.ts`
- `src/ui/ScoutDashboard.tsx`

Preuves :

- `npm run verify:supabase` : Cambon prioritaire, 3 runs, 4 leads, 2 rejets, 4 lessons ;
- Navigateur sur `http://localhost:3021` avec env Supabase serveur : Cambon, Dalloz, Learning et actions Romu visibles ;
- aucun warning/error console dans le navigateur ;
- captures : `artifacts/browser-smoke/supabase-playwright-desktop.png`, `artifacts/browser-smoke/supabase-playwright-mobile.png`.

### Packaging worker durci

Fichier :

- `services/agent-worker/pyproject.toml`

Le packaging declare explicitement `packages = ["bm_scout_worker"]`. Cela evite que des dossiers d'artefacts generes dans `services/agent-worker` cassent `pip install -e`.

Preuve :

- `npm run worker:install` passe apres generation d'artefacts.

## Challenge thermo-nuclear

- Plus petit delta : les corrections sont concentrees dans le worker, le gate qualite et la doc. Pas de refonte UI ou schema inutile.
- Simpler design : la RPC atomique supprime la sequence REST fragile au lieu d'ajouter des retries.
- Abstraction inutile : `SupabaseMemory` garde une frontiere utile et testable ; pas de couche repository Python supplementaire.
- Branch/spaghetti growth : `quality:readiness` ajoute des preuves explicites, mais garde les helpers localises dans un script de verification.
- Boundary leak : la service role reste cote serveur/worker ; aucune exposition client.
- Hidden bug : le recoupement des traces entre artefacts et console Supabase evite un faux ready base uniquement sur fichiers locaux.

## Findings restants

Aucun P1 bloquant pour la V1 interne.

Risques non bloquants :

- `scripts/run-quality-runs.ts` approche 450 lignes. Il reste sous le seuil critique et regroupe un harnais unique ; si le gate grossit encore, extraire `runtime-evidence.ts`.
- Les preuves de volume 15 Core / 100 Exploration ne sont pas encore des runs production continus.
- Le sourcing web/email gratuit reste semi-structure.
- La qualite commerciale finale reste une responsabilite Romu avant envoi.

## Decision

BM Scout V1 peut etre marque `ready` pour usage interne pilote.

La decision ne couvre pas une industrialisation outbound autonome ni un volume production sans monitoring.
