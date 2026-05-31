# Limites V1 - BM Scout

BM Scout V1 est une console interne. Elle doit rester sobre sur ses promesses.

## Limites produit

- Pas d'envoi autonome email ou LinkedIn.
- Pas de sequence outbound de masse.
- Pas de CRM complet.
- Pas de dashboard admin Arthur lourd.
- Pas de garantie de trouver des emails nominatifs.
- Pas de scraping LinkedIn agressif.
- Pas d'outil payant obligatoire.

## Limites agentiques

- Le worker charge les feedbacks/outcomes Supabase et `scout_do_not_contact` si l'env serveur existe ; sans env, il repasse en seed local pour developpement.
- Le chemin reel Agents SDK expose un provider `serpapi`, un provider `openai_web`, un fallback web public, un job search public minimal et des tools métier. Le `WebSearchTool` OpenAI est opt-in via `BM_SCOUT_AGENT_HOSTED_WEB_SEARCH=1`; par défaut la recherche réelle passe par le provider pour éviter une double recherche lente. OpenAI web est prouvé à volume PRD en smoke provider, mais pas encore en run persisté Supabase.
- La feedback memory modifie bien scoring/message/blocage/angle en local côté TS et worker Python ; les feedbacks/outcomes/DNC Supabase chargent maintenant le contexte entreprise/segment/site/domaine/hash email, le provider émet des compteurs `feedback_memory_effects`, et `feedback:evidence` prépare une preuve Supabase contrôlée avec synthèse Learning vérifiée. Cette preuve porte `BM_SCOUT_EVIDENCE_PURPOSE=feedback_loop` et ne remplace pas les runs marché à volume.
- Les agents produisent des sorties structurees, mais la qualite commerciale finale reste a valider par Romu.
- Les recherches SerpAPI/OpenAI web/fallback public restent dependantes de la disponibilite des sources, des coûts, des rate limits et de la qualité des requêtes.
- OpenAI `web_search` est branché et testé sur Core et Exploration. Dernier smoke provider réel : `15/15` comptes Core et `100/100` comptes Exploration découverts avec shortlist bornée.
- `provider:compare` mesure la couverture des providers, mais ne remplace pas un run Agents SDK persisté ni une validation commerciale Romu.
- Les volumes PRD 15 Core / 100 Exploration sont prouvés côté comparaison provider OpenAI web, pas encore comme routine persistée Supabase/cron.
- Les tâches Core/Exploration transmettent maintenant leurs objectifs au worker Python, et le runner comme `quality:readiness` refusent les artefacts réels persistés dont `scanned_count` reste sous 15/100 ou dont la persistance Supabase n'est pas prouvée par `persist_complete`.
- Les runs `configured`/`BM_SCOUT_REAL_SEEDS` ne comptent pas comme preuve de recherche marché dans `quality:readiness`; ils servent uniquement aux scénarios contrôlés comme la feedback loop.

## Limites data

- Supabase stocke runs, companies, contacts, preuves, scores, fiches, messages, feedbacks, outcomes, do-not-contact, lessons, email confidence, insights structurés et run steps.
- Le worker ne fabrique pas d'email : nominatif public sourcé = `usable/high`, générique public = `verify/medium`, pattern observé = `verify/low`, absence ou no-reply = `not_usable`.
- Le provider réel court-circuite les domaines/companies DNC ou déjà rejetés avant fetch et les contacts/email hashes DNC ou liés à un outcome négatif avant génération d'outreach ; les preuves `dnc_pre_generation_gate` et `feedback_reject_pre_generation_gate` restent à relire dans les artefacts réels persistés avant claim V1.
- Les feedbacks/outcomes Romu et les entrées do-not-contact sont persistés par l'API serveur et relus par le worker. Les outcomes neutres restent neutres dans la mémoire, mais l'effet à volume doit encore être démontré par runs réels persistés avec compteurs d'impact non nuls.
- La persistance worker passe par RPC transactionnelle, mais doit etre reverifiee dans chaque env avant demo.
- La console lit Supabase cote serveur si `SUPABASE_SERVICE_ROLE_KEY` existe. Elle n'affiche les fixtures demo que sans env Supabase serveur ; une base Supabase vide reste affichée comme vide.
- Le dedoublonnage provider utilise maintenant domaine, domaine enregistrable, identité légale+pays/ville, LinkedIn et identifiant public si disponible. La persistance Supabase fusionne les nouvelles companies par `external_id` ou domaine et priorise Core sur Exploration ; la rétro-fusion d'anciens doublons historiques n'est pas encore industrialisée.
- `scout_agent_tasks` et `scout_action_events` existent pour proactivite/actions. Un runner de queue existe pour Core, Exploration, Daily Brief, Learning, DNC check et followup review. Le cron GitHub Actions écrit un artefact de preuve, mais n'est pas encore prouvé avec secrets.
- Les clés étrangères critiques sont indexées pour éviter les warnings Supabase `unindexed_foreign_keys`. Les warnings `unused_index` peuvent rester tant que le projet interne a peu de volume réel.
- RLS est resserrée côté Supabase avec roles internes via `app_metadata`. L'auth UI/API est branchée, mais les vrais claims Romu/Arthur doivent encore être posés et vérifiés dans Supabase avant exposition hors démo.

