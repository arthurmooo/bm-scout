# BM Scout - Etat d'intégration

Date : 2026-05-31

## Verdict PM actuel

Statut : `production_not_ready`.

Le repo n'est plus présenté comme V1 prête. La passe actuelle transforme la démo en socle plus pilotable : tâches proactives, traces d'actions, DNC hard gate, feedback memory causale, Observé/Inféré/Incertain full-stack, auth interne SSR et dashboard moins fictif. Ce n'est pas encore un employé IA complet : le provider OpenAI web prouve maintenant les volumes PRD en smoke, mais le cron production, la persistance Supabase réelle et la feedback loop runtime restent à prouver avec impact structuré.

## Décisions reprises de l'audit

- Ne plus assimiler fixtures et readiness produit.
- Introduire `scout_agent_tasks` pour représenter le travail proactif attendu.
- Tracer les actions Romu dans `scout_action_events`.
- Remplacer la routine UI codée en dur par un brief construit depuis runs/tasks.
- Mettre `quality:readiness` en échec tant que les preuves runtime réelles manquent.
- Bloquer le DNC avant copie/message, pas seulement dans une table décorative.
- Faire influencer le run suivant par les feedbacks Romu, pas seulement produire une synthèse ou enrichir un prompt.
- Stocker Observé/Inféré/Incertain et les statuts d'email dans Supabase.
- Ne plus exposer la console hors démo sans Auth Supabase et claims internes `app_metadata`.

## Implémenté dans cette passe

