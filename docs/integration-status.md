# BM Scout - Etat d'intégration

Date : 2026-05-30

## Verdict PM actuel

Statut : `production_not_ready`.

Le repo n'est plus présenté comme V1 prête. La passe actuelle transforme la démo en socle plus pilotable : tâches proactives, traces d'actions, DNC hard gate et dashboard moins fictif. Ce n'est pas encore un employé IA complet : les providers de recherche réelle, les volumes PRD et le cron production restent à prouver.

## Décisions reprises de l'audit

- Ne plus assimiler fixtures et readiness produit.
- Introduire `scout_agent_tasks` pour représenter le travail proactif attendu.
- Tracer les actions Romu dans `scout_action_events`.
- Remplacer la routine UI codée en dur par un brief construit depuis runs/tasks.
- Mettre `quality:readiness` en échec tant que les preuves runtime réelles manquent.
- Bloquer le DNC avant copie/message, pas seulement dans une table décorative.

## Implémenté dans cette passe

- Module scheduler TS : `src/domain/scheduler.ts`.
- Tests scheduler avec routines Core, Exploration, Daily Brief, Learning, DNC, followup.
- Migration Supabase `20260530210927_agent_tasks_and_actions.sql`.
- API `POST /api/scout/actions`.
- Actions UI : valider, enrichir, rejeter, copier email/relance/LinkedIn, DNC, lancer routines.
- Trigger DB `scout_prevent_dnc_message` pour empêcher un message non bloqué sur une cible DNC.
- QC TS : DNC déterministe et Observé relié à une preuve.
- Worker offline : DNC interdit en shortlist.
- Documentation et rapport qualité repassés en statut honnête.

## Encore fixture/demo

- `quality:runs` reste un harnais fixture.
- `demoSnapshot()` reste le fallback sans env Supabase serveur.
- Le worker réel consomme encore un batch `Candidates JSON` plutôt qu'une vraie recherche marché autonome.
- Les providers `search_web`, `fetch_company_site`, `search_jobs`, `find_public_emails`, `dedupe_company` ne sont pas encore le chemin réel principal.
- Les volumes 15 Core / 100 Exploration sont paramétrés mais non prouvés en run réel.

## Réellement end-to-end aujourd'hui

- Scheduler dry-run reproductible : `npm run agent:schedule`.
- Actions API persistantes si `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` existent.
- DNC bloque côté TS, worker offline et trigger Supabase.
- Console Next buildée avec route d'action dynamique.

## Vérifications exécutées

- `npm run test` : 12 tests pass.
- `npm run typecheck` : pass.
- `npm run lint` : pass.
- `npm run build` : pass.
- `npm run quality:runs` : pass fixture, décision produit `production_not_ready`.
- `npm run quality:readiness` : fail attendu, décision produit `production_not_ready`.
- `.venv/bin/python -m pytest services/agent-worker/tests` : 8 tests pass.
- `npm run agent:schedule` : pass, 6 routines planifiées.
- Browser local : DOM smoke via Browser OK sur `http://127.0.0.1:3030`; screenshot locale `artifacts/browser-smoke/playwright-dashboard.png`.

## Prochaine tranche P0

1. Brancher un vrai runner scheduler qui consomme `scout_agent_tasks`.
2. Remplacer le batch structuré du worker par des providers réels gratuits/mockables.
3. Persister les run steps/tool calls du worker au fil de l'exécution.
4. Prouver la feedback loop sur scoring et recommandations du run suivant.
5. Tester les actions UI contre une Supabase réelle après application de la migration.