## Limites conformite

- La V1 prepare seulement des messages en copier-coller manuel.
- Les statuts do-not-contact, opposition et negative outcome sont presents.
- Le DNC et l'outcome négatif sont maintenant bloqués par QC/mémoire TS, worker offline, triggers DB sur messages, blocage DB des messages existants et gate serveur avant copie presse-papiers.
- Une action DNC Romu écrit les scopes company/domain/contact disponibles, mais ne remplace pas encore un centre de gestion DNC granulaire par personne avec interface dédiée.
- Les copies email/relance et le marquage "message utilisé" sont bloqués si l'email contact est `verify` ou `not_usable`; LinkedIn seul reste copiable si le DNC/QC passe.
- Les copies et marquages `used_manually` sont bornés aux IDs de messages validés côté serveur. Le client copie le texte relu et autorisé par le serveur, tandis que les traces d'action conservent seulement les IDs/canaux. Cela évite de marquer des anciens brouillons historiques comme copiés ou utilisés, de copier une version locale périmée et de créer un statut d'envoi.
- La V1 ne remplace pas une validation juridique.
- La prospection B2B francophone doit rester limitee, sourcee et respectueuse des oppositions.
- Les donnees sensibles client doivent rester anonymisees.
- La clé `service_role` reste strictement serveur/worker ; aucun composant client ne doit la référencer.
- Les décisions d'accès Auth SSR ne doivent jamais utiliser `user_metadata` ou `raw_user_meta_data`, seulement `app_metadata`.
- Le provider OpenAI web fonctionne comme smoke réel à volume PRD sur Core et Exploration. SerpAPI reste nécessaire pour comparer coût, stabilité et qualité des sources avant claim V1.

## Limites UI

- La home est volontairement compacte et orientee decision.
- Les logs techniques restent dans Supabase/tracing, pas dans la vue Romu.
- Les fiches profondes existent pour les leads prioritaires, pas pour tout le scan Exploration.

## Non-negociables de maintenance readiness

- Le cron GitHub Actions consomme vraiment `scout_agent_tasks` via `agent:tasks:real` avec secrets configurés, complète les 6 routines P0 et produit des traces worker Core/Exploration.
- `artifacts/agent-tasks/latest-ci-run.json` vient d'une exécution GitHub Actions `real`, sur la révision courante, avec transitions `completed` et zéro tâche échouée/bloquée/récupérée.
- Le workflow manuel `BM Scout readiness evidence` produit les artefacts provider, feedback, worker persisté, cron, Supabase runtime et quality final sur la révision courante.
- `BM_SCOUT_AUTH_MODE=internal` est activé hors démo, avec `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et comptes internes autorisés.
- Les providers reels dépassent les seeds configurées, scannent réellement le marché et prouvent la qualité des sources ; OpenAI web est prouvé en smoke Core/Exploration à volume PRD, SerpAPI reste à brancher pour comparaison provider.
- `artifacts/provider-comparison/latest-comparison.json` recommande un provider réel couvrant Core et Exploration à volume configuré/PRD, avec métadonnées runtime et révision code courante.
- `npm run verify:supabase` passe avec l'env serveur.
- `artifacts/supabase-runtime/latest-verify.json` est produit par `verify:supabase`, porte la révision courante, n'est pas `-dirty`, prouve les actions Romu persistées, prouve au moins une action reliée à une tâche agentique par `task_id`, et prouve la fusion RPC par domaine avec priorité Core et cleanup à zéro.
- `--persist` cree un run lisible en Supabase via la RPC.
- Un run reel Agents SDK utilise les feedbacks/outcomes/DNC Supabase, écrit des artefacts avec `feedback_memory_source=supabase`, `dnc_pre_generation_gate`, `feedback_reject_pre_generation_gate`, des compteurs `feedback_memory_effects` non nuls, des métadonnées runtime complètes, une révision code courante, et modifie les recommandations learning. Pour les volumes Core/Exploration, le provider runtime doit être `openai_web`, `serpapi` ou `web`, pas `configured`.
- `npm run quality:readiness` passe.
- L'audit thermo-nuclear final ne contient plus de P1 bloquant.