- Module scheduler TS : `src/domain/scheduler.ts`.
- Runner de queue : `src/server/agent-task-runner.ts` et `scripts/run-agent-task-queue.ts`, avec claim `queued -> running` conditionné au statut, récupération explicite des tâches `running` trop anciennes, et transitions terminales limitées aux tâches encore `running`, pour éviter deux runners, un process mort ou une annulation écrasée.
- Routines non-worker : Daily Brief, Learning Review, DNC check et followup review lisent le snapshot Supabase runtime, produisent un résumé actionnable ou se bloquent si aucun run persistant n'existe.
- Cron GitHub Actions versionné : `.github/workflows/bm-scout-agent-tasks.yml`, maintenant branché sur `agent:cron:evidence` avec artefact `artifacts/agent-tasks/latest-ci-run.json`, qui doit prouver les 6 routines P0 complétées et les traces worker Core/Exploration.
- Workflow manuel readiness complet : `.github/workflows/bm-scout-readiness.yml` lance tests, provider comparison, feedback loop, workers persistés, cron `--all-p0`, `verify:supabase` et `quality:readiness`, puis upload tous les artefacts.
- Tests scheduler avec routines Core, Exploration, Daily Brief, Learning, DNC, followup.
- Migration Supabase `20260530210927_agent_tasks_and_actions.sql`.
- Migration Supabase `20260531030736_agent_tasks_active_dedupe.sql` : index unique partiel pour empêcher deux tâches `queued/running` identiques sur le même créneau.
- Migration Supabase `20260531030749_scout_fk_covering_indexes.sql` : indexes couvrants pour les clés étrangères de persistance, actions, messages, outcomes, evidence et learning.
- Migration Supabase `20260531043451_scout_company_persistence_dedupe.sql` : la RPC `scout_persist_mission_output` cherche d'abord `external_id`, puis le domaine généré, fusionne les companies existantes, priorise Core sur Exploration et trace `dedupe_decision`.
- Migration Supabase `20260530232128_restrict_internal_rls_policies.sql` : suppression des policies `using (true)` et restriction aux rôles internes `app_metadata`.
- Migration Supabase `20260530232456_close_security_definer_rpc_exposure.sql` : fermeture des fonctions `SECURITY DEFINER` exposées en RPC publique.
- API `POST /api/scout/actions`.
- Actions UI : valider, surveiller, enrichir, rejeter, exclure, relancer QC, copier email/relance/LinkedIn, marquer utilisé, DNC, outcomes, raisons feedback en 1 clic et lancer les 6 routines P0.
- Traces actions routines : les lancements manuels Core/Exploration/Daily/Learning/DNC/Relances écrivent maintenant l'ID/type/statut de `scout_agent_tasks` dans `scout_action_events`, et un échec de mise en file est aussi tracé comme action Romu non réussie.
- Boutons d'action : le client attend le verdict JSON serveur avant copie presse-papiers et affiche une erreur courte spécifique (`DNC`, `QC`, `Email`) quand le gate bloque l'action.
- Actions feedback/outcome : bon lead, mauvais lead, raisons de fit ou rejet, bon angle, feedback message détaillé, RDV pris, positif/négatif, mauvais timing, mauvais interlocuteur, douleur confirmée/non confirmée. Ces actions écrivent `scout_feedback` ou `scout_outcomes`, pas seulement `scout_action_events`; les outcomes neutres ne déclenchent pas un rejet mémoire.
- Actions message auditables : copie et marquage utilisé ciblent les derniers `scout_messages.id` validés par canal, jamais tous les messages historiques d'une company ; les traces `scout_action_events` portent `message_id`, canal et IDs utilisés manuellement.
- Action DNC Romu : persiste les cibles réutilisables disponibles (`company`, `domain`, `contact` avec `email_hash`) pour que la mémoire agentique bloque aussi les futurs doublons par domaine/email, pas seulement l'ID company courant.
- Triggers DB `scout_prevent_dnc_message`, `scout_dnc_blocks_existing_messages`, `scout_contacts_block_existing_dnc_messages`, `scout_companies_block_existing_dnc_messages` et `scout_messages_prevent_blocking_outcome` pour empêcher un message non bloqué sur une cible DNC ou un outcome négatif ; un nouveau DNC, un enrichissement contact/company DNC ou un outcome négatif bloque aussi les messages existants.
- QC TS : DNC déterministe et Observé relié à une preuve.
- Worker offline : DNC interdit en shortlist.
- Provider réel : les domaines/companies DNC et les leads déjà rejetés/outcomes négatifs sont bloqués avant fetch quand la mémoire suffit ; les emails/hash DNC ou négatifs sont bloqués avant `to_scout_lead`; les run steps `dnc_pre_generation_gate` et `feedback_reject_pre_generation_gate` prouvent que la génération d'outreach a été court-circuitée.
- Worker réel : provider `auto` avec seeds, SerpAPI, OpenAI `web_search` ou fallback web public, plus 8 tools métier Agents SDK. Le `WebSearchTool` hébergé OpenAI est disponible en opt-in via `BM_SCOUT_AGENT_HOSTED_WEB_SEARCH=1`, mais désactivé par défaut pour éviter de relancer une deuxième recherche web non bornée après le provider.
- Chargement secrets local : les scripts Node de preuve et le worker Python chargent `.env.local` puis `.env` sans écraser l'environnement shell, ce qui permet d'utiliser `OPENAI_API_KEY` et les secrets Supabase localement sans les passer en ligne de commande ni les versionner.
- Provider OpenAI web : utilise le tool officiel Responses API `{ "type": "web_search" }` avec `tool_choice=required`, conserve les sources/traces, parse JSON ou sources web, et n'utilise pas OpenAI récursivement pour les recherches jobs sauf opt-in `BM_SCOUT_OPENAI_SEARCH_JOBS=1`.
- Preuve provider : `latest-comparison.json` porte maintenant `code_revision`, `python_version` et `openai_sdk_version`; `quality:readiness` refuse une comparaison provider ancienne ou sans métadonnées runtime.
- Provider SerpAPI : `BM_SCOUT_PROVIDER=serpapi` ou sélection auto via `SERPAPI_API_KEY`, parsing des `organic_results`, filtrage des sources faibles et run step `serpapi_search`.
- `search_jobs` n'est plus décoratif : le provider web cherche des sources recrutement publiques, les transforme en preuves et les trace dans `run_steps`.
- Déduplication provider renforcée : clés multiples domaine, domaine enregistrable, identité légale normalisée + pays/ville, LinkedIn et identifiant public si disponible, avec run steps `dedupe_company` exposant les clés de doublon. Côté Supabase, la persistance fusionne aussi les companies par `external_id` ou domaine pour éviter un doublon Core/Exploration.
- Scripts `worker:real:*` : exécution reproductible Core/Exploration réelle, avec artefacts `latest-real-*.json` consommés par `quality:readiness`, incluant modèle, provider, versions SDK, révision code, timestamps et durée. Un artefact réel ne compte pas pour la readiness si sa révision ne correspond pas au commit courant.
- Les routines Core/Exploration transmettent maintenant leurs objectifs payload au worker Python ; le worker dérive `scanned_count` des steps provider `discovered_count`, et `quality:readiness` exige Core >= 15 scannés et Exploration >= 100 scannés.
- Le runner refuse aussi de marquer un worker réel persisté comme preuve valide si `scanned_count` est sous l'objectif PRD ou si le step `persist_complete` Supabase manque.
- Mémoire feedback TS : rejet lead, pénalité secteur, bonus angle validé, régénération anti-générique.
- Mémoire feedback worker : chargement feedbacks/outcomes Supabase avec contexte entreprise/segment/site, chargement direct de `scout_do_not_contact`, blocage DNC/rejets par domaine/hash email, pénalités segments faibles, bonus angles validés, outcomes neutres séparés des opt-outs et régénération anti-générique dans le provider Python.
- Run steps feedback worker : chaque application de mémoire produit un step `apply_feedback_memory`, les DNC pré-génération produisent `dnc_pre_generation_gate`, les rejets/outcomes négatifs pré-génération produisent `feedback_reject_pre_generation_gate`, puis un agrégat `feedback_memory_effects` compte les impacts score, blocage, DNC, message régénéré, angle renforcé et delta segment.
- Script `feedback:evidence` : seed contrôlé Supabase feedback/outcome/DNC, run Core Agents SDK persisté avec `BM_SCOUT_EVIDENCE_PURPOSE=feedback_loop` et artefact `artifacts/feedback-loop/latest-feedback-loop.json` pour prouver la causalité feedback et une synthèse Learning 3-5 apprentissages, sans prétendre prouver la recherche marché.
- `quality:readiness` distingue maintenant le provider runtime réel : `configured` peut servir à une preuve feedback contrôlée, mais seuls `openai_web`, `serpapi` ou `web` comptent pour les runs marché Core/Exploration et les volumes PRD.
- Les anciens artefacts bruts `pass` sont affichés comme `fail (artefact pass inéligible)` dans le rapport si les métadonnées runtime ou la révision courante manquent.
- Worker Pydantic : contrat Observé/Inféré/Incertain, email confidence, run steps.
- Email confidence worker : un email public nominatif sourcé devient `usable/high`, un email générique reste `verify/medium`, un pattern observé reste `verify/low`, et l'absence d'email reste `not_usable` sans pattern inventé.
- Recorder Agents SDK : les function tools poussent maintenant leurs entrées/sorties compactées dans `run_steps` pendant `Runner.run`.
- Migration Supabase `20260530214847_bm_scout_structured_insights_email_confidence_steps.sql` appliquée au projet interne.
- Documentation et rapport qualité repassés en statut honnête.
- Auth Supabase SSR : `@supabase/ssr`, page login magic link, callback/logout, proxy de refresh cookie et garde serveur sur la home/API actions.
- Policy applicative : les décisions d'accès lisent uniquement `app_metadata` (`bm_scout_role`, `bm_scout_roles`, `bm_scout_access`) et ignorent les metadata modifiables utilisateur.

