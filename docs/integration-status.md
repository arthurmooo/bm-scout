# BM Scout V1 - Etat d'integration

Date : 2026-05-30

## Verdict PM actuel

BM Scout V1 est pret pour une V1 interne pilotee par Romu.

La readiness ne signifie pas prospection autonome ni industrialisation de volume. Elle signifie que le scope PRD V1 est executable et verifie : console Romu, memoire Supabase, worker OpenAI Agents SDK, runs Core/Exploration, feedback learning, do-not-contact, QC negatif, rapport qualite et documentation de lancement.

Preuves runtime ajoutees le 30 mai 2026 :

- `npm run verify:supabase` passe avec env serveur et lit Supabase ;
- CLI `--persist` executee avec service role via RPC atomique ;
- run reel Agents SDK Core + Supabase persist : `qc-candidates-json-romu-seed` ;
- run reel Agents SDK Exploration + Supabase persist : `qc-exploration-candidates-user-provided` ;
- Learning Agent utilise les feedbacks/outcomes Supabase et bloque le do-not-contact ;
- `npm run quality:readiness` passe avec preuves runtime.

## Sous-threads

Complete :

- Architecture produit & technique ;
- Supabase memoire / schema / RLS ;
- Worker agentique OpenAI Agents SDK ;
- Console Romu epuree ;
- Conformite prospection / opt-out / do-not-contact ;
- Runs E2E qualite agentique ;
- Audit thermo-nuclear baseline.

Restent hors scope V1 :

- volume hebdo production 15 Core / scan 100 Exploration a monitorer en usage reel ;
- recherche web/email gratuite a industrialiser ;
- monitoring couts/tokens/outils a enrichir ;
- validation humaine Romu obligatoire avant tout envoi.

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
- `quality:readiness` separe du harnais fixture et passe seulement si les preuves runtime existent.
- Documentation de livraison completee : runbook, scenario demo, limites V1, audit de couverture PRD.

## Deja implemente

- App Next.js locale ;
- types/domain TS ;
- QC TS et tests unitaires ;
- script `quality:runs` ;
- script `verify:supabase` pour prouver la lecture console avec env serveur ;
- rapport `artifacts/quality-runs/latest-report.md` ;
- docs `launch-runbook.md`, `demo-scenario.md`, `v1-limits.md`, `prd-completion-audit.md` ;
- migration locale `supabase/migrations/20260530161000_bm_scout_v1.sql` ;
- migration locale `supabase/migrations/20260530150744_bm_scout_atomic_persist_and_feedback_memory.sql` ;
- migration appliquee au projet Supabase `Interne_Agentic_prospection` ;
- run Core de verification persiste dans Supabase ;
- run Core reel Agents SDK persiste dans Supabase ;
- run Core reel Agents SDK post-feedback Supabase persiste dans Supabase ;
- run Exploration reel Agents SDK post-feedback Supabase persiste dans Supabase ;
- feedbacks/outcomes Romu simules persistés dans Supabase ;
- worker Python installable ;
- CLI offline worker ;
- tests worker offline.

## Encore fixture / demo

- `src/server/scout-repository.ts` retourne `demoSnapshot()` quand l'env serveur Supabase manque ou que la requete echoue ;
- `quality:runs` consomme les fixtures TS ;
- worker offline consomme les fixtures Python ;
- Supabase est lisible par `src/server/scout-repository.ts` si `SUPABASE_SERVICE_ROLE_KEY` est disponible côté serveur, sinon fallback demo ;
- les volumes production ne sont pas encore prouves sur 15 Core / 100 Exploration ;
- les recherches web gratuites et emails publics restent semi-structurees ;
- le fallback demo reste volontaire pour developpement local sans env serveur.

## Verifications actuelles

Valide :

- `npm run quality:runs` : socle fixture OK ;
- `npm run worker:install` : OK ;
- `npm run worker:test` : 7 tests offline/memory OK ;
- `npm run verify:supabase` : OK avec env serveur, Cambon prioritaire, 3 runs, 4 leads, 2 rejets, 4 lessons ;
- `npm run worker:offline` : CLI offline OK ;
- CLI `--offline --mode core --persist` : OK, trace `trace_bm_scout_core_offline` persistée ;
- import Agents SDK : manager cree avec 4 tools et 1 handoff QC.
- Navigateur : smoke local `http://localhost:3020` OK en mode demo fallback, desktop/mobile captures, actions primaires visibles, aucun warning/error console.
- Navigateur : smoke local `http://localhost:3021` OK avec Supabase serveur, Cambon/Dalloz/Learning/actions visibles, aucun warning/error console. Captures : `artifacts/browser-smoke/supabase-playwright-desktop.png`, `artifacts/browser-smoke/supabase-playwright-mobile.png`.
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
- OpenAI Agents SDK reel + Supabase feedback/persist : trace `qc-candidates-json-romu-seed`, Cambon retenu, Eight bloqué do-not-contact, 5 lessons.
- OpenAI Agents SDK reel + Exploration + Supabase persist : trace `qc-exploration-candidates-user-provided`, Dalloz retenu, Studio Yoga bloqué, 5 lessons.
- `npm run quality:readiness` : OK avec preuves runtime.

A relancer en routine avant demo :

- `npm run typecheck` ;
- `npm run test` ;
- `npm run lint` ;
- `npm run build` ;
- `npm run quality:readiness` avec env serveur ;
- smoke browser console branchee Supabase serveur ;
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

1. Repasser les tests complets.
2. Tester la console Navigateur branchée Supabase serveur.
3. Repasser l'audit thermo-nuclear final sans P1.
4. Mettre a jour le repo dedie apres validation finale.
