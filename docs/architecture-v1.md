# BM Scout V1 - Architecture et plan d'integration

Date : 2026-05-30

## Decision main thread

BM Scout V1 est une console interne premium pour Romu. Le produit ne doit pas redevenir l'ancien cockpit lourd, un CRM, un outil de sequence outbound, ni une table de leads enrichie.

La V1 livre un employe IA interne specialise acquisition :

- il prepare les decisions commerciales ;
- il separe strictement Core BM et Exploration ;
- il produit des sorties sourcees, structurees et auditables ;
- il bloque les sorties faibles, generiques ou non conformes ;
- il apprend des feedbacks Romu ;
- il ne realise aucune action externe automatique.

## Scope V1

Inclus :

- home Romu centree sur la prochaine meilleure action ;
- file courte de decisions, 3 a 4 items maximum ;
- Core BM hebdomadaire avec leads M&A / finance ops / deal prioritaires ;
- Exploration large mais filtree, avec shortlist et exclusions justifiees ;
- fiches courtes pour les leads retenus ;
- fiches profondes uniquement pour les meilleurs leads ou leads valides ;
- personas / roles cibles avec niveau de confiance ;
- email froid, relance et message LinkedIn manuel, uniquement si QC passe ;
- feedback Romu : bon lead, mauvais lead, message generique, bon angle, outcome, do-not-contact ;
- learning hebdo : 3 a 5 apprentissages exploitables ;
- Supabase comme memoire commerciale, audit, traces, opt-out et learning ;
- worker Python OpenAI Agents SDK avec orchestration code-first ;
- runs E2E qualitatifs obligatoires.

Hors-scope V1 :

- envoi email automatique ;
- automation LinkedIn ;
- CRM complet ;
- dashboard admin Arthur lourd ;
- integrations payantes obligatoires ;
- scraping agressif ;
- sequence outbound de masse ;
- volume Exploration non filtre.

## Architecture cible

```text
bm-commercial-cockpit/
  app/                         Console Next.js Romu
  src/domain/                  Types et politiques pures partageables
  src/server/                  Repositories Supabase et view models UI
  services/agent-worker/       Worker Python OpenAI Agents SDK
  supabase/migrations/         Schema V1, RLS, indexes
  scripts/                     Seeds et runs qualite
  docs/                        Decisions, runbooks, rapports
```

Flux cible :

```text
Routine ou action humaine
  -> Agent worker Python
  -> OpenAI Agents SDK Manager
  -> agents specialises comme tools
  -> Quality Control bloquant
  -> persistance Supabase
  -> view model Next.js
  -> decision Romu
```

## Frontieres de responsabilite

### UI Next.js

La console affiche des decisions preparees. Elle ne calcule pas les verdicts metier.

Responsabilites :

- afficher prochaine action, preuves, QC, learning ;
- declencher les actions humaines : valider, enrichir, rejeter, copier, marquer do-not-contact ;
- ouvrir fiche profonde / message / feedback ;
- ne jamais exposer `service_role` ;
- ne jamais envoyer automatiquement.

Interdits :

- recalculer scoring / QC ;
- afficher logs agent bruts a Romu ;
- transformer la home en tableau CRM ;
- introduire des metriques decoratives.

### Domaine TypeScript

Responsabilites :

- types partages ;
- constantes de modes, statuts, decisions ;
- helpers purs et testes ;
- view models stables pour l'UI.

Risque a surveiller : ne pas laisser les fixtures devenir l'architecture permanente.

### Worker Python Agents SDK

Responsabilites :

- lancer les routines Core, Exploration, Feedback/Learning, QC negatif ;
- orchestrer les agents specialises ;
- produire des Pydantic outputs ;
- appeler les tools internes controles ;
- persister les runs et artefacts ;
- fournir un fallback offline pour tests, sans masquer le chemin SDK produit.

### Supabase

Responsabilites :

- memoire commerciale ;
- preuves et sources ;
- briefs, scores, messages, feedbacks, outcomes ;
- opt-out / do-not-contact ;
- runs, steps, traces, quality reports ;
- RLS et audit.

## OpenAI Agents SDK

Decision : V1 en orchestration code-first avec Manager en controle.

Pattern retenu :

- `Manager` garde le controle du workflow ;
- agents specialises exposes principalement via `agent.as_tool(...)` ;
- handoff reserve au Quality Control quand une decision bloquante doit prendre le controle final ;
- `Runner.run(...)` et `trace(...)` obligatoires dans le chemin SDK ;
- outputs Pydantic stricts ;
- guardrails input, tool-boundary et output.

Agents V1 :

- Manager ;
- Core Research ;
- Exploration ;
- Evidence ;
- Qualification / Scoring ;
- Pain Hypothesis ;
- Contact Mapping ;
- Outreach ;
- Quality Control ;
- Learning.