## Encore fixture/demo

- `quality:runs` reste un harnais fixture.
- `demoSnapshot()` reste le fallback sans env Supabase serveur. Avec Supabase configuré mais vide, la console affiche un état runtime vide et les tâches, jamais les fixtures comme vérité produit.
- Le worker réel peut découvrir des candidats sans seeds via SerpAPI, OpenAI `web_search` ou fallback web public ; OpenAI web est prouvé à volume PRD en comparaison provider, mais pas encore en run Agents SDK persisté Supabase à volume.
- `verify:supabase` produit maintenant `artifacts/supabase-runtime/latest-verify.json`. `quality:readiness` refuse cet artefact s'il est ancien, `-dirty`, incomplet, sans actions Romu persistées ou sans traces Supabase.
- `verify:supabase` exécute aussi un probe temporaire Core puis Exploration sur le même domaine via `scout_persist_mission_output`, exige une seule company conservée en Core, un run step `dedupe_decision=merged_existing`, puis vérifie que le cleanup laisse zéro company/run de probe.
- `quality:readiness` refuse aussi le cron si l'artefact `latest-ci-run.json` n'est pas issu de GitHub Actions, pas en mode `real`, pas sur la révision courante, sans secrets Supabase/OpenAI, sans les 6 routines P0 complétées, sans traces worker Core/Exploration ou sans transition `completed`.
- Une comparaison provider Core seule ne peut plus déclarer les volumes PRD prouvés ; `prd_volume_proven` exige Core + Exploration.
- Les providers `search_web`, `fetch_company_site`, `search_jobs`, `find_public_emails`, `dedupe_company` existent ; `search_jobs` reste minimal et la robustesse search dépend encore des sources publiques.
- Les volumes 15 Core / 100 Exploration sont paramétrés mais non prouvés en run réel.
- Le feedback influence le moteur TS et le provider Python en tests locaux, avec compteurs d'impact audités. Le scénario `feedback:evidence` rend la preuve Supabase reproductible et consommable par `quality:readiness` pour P0.5, mais elle doit encore être exécutée avec secrets et ne remplace pas un run marché à volume.

