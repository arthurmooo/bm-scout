# Audit de couverture PRD - BM Scout

Source : `PRD_BM_Scout_v1.docx`, version 1.0 du 30 mai 2026.

Verdict courant : `production_not_ready`.

## Couverture actuelle

| Exigence PRD | Etat | Preuve |
| --- | --- | --- |
| Console interne orientée décision Romu | Partiel | `src/ui/ScoutDashboard.tsx`, build OK |
| Séparation Core / Exploration | Partiel | `ScoutMode`, fixtures, workflows locaux |
| Proactivité réelle | Partiel | `scout_agent_tasks`, scheduler local, pas de cron branché |
| 15 leads Core / semaine | Non prouvé | Objectif paramétré, pas de run réel à volume |
| 100 comptes Exploration scannés | Non prouvé | Objectif paramétré, pas de run réel à volume |
| Vraie recherche marché | Non conforme | Worker réel encore alimenté par batch structuré |
| Fiches courtes/profondes | Partiel | Modèle et fixtures, pas encore toutes issues providers réels |
| Observé / Inféré / Incertain | Partiel | Types TS + QC Observé/evidence, worker et DB à compléter |
| Messages personnalisés | Partiel | QC fixture, pas de preuve provider réel à volume |
| Aucun envoi automatique | Couvert | Pas d'endpoint d'envoi ; actions de copie seulement |
| Do-not-contact hard gate | Couvert en socle | QC TS, worker offline, trigger DB, action DNC |
| Feedback loop influente | Non prouvé | Feedback stocké/lu, effet scoring run suivant à implémenter |
| Actions UI fonctionnelles | Partiel | API actions + traces, smoke Browser restant |
| Run steps/tool calls auditables | Partiel | Table existante, persistance fine worker à compléter |
| Supabase mémoire | Partiel | Schéma/RPC/actions, env runtime non vérifiée ici |
| Documentation honnête | Couvert dans cette passe | README + docs en `production_not_ready` |

## P0 corrigés partiellement

- P0.1 Proactivité : table tasks, statuts, types de tâches, scheduler local et lancement manuel posés.
- P0.4 Do-not-contact : gate déterministe ajouté côté TS, worker offline et DB.
- P0.6 Actions UI : actions principales branchées à une API serveur et tracées.
- P0.7 Observé/Inféré/Incertain : structure TS et gate Observé/evidence ajoutés.

## P0 encore ouverts

- P0.2 Workflows Core/Exploration réels : les volumes PRD ne sont pas prouvés.
- P0.3 Suppression de la dépendance fixtures : providers réels à brancher dans le worker.
- P0.5 Feedback loop réelle : impact sur scoring/recommandations du run suivant à prouver.
- P0.7 : porter la structure Observé/Inféré/Incertain dans le worker Pydantic et la DB.

## Décision

BM Scout ne doit pas être marqué `ready_v1_internal`.

Statut acceptable après cette passe : `production_not_ready`, avec socle plus proche d'un pilote interne mais encore insuffisant pour déclarer la V1 opérationnelle.