Le worker peut commencer avec un noyau minimal : Manager, Core/Exploration, Outreach, Quality Control, Learning. Les autres specialistes peuvent etre ajoutes sans changer les contrats.

## Schema Supabase V1

Le projet cible `Interne_Agentic_prospection` (`urlggighkvdcyzsxxzcc`) est actif et vide cote `public` au moment du cadrage.

Tables V1 recommandees :

- `scout_companies`
- `scout_contacts`
- `scout_evidence`
- `scout_scores`
- `scout_briefs`
- `scout_messages`
- `scout_feedback`
- `scout_outcomes`
- `scout_do_not_contact`
- `scout_runs`
- `scout_run_steps`
- `scout_quality_reports`
- `scout_learning_lessons`

Regles :

- RLS activee sur toutes les tables `public` ;
- UI lit via utilisateur authentifie ou routes serveur ;
- ecriture worker via service role uniquement cote serveur/worker ;
- `do_not_contact` bloque toute relance et tout nouveau message ;
- `source_evidence` doit relier chaque fait utilise a une source ;
- les messages ne sont jamais envoyes depuis BM Scout V1.

## Conformite et reputation

Regles operationnelles :

- prospection B2B uniquement si lien avec la fonction professionnelle ;
- source et finalite tracees ;
- opposition simple dans chaque message ;
- liste repoussoir dediee au respect de l'opposition ;
- email personnel interdit ;
- scraping agressif, Google Maps extraction et LinkedIn automation interdits ;
- hypothese prudente obligatoire quand une douleur n'est pas observee ;
- aucun fait non source ne peut etre presente comme certitude.

Gates QC bloquants :

- pas de source publique ;
- source placeholder ou trop faible ;
- message generique ;
- promesse SaaS / IA generique ;
- opt-out ou do-not-contact ;
- contact incertain presente comme confirme ;
- Exploration qui genere un message direct ;
- score non justifie.

## Console Romu

Premier niveau maximum :

1. Prochaine meilleure action.
2. File courte.
3. Preuves / QC.
4. Learning hebdo.

Action principale :

- `Valider`
- `Enrichir`
- `Rejeter`
- `Copier`

Les fiches profondes restent en drawer ou page detail. La home ne doit pas afficher plus que ce qui aide Romu a decider vite.

## Runs E2E obligatoires

Les 4 runs a automatiser et juger qualitativement :

1. Core BM.
2. Exploration.
3. Feedback & Learning.
4. Anti-generique / QC negatif.

Critere de livraison : un JSON valide ne suffit pas. Les leads, messages, fiches et apprentissages doivent etre utiles, specifiques, sources, actionnables et coherents BM.

Hard blockers :

- output generique ;
- source absente ;
- opt-out ignore ;
- contact direct en Exploration ;
- message envoyable a 50 entreprises ;
- fait invente ;
- Romu ne sait pas quoi faire en moins de 30 secondes.

## Ordre d'integration

1. Corriger le scaffold pour etre executable : imports absents, scripts declares, structure cible.
2. Ajouter `src/server/scout-repository.ts` minimal avec fallback demo puis Supabase.
3. Creer migration Supabase V1 non destructive et l'appliquer au projet interne apres review.
4. Creer `services/agent-worker` avec contrats Pydantic et chemin offline teste.
5. Ajouter chemin SDK reel : Manager + agents-as-tools + QC handoff + tracing.
6. Brancher Next.js sur Supabase et endpoints de decisions humaines.
7. Ajouter actions feedback / do-not-contact.
8. Ajouter `scripts/run-quality-runs.ts` et rapport Markdown.
9. Lancer tests unitaires, typecheck, lint, build.
10. Lancer browser smoke desktop/mobile.
11. Lancer audit thermo-nuclear.
12. Lancer runs E2E qualitatifs et rapport pret / pas pret.

## Criteres bloquants de code quality

- aucun fichier > 1000 lignes ;
- alerte a 700 lignes ;
- pas de branches Core/Exploration dispersees ;
- pas de duplication scoring/QC entre TypeScript et Python sans contrat versionne ;
- l'UI ne decide pas les verdicts ;
- tout script declare existe ;
- tout chemin produit a un test ou un run de verification ;
- les fixtures ne deviennent pas la source produit.

## Prochaine decision d'implementation

Le prochain chantier autorise est le "socle executable" :

- creer les fichiers absents references ;
- simplifier `package.json` ou ajouter les scripts manquants ;
- poser les contrats TypeScript/Python ;
- ne pas encore ajouter de complexite UI ou DB non necessaire.

Ce chantier doit etre audite avant d'ajouter la persistance ou l'Agents SDK complet.