## Réellement end-to-end aujourd'hui

- Scheduler reproductible : `npm run agent:schedule` affiche le plan et les tâches dues ; `agent:schedule:run` met en file les 6 routines P0 quand elles sont dues, avec déduplication journalière sauf `--force`.
- Runner queue reproductible : `npm run agent:tasks:offline` ou `npm run agent:tasks:real` avec env Supabase serveur ; les routines brief/learning/DNC/followup ne s'appuient pas sur les fixtures demo.
- Artefacts de run réel reproductibles : `npm run worker:real:core`, `npm run worker:real:exploration`, puis variantes `:persist` avec env Supabase.
- Actions API persistantes si `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` existent ; si Auth SSR est configurée, l'API exige aussi un compte interne BM Scout.
- Console runtime : si Supabase serveur est configuré mais ne contient aucun run, elle affiche zéro lead et les routines à lancer au lieu de retomber sur les fixtures.
- Auth interne : home protégée en mode `BM_SCOUT_AUTH_MODE=internal`, login magic link Supabase, fallback démo seulement si l'auth publique est absente ou explicitement forcée.
- DNC/outcome négatif bloque côté TS, actions serveur, worker offline et triggers Supabase.
- Les actions de copie attendent maintenant la validation serveur avant d'écrire dans le presse-papiers ; côté serveur, un message bloqué QC, une cible DNC, un outcome négatif ou un email `verify/not_usable` refuse la copie et trace l'échec. `mark_message_used` repasse par les mêmes gates avant de passer uniquement les messages courants validés par ID en `used_manually`, sans statut d'envoi.
- Feedback Romu influence le scoring et les messages dans le moteur TS et le worker provider testés, le provider émet des compteurs d'impact exploitables, et un script dédié peut produire la preuve Supabase contrôlée avec Learning exploitable.
- Run steps et email confidence sont écrits par le worker/RPC quand `--persist` est exécuté.
- Console Next buildée avec route d'action dynamique.

