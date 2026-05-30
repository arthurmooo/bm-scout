# Audit de couverture PRD - BM Scout

Source : `PRD_BM_Scout_v1.docx`, version 1.0 du 30 mai 2026.

Verdict courant : `production_not_ready`.

## Couverture actuelle

| Exigence PRD | Etat | Preuve |
| --- | --- | --- |
| Console interne orientée décision Romu | Partiel | `src/ui/ScoutDashboard.tsx`, build OK |
| Séparation Core / Exploration | Partiel | `ScoutMode`, fixtures, workflows locaux |
| Proactivité réelle | Partiel | `scout_agent_tasks` appliqué Supabase, scheduler local, runner queue, cron GitHub Actions versionné mais non prouvé |
| 15 leads Core / semaine | Non prouvé | Objectif paramétré, pas de run réel à volume |
| 100 comptes Exploration scannés | Non prouvé | Objectif paramétré, pas de run réel à volume |
| Vraie recherche marché | Partiel | Provider OpenAI `web_search` + fallback web public + job search minimal + tools métier, pas encore prouvé à volume |
| Fiches courtes/profondes | Partiel | Modèle et fixtures, pas encore toutes issues providers réels |
| Observé / Inféré / Incertain | Couvert en socle | Types TS, worker Pydantic, QC Observé/evidence, colonne `structured_insights` Supabase |
| Messages personnalisés | Partiel | QC fixture, pas de preuve provider réel à volume |
| Aucun envoi automatique | Couvert | Pas d'endpoint d'envoi ; actions de copie seulement |
| Do-not-contact hard gate | Couvert en socle | QC TS, worker offline, trigger DB, action DNC |
| Feedback loop influente | Partiel | Effet scoring/message prouvé par tests locaux, pas encore par run réel Supabase à volume |
| Actions UI fonctionnelles | Partiel | API actions + traces, centre à valider, smoke Browser à relancer après cette passe |
| Run steps/tool calls auditables | Partiel | RPC écrit run start/lead saved/worker steps ; provider + function tools Agents SDK poussent des étapes compactées |
| Supabase mémoire | Partiel | Schéma/RPC/actions, env runtime non vérifiée ici |
| Documentation honnête | Couvert dans cette passe | README + docs en `production_not_ready` |

## P0 corrigés partiellement

- P0.1 Proactivité : table tasks, statuts, types de tâches, scheduler local, lancement manuel, runner de queue et workflow cron GitHub Actions posés.
- P0.4 Do-not-contact : gate déterministe ajouté côté TS, worker offline et DB.
- P0.5 Feedback loop : mémoire locale causale ajoutée pour rejet, pénalité secteur, bonus angle et anti-générique.
- P0.6 Actions UI : actions principales branchées à une API serveur et tracées.
- P0.7 Observé/Inféré/Incertain : contrat TS + worker Pydantic + DB/RPC ajoutés.

## P0 encore ouverts

- P0.1 : cron GitHub Actions non encore exécuté avec secrets ; transitions production à tester.
- P0.2 Workflows Core/Exploration réels : les volumes PRD ne sont pas prouvés.
- P0.3 Suppression de la dépendance fixtures : provider OpenAI web/fallback public branché, search autonome à volume restant à prouver.
- P0.5 Feedback loop réelle : impact causal prouvé localement, à prouver avec feedbacks/outcomes Supabase réels.
- P0.7 : socle full-stack ajouté, à valider sur runs réels persistés.

## Décision

BM Scout ne doit pas être marqué `ready_v1_internal`.

Statut acceptable après cette passe : `production_not_ready`, avec socle plus proche d'un pilote interne mais encore insuffisant pour déclarer la V1 opérationnelle.
