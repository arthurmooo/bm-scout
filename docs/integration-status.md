# BM Scout V1 - Etat d'integration

Date : 2026-05-30

## Verdict PM actuel

BM Scout V1 n'est pas pret.

Le socle demo est executable, Supabase est initialise, et des runs OpenAI Agents SDK reels Core + Exploration ont ete executes. Le produit reste toutefois pas pret tant que la console lue via Supabase, la persistance CLI directe et le run reel Learning avec memoire Supabase ne sont pas prouves.

- runs E2E encore partiellement bases sur fixtures locales pour Feedback/Learning ;
- boucle feedback Supabase -> Learning Agent codee, pas encore validee en run reel avec env serveur locale ;
- persistance worker deplacee vers RPC atomique, mais CLI `--persist` pas encore executee avec service role key locale ;
- audit thermo-nuclear final repasse, blockers code majeurs corriges, preuves runtime serveur ouvertes ;
- repo GitHub dedie publie, mise a jour a pousser apres les changements de cette tranche.

## Sous-threads

Complete :

- Architecture produit & technique ;
- Supabase memoire / schema / RLS ;
- Worker agentique OpenAI Agents SDK ;
- Console Romu epuree ;
- Conformite prospection / opt-out / do-not-contact ;
- Runs E2E qualite agentique ;
- Audit thermo-nuclear baseline.

Restent a corriger apres integration :

- preuves runtime serveur restantes ;
- validation E2E reelle SDK + Supabase + console ;
- decision finale pret / pas pret.

## Decisions integrees

- Ancien cockpit scrappe, nouveau socle reduit dans `bm-commercial-cockpit`.
- Console centree sur prochaine action Romu, file courte, preuves/QC, learning.
- Quality report local declare maintenant `Decision produit BM Scout V1 : pas pret`.
- Worker Python separe dans `services/agent-worker`.
- Worker structure autour de Pydantic, agents-as-tools, handoff QC, `Runner.run` et `trace` dans le chemin reel.
- Migration Supabase V1 appliquee au projet interne avec tables `scout_*`, RLS et fonction do-not-contact.
- Repo GitHub dedie cree : `https://github.com/arthurmooo/bm-scout`.
- Run reel OpenAI Agents SDK execute : `qual-core-cambon-eight-001`.
- Run Exploration reel OpenAI Agents SDK execute : `mission-json-candidates-provided-qc`.
- Faux pass corrige : le guardrail Python bloque maintenant tout lead `blocked` encore present en shortlist.
- Feedbacks Romu simules persistés dans Supabase : good lead, bad lead, message generique, bon angle, outcome positif, outcome negatif, do-not-contact.
- Fallback console durci : une erreur Supabase configuree remonte au lieu de repasser silencieusement en demo.
- Persistance worker remplacee par la RPC transactionnelle `scout_persist_mission_output`.
- Worker reel branche sur `scout_feedback` et `scout_outcomes` quand l'env Supabase serveur existe.
- `quality:readiness` separe du harnais fixture et echoue tant que le produit reste `not_ready`.

## Deja implemente

- App Next.js locale ;
- types/domain TS ;
- QC TS et tests unitaires ;
- script `quality:runs` ;
- rapport `artifacts/quality-runs/latest-report.md` ;
- migration locale `supabase/migrations/20260530161000_bm_scout_v1.sql` ;
- migration locale `supabase/migrations/20260530150744_bm_scout_atomic_persist_and_feedback_memory.sql` ;
- migration appliquee au projet Supabase `Interne_Agentic_prospection` ;
- run Core de verification persiste dans Supabase ;
- run Core reel Agents SDK persiste dans Supabase ;
- feedbacks/outcomes Romu simules persistés dans Supabase ;
- worker Python installable ;
- CLI offline worker ;
- tests worker offline.

## Encore fixture / demo

- `src/server/scout-repository.ts` retourne `demoSnapshot()` quand l'env serveur Supabase manque ou que la requete echoue ;
- `quality:runs` consomme les fixtures TS ;
- worker offline consomme les fixtures Python ;
- Supabase est lisible par `src/server/scout-repository.ts` si `SUPABASE_SERVICE_ROLE_KEY` est disponible côté serveur, sinon fallback demo ;
- la console n'a pas encore ete verifiee avec lecture Supabase serveur ;
- la boucle feedback Supabase -> Learning Agent est codee, mais le dernier run reel OpenAI a ete execute avant ce branchement ;
- la persistance Supabase worker n'a pas encore ete executee directement via `--persist` avec service role depuis la CLI ; la RPC a ete smoke-testee via Supabase.

## Verifications actuelles

Valide :

- `npm run quality:runs` : socle fixture OK, produit pas pret ;
- `npm run worker:install` : OK ;
- `npm run worker:test` : 7 tests offline/memory OK ;
- `npm run worker:offline` : CLI offline OK ;
- import Agents SDK : manager cree avec 4 tools et 1 handoff QC.
- Supabase : 13 tables `scout_*`, RLS activee partout ;
- Supabase : RPC `scout_persist_mission_output(jsonb)` appliquee ;
- Supabase : smoke RPC `rpc-smoke-atomic-20260530` -> 1 run succeeded, 1 company, 1 preuve, 3 messages, 1 QC, 1 lesson ;
- Supabase : runs et donnees Core/Exploration/feedbacks persistés ;
- Supabase : 7 feedbacks Romu simules et 2 outcomes persistés ;
- Supabase : `scout_is_do_not_contact('blocked@example.com')` retourne `true` après commit.
- OpenAI Agents SDK reel : `Runner.run` a produit un output pass apres correction du guardrail.
- Artefact reel : `artifacts/agent-worker-real/latest-real-core.json`.
- Artefact reel : `artifacts/agent-worker-real/latest-real-exploration.json`.
- Supabase reel : trace `qual-core-cambon-eight-001`, Cambon `pass`, Eight `blocked`, DNC company `true`.

A relancer avant livraison :

- `npm run typecheck` ;
- `npm run test` ;
- `npm run lint` ;
- `npm run build` ;
- `npm run quality:readiness` doit echouer tant que la V1 reste `not_ready` ;
- smoke browser desktop/mobile ;
- worker `--persist` avec Supabase depuis la CLI quand `SUPABASE_SERVICE_ROLE_KEY` est disponible ;
- console Next.js lue réellement via Supabase avec variable serveur ;
- audit thermo-nuclear final : `docs/thermo-nuclear-final-audit.md`.

## GitHub

Repo cree :

- `bm-scout` : `https://github.com/arthurmooo/bm-scout`

Remote local ajoute :

- `bm-scout` -> `https://github.com/arthurmooo/bm-scout.git`

Decision : ne pas push le worktree parent tel quel. Il contient encore les suppressions massives de l'ancien cockpit, des artefacts locaux, et des changements hors BM Scout.

Publication propre effectuee :

1. `bm-commercial-cockpit` isole comme contenu du repo dedie ;
2. `.next`, `.venv`, `node_modules`, `.env`, artefacts et metadata Python generées exclus ;
3. branche `main` poussee ;
4. repo garde prive tant que le worker et Supabase ne sont pas finalises.

Dernier etat publie sur la branche `main` du repo dedie.

## Prochaine tranche

1. Tester la console branchée Supabase avec env serveur.
2. Executer `--persist` depuis la CLI si une service role key est disponible localement.
3. Relancer un run reel Agents SDK avec feedbacks/outcomes Supabase injectés.
4. Repasser l'audit final apres preuves runtime serveur.
5. Mettre a jour le repo dedie apres correction des blockers.