## Vérifications exécutées

- `npm run test` : 108 tests pass, dont scheduler idempotent, absence de fallback fixture quand Supabase est vide, copie ou marquage `used_manually` DNC/QC/outcome négatif/email incertain bloqué, bouton client attendant `result.ok` avant copie, blocage DB des messages existants quand une cible devient DNC, outcomes neutres non assimilés à un opt-out, raisons feedback en 1 clic, routines DNC/followup lançables et traçables avec `taskId`, échec de mise en file tracé, schéma API dérivé de la liste canonique des actions UI, indexes FK Supabase, statut message utilisé distinct d'un envoi, index anti-doublon, fusion Supabase company par `external_id`/domaine, preuve `verify:supabase` de fusion RPC avec cleanup, cron readiness couvrant les 6 routines P0, workflow GitHub readiness complet, worker réel persisté refusé sous volume PRD, exception explicite `feedback_loop` pour la preuve causale contrôlée, affichage inéligible des anciens artefacts `pass`, policy Auth BM Scout, actions Romu, provider runtime des preuves et scénario `feedback:evidence`.
- `npm run typecheck` : pass.
- `npm run lint` : pass.
- `npm run build` : pass.
- `npm run quality:runs` : pass fixture, décision produit `production_not_ready`.
- `npm run quality:readiness` : fail attendu, décision produit `production_not_ready`. Les anciens artefacts réels ne suffisent plus à prouver le learning si la mémoire ne vient pas de Supabase, si aucun feedback/outcome Supabase ni DNC Supabase n'est chargé, si aucun impact `feedback_memory_effects` n'est mesuré, si le provider opérationnel est seulement `configured`, si les métadonnées runtime sont absentes, si la révision code ne correspond pas au commit courant ou si le cron ne couvre pas les 6 routines P0.
- `.venv/bin/python -m pytest services/agent-worker/tests` / `npm run worker:test` : 66 tests pass, dont provider SerpAPI, provider OpenAI web, schéma strict Agents SDK, hosted web search opt-in, max turns borné, métadonnées runtime, chargement `.env.local`, contexte/verbosité OpenAI compatibles, surface de requêtes PRD, DNC table/domaine/hash email, outcomes neutres non bloquants, email confidence public/générique/pattern/no-reply, seuil Core validable, fallback jobs, parsing sources, comparaison provider, déduplication domaine/nom/pays/ville/LinkedIn/identifiant, impact feedback structuré et anti-faux-positif PRD sur smoke Core seul.
- `npm run verify:supabase` vérifie maintenant aussi `scout_agent_tasks`, `scout_feedback`, `scout_outcomes`, `scout_do_not_contact`, `scout_run_steps`, `scout_action_events` et la fusion RPC domain/Core.
- Avec `OPENAI_API_KEY` présent en env, `OPENAI_MODEL=gpt-4.1-mini`, `OPENAI_SEARCH_MODEL=gpt-4.1-mini` et `BM_SCOUT_FETCH_LIMIT=3`, `npm run provider:compare -- --providers=openai_web --modes=core,exploration` : pass réel. Core atteint `15/15`, Exploration atteint `100/100`, `openai_web` est recommandé et `prd_volume_proven=true`.
- Avec `OPENAI_API_KEY` présent en env, `OPENAI_MODEL=gpt-4.1-mini`, `OPENAI_SEARCH_MODEL=gpt-4.1-mini`, `BM_SCOUT_PROVIDER=openai_web` et `BM_SCOUT_FETCH_LIMIT=2`, `npm run worker:real:core` : pass réel Agents SDK, artefact `latest-real-core.json`, 2 leads retenus, 5 lessons.
- Avec les mêmes env, `npm run worker:real:exploration` : pass réel Agents SDK, artefact `latest-real-exploration.json`, 2 leads retenus, 5 lessons, aucun message direct.
- Import Agents SDK manager : par défaut, 12 tools disponibles sans `WebSearchTool` hébergé, dont 8 tools métier provider et 4 agents-as-tools. Avec `BM_SCOUT_AGENT_HOSTED_WEB_SEARCH=1`, le manager ajoute le `WebSearchTool`.
- `npm run agent:schedule -- --now=2026-06-01T06:00:00.000Z` : pass, 6 routines planifiées et 6 routines dues le lundi ouvré.
- `npm run agent:schedule:run -- --now=2026-06-01T06:00:00.000Z` sans env serveur : fail attendu avec message env Supabase requis.
- `npm run agent:tasks` sans env serveur : fail attendu avec message env Supabase requis.
- `npm exec tsx -- scripts/run-agent-worker-evidence.ts --offline --mode=core` : pass, artefact `latest-offline-core.json` écrit.
- `npm run test:e2e` : pass, 2 scénarios Playwright ; le smoke force `BM_SCOUT_AUTH_MODE=demo`, vérifie dashboard/actions et page login interne.
- Browser intégré : pass sur `http://localhost:3000` ; dashboard `production_not_ready` visible, routines `Contrôle DNC` et `Relances` visibles, 0 erreur console.
- `npm audit --omit=dev` : fail modéré connu via `next -> postcss <8.5.10`; `npm audit fix --force` propose un downgrade Next cassant vers 9.x, donc non appliqué dans cette passe.
- Supabase interne `Interne_Agentic_prospection` : migrations `agent_tasks_and_actions`, `bm_scout_structured_insights_email_confidence_steps`, `scout_feedback_outcome_actions`, `restrict_internal_rls_policies`, `close_security_definer_rpc_exposure` et `block_messages_after_negative_outcome` appliquées.
- Supabase interne : triggers `scout_messages_prevent_blocking_outcome` et `scout_outcomes_block_messages` vérifiés en base via MCP ; advisor sécurité à 0 lint après application.
- Supabase interne : migrations `agent_tasks_active_dedupe` et `scout_fk_covering_indexes` alignées avec l'historique distant ; index `scout_agent_tasks_active_type_schedule_uniq` et 17 indexes FK vérifiés en base via MCP.
- Supabase interne : migration `scout_company_persistence_dedupe` appliquée ; vérification distante par scénario temporaire Core puis Exploration sur le même domaine, fusion en une seule company, priorité Core conservée, run step `dedupe_decision=merged_existing`, nettoyage confirmé.
- Supabase advisor performance : plus aucun lint `unindexed_foreign_keys`; les lints restants sont `unused_index`, attendus sur une base de test à faible volume.
- Supabase advisor sécurité : 0 lint après durcissement RLS/RPC.

## Prochaine tranche P0

1. Fournir l'env service role au runner local/cron et tester `agent:tasks:offline` contre Supabase.
2. Ajouter `SERPAPI_API_KEY`, relancer `npm run provider:compare`, puis comparer couverture, coût et qualité des sources contre OpenAI web avant choix par défaut.
3. Prouver les volumes PRD 15 Core / 100 Exploration en run Agents SDK persisté Supabase, pas seulement en smoke provider.
4. Exécuter `npm run feedback:evidence` avec secrets serveur pour produire une preuve Supabase de causalité feedback, puis prouver la même mémoire sur runs marché Core/Exploration à volume.
5. Exécuter le workflow GitHub Actions `BM Scout readiness evidence` avec secrets, télécharger `bm-scout-readiness-evidence` et vérifier que `quality:readiness` est le gate final.
6. Affecter les claims Supabase réels aux comptes Romu/Arthur et valider le parcours magic link sur le projet interne.
