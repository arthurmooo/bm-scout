# Audit thermo-nuclear final - BM Scout V1

Date : 2026-05-30

Verdict : pas pret.

Cet audit a ete repasse apres integration du worker Agents SDK, de Supabase, des runs reels Core/Exploration, des feedbacks Romu persistés et du durcissement du fallback console.

## Findings bloquants

### P1 - Persistance Supabase worker non atomique

Fichiers :

- `services/agent-worker/bm_scout_worker/memory.py`

Probleme :

`SupabaseMemory.persist_output()` insere d'abord `scout_runs` en `succeeded`, puis insere chaque company, contact, preuve, score, fiche, message, QC et lesson via des appels REST sequentiels independants.

Si un insert enfant echoue au milieu du flux, Supabase peut contenir :

- un run marque `succeeded` ;
- une partie des leads ;
- des messages sans toutes les preuves ou tous les rapports QC ;
- des lessons absentes ou incompletes.

Ce n'est pas seulement une dette technique. Pour BM Scout, la memoire est le produit : Romu peut lire un run qui parait valide alors qu'il est partiel.

Correction attendue :

- remplacer le flux multi-REST par une RPC Postgres transactionnelle, ou
- creer le run en `running`, inserer les enfants, puis passer `succeeded` seulement a la fin, avec `failed` et `error_message` en cas d'erreur.

### P1 - Boucle feedback Supabase -> Learning Agent non branchee

Fichiers :

- `services/agent-worker/bm_scout_worker/runner.py`
- `services/agent-worker/bm_scout_worker/fixtures.py`
- `services/agent-worker/bm_scout_worker/memory.py`

Probleme :

Les feedbacks Romu sont maintenant persistés dans `scout_feedback`, et les outcomes dans `scout_outcomes`, mais le run reel Agents SDK construit encore son prompt a partir de `seed_feedbacks()`.

Le Learning Agent prend donc bien en compte des feedbacks, mais pas encore la memoire Supabase. Le systeme prouve une capacite de learning, pas encore une boucle produit persistante.

Correction attendue :

- ajouter une lecture serveur des derniers feedbacks/outcomes Supabase ;
- injecter ces feedbacks dans le prompt du worker ;
- verifier qu'une modification de feedback change effectivement les recommandations suivantes.

### P1 - Rapport qualite encore trop permissif pour la readiness

Fichiers :

- `scripts/run-quality-runs.ts`

Probleme :

Le script sort `fixtureVerdict: pass` et `Score socle fixture : 100/100`, puis ajoute des blockers produit. C'est honnete dans le texte, mais le signal automatisable reste ambigu : un CI pourrait interpreter le exit code 0 comme "produit pret".

Correction attendue :

- separer `quality:fixtures` et `quality:readiness` ;
- faire echouer `quality:readiness` tant que `productReadiness = not_ready` ;
- inclure les preuves Supabase/artefacts reels dans le JSON de readiness.

## Findings corriges pendant l'audit

### Fallback console silencieux durci

Fichiers :

- `app/page.tsx`
- `src/server/scout-repository.ts`

Avant :

La page capturait toute erreur de `getScoutSnapshot()` et repassait en demo. Une erreur Supabase pouvait donc masquer une console non branchee.

Apres :

Le fallback demo reste autorise uniquement si les variables serveur Supabase manquent ou si aucun run n'existe. Si Supabase est configuree et que la requete echoue, l'erreur remonte.

## Hypotheses challengees

- Plus petit delta : oui, le socle V1 est relativement petit et n'a pas de fichier > 300 lignes hors fixtures.
- Abstraction inutile : pas de couche framework excessive, mais `memory.py` cache un probleme d'atomicite derriere une API directe.
- Spaghetti : pas de croissance massive, mais le rapport qualite melange fixture, readiness et evidence reelle.
- Boundary leak : oui, le Learning Agent ne lit pas encore la memoire Supabase, donc la frontiere "Supabase = memoire" n'est pas complete.
- Bug maintenabilite : oui, un run partiellement persiste peut etre marque reussi.

## Decision

BM Scout V1 reste `not_ready`.

Les scripts et runs actuels prouvent :

- worker Agents SDK reel avec `Runner.run` et `trace` ;
- Core reel pass apres correction du faux pass ;
- Exploration reelle pass avec message direct bloque ;
- Supabase active, RLS activee, feedbacks/outcomes/DNC persistés ;
- console locale buildable.

Ils ne prouvent pas encore :

- persistance CLI atomique et reelle via `--persist` ;
- console lue via Supabase en environnement serveur ;
- boucle feedback Supabase -> Learning Agent ;
- readiness produit automatisable sans ambiguite.
