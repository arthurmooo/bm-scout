# Audit de couverture PRD - BM Scout

Source : `PRD_BM_Scout_v1.docx`, version 1.0 du 30 mai 2026.

Verdict courant : `production_not_ready`.

## Couverture actuelle

| Exigence PRD | Etat | Preuve |
| --- | --- | --- |
| Console interne orientée décision Romu | Partiel | `src/ui/ScoutDashboard.tsx`, build OK |
| Séparation Core / Exploration | Partiel | `ScoutMode`, fixtures, workflows locaux |
| Proactivité réelle | Partiel | `scout_agent_tasks` appliqué Supabase, scheduler local idempotent des 6 routines P0, index DB anti-doublon actif, runner queue Core/Exploration + routines brief/learning/DNC/followup déterministes, cron GitHub Actions avec artefact de preuve, mais non encore exécuté avec secrets |
| 15 leads Core / semaine | Partiel | Provider OpenAI web prouve 15 candidats scannés en smoke ; les payloads agent_tasks sont transmis au worker, mais pas encore un run hebdo Supabase persisté |
| 100 comptes Exploration scannés | Partiel | Provider OpenAI web prouve 100 comptes scannés en smoke ; les payloads agent_tasks sont transmis au worker, mais pas encore un run hebdo Supabase persisté |
| Vraie recherche marché | Partiel | Provider SerpAPI + OpenAI `web_search` + fallback web public + job search minimal + tools métier ; OpenAI web prouvé à volume en smoke provider |
| Fiches courtes/profondes | Partiel | Modèle et fixtures, pas encore toutes issues providers réels |
| Observé / Inféré / Incertain | Couvert en socle | Types TS, worker Pydantic, QC Observé/evidence, colonne `structured_insights` Supabase |
| Messages personnalisés | Partiel | QC fixture, pas de preuve provider réel à volume |
| Aucun envoi automatique | Couvert | Pas d'endpoint d'envoi ; actions de copie seulement |
| Do-not-contact hard gate | Couvert en socle | QC TS, worker offline, chargement direct `scout_do_not_contact` côté worker, trigger DB, action DNC, blocage outcome négatif |
| Feedback loop influente | Partiel | Effet scoring/message/blocage/angle prouvé par tests locaux TS + worker provider, outcomes neutres non bloquants et compteurs `feedback_memory_effects` ; scénario `feedback:evidence` reproductible pour Supabase avec Learning 3-5 apprentissages ; pas encore exécuté avec secrets ni prouvé sur run marché à volume |
| Actions UI fonctionnelles | Partiel | API actions + traces message_id/canal + feedback/outcomes + raisons Romu en 1 clic + centre à valider + décisions avancées + 6 routines P0 lançables, smoke Playwright/Browser repassés ; persistance réelle dépend encore de l'env Supabase |
| Run steps/tool calls auditables | Partiel | RPC écrit run start/lead saved/worker steps ; provider + function tools Agents SDK poussent des étapes compactées ; scripts `worker:real:*` produisent les artefacts readiness |
| Supabase mémoire | Partiel | Schéma/RPC/actions, env runtime non vérifiée ici |
| Déduplication robuste | Partiel | Provider renforcé avec clés domaine, domaine enregistrable, identité légale+pays/ville, LinkedIn et identifiant public ; RPC Supabase fusionne désormais par `external_id` ou domaine et priorise Core ; rétro-merge historique complet encore non traité |
| Email confidence | Couvert en socle | Worker + DB + UI distinguent nominatif public, générique, pattern probable et inconnu ; seuls les emails publics nominatifs sourcés passent `usable`, les autres restent `verify/not_usable` |
| RLS / sécurité interne | Partiel | Policies Supabase restreintes par `app_metadata`, service role serveur, advisor sécurité à 0 lint ; Auth SSR UI/API branchée, claims réels Romu/Arthur encore à poser et vérifier dans Supabase |
| Documentation honnête | Couvert dans cette passe | README + docs en `production_not_ready`, gate provider corrigé pour empêcher un smoke Core seul de prouver les volumes PRD |

## P0 corrigés partiellement

- P0.1 Proactivité : table tasks, statuts, types de tâches, scheduler local idempotent couvrant les 6 routines P0, index DB anti-doublon actif, lancement manuel, runner de queue, routines brief/learning/DNC/followup et workflow cron GitHub Actions avec artefact auditable posés.
- P0.2/P0.3 Preuve runs réels : harnais `worker:real:*` ajouté pour produire les artefacts `latest-real-*.json` sans passer par fixtures.
- P0.2 Volumes : les objectifs `coreWeeklyTarget`, `explorationScanTarget` et `explorationShortlistTarget` sont propagés au worker ; `quality:readiness` bloque un artefact réel qui ne prouve pas Core >= 15 scannés et Exploration >= 100 scannés.
- P0.4 Do-not-contact : gate déterministe ajouté côté TS, worker offline et DB.
- P0.5 Feedback loop : mémoire locale causale ajoutée côté TS et worker provider pour rejet, pénalité secteur, bonus angle, anti-générique et DNC ; le worker lit maintenant feedbacks, outcomes et DNC Supabase, agrège les impacts feedback dans les run steps, et un script `feedback:evidence` seed la mémoire avant run persisté puis exige une synthèse Learning exploitable.
- P0.6 Actions UI : actions principales, décisions avancées, feedbacks Romu, outcomes, copie, DNC, QC et routines branchées à une API serveur et tracées.
- P0.7 Observé/Inféré/Incertain : contrat TS + worker Pydantic + DB/RPC ajoutés.
- P1.6 RLS/sécurité : policies `authenticated` resserrées, fonctions RPC security definer non publiques, advisors sécurité repassés à 0 lint.
- P1.6 Auth interne : page login, callback/logout, proxy cookie Supabase et garde API ajoutés ; les décisions d'accès ignorent `user_metadata`.

## P0 encore ouverts

- P0.1 : cron GitHub Actions non encore exécuté avec secrets ; transitions production à tester.
- P0.2 Workflows Core/Exploration réels : les volumes PRD sont prouvés côté provider OpenAI web, mais pas encore comme runs persistés Supabase.
- P0.3 Suppression de la dépendance fixtures : provider SerpAPI/OpenAI web/fallback public branché, search autonome à volume prouvé côté OpenAI web.
- P0.5 Feedback loop réelle : impact causal prouvé localement dans TS et le worker Python, avec garde-fou readiness sur `feedback_memory_effects` et script Supabase prêt ; à exécuter avec secrets puis à confirmer sur runs marché à volume.
- P0.7 : socle full-stack ajouté, à valider sur runs réels persistés.
- P1.6 : parcours magic link à vérifier avec les vrais comptes Supabase et leurs `app_metadata`.

## Décision

BM Scout ne doit pas être marqué `ready_v1_internal`.

Statut acceptable après cette passe : `production_not_ready`, avec socle plus proche d'un pilote interne mais encore insuffisant pour déclarer la V1 opérationnelle.
