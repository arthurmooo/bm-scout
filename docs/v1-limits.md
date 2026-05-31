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

- Le worker charge les feedbacks Supabase si l'env serveur existe ; sans env, il repasse en seed local pour developpement.
- Le chemin reel Agents SDK expose le `WebSearchTool` OpenAI, un provider `serpapi`, un provider `openai_web`, un fallback web public, un job search public minimal et des tools métier. Ce n'est pas encore une recherche marché prouvée à volume PRD.
- La feedback memory modifie bien scoring/message en local côté TS et worker Python ; les feedbacks/outcomes Supabase chargent maintenant le contexte entreprise/segment/site, mais l'effet doit encore être prouvé sur runs réels persistés.
- Les agents produisent des sorties structurees, mais la qualite commerciale finale reste a valider par Romu.
- Les recherches SerpAPI/OpenAI web/fallback public restent dependantes de la disponibilite des sources, des coûts, des rate limits et de la qualité des requêtes.
- OpenAI `web_search` est branché et testé sur Core. Il ne prouve pas encore Exploration 100 comptes : dernier smoke réel à 36/100 comptes découverts avec shortlist bornée.
- `provider:compare` mesure la couverture des providers, mais ne remplace pas un run Agents SDK persisté ni une validation commerciale Romu.
- Les volumes PRD 15 Core / 100 Exploration sont des objectifs de routine, pas encore des preuves de production.

## Limites data

- Supabase stocke runs, companies, contacts, preuves, scores, fiches, messages, feedbacks, outcomes, do-not-contact, lessons, email confidence, insights structurés et run steps.
- Les feedbacks/outcomes Romu sont persistés par l'API serveur et relus par le worker, mais l'effet à volume doit encore être démontré par runs réels persistés.
- La persistance worker passe par RPC transactionnelle, mais doit etre reverifiee dans chaque env avant demo.
- La console lit Supabase cote serveur si `SUPABASE_SERVICE_ROLE_KEY` existe. Elle n'affiche les fixtures demo que sans env Supabase serveur ; une base Supabase vide reste affichée comme vide.
- Le dedoublonnage avance et l'historique multi-semaines complet ne sont pas encore industrialises.
- `scout_agent_tasks` et `scout_action_events` existent pour proactivite/actions. Un runner de queue existe pour Core, Exploration, Daily Brief, Learning, DNC check et followup review. Le cron GitHub Actions existe, mais n'est pas encore prouvé avec secrets.
- RLS est resserrée côté Supabase avec roles internes via `app_metadata`. L'auth UI/API est branchée, mais les vrais claims Romu/Arthur doivent encore être posés et vérifiés dans Supabase avant exposition hors démo.

## Limites conformite

- La V1 prepare seulement des messages en copier-coller manuel.
- Les statuts do-not-contact, opposition et negative outcome sont presents.
- Le DNC est maintenant bloque par QC TS, worker offline et trigger DB sur messages.
- La V1 ne remplace pas une validation juridique.
- La prospection B2B francophone doit rester limitee, sourcee et respectueuse des oppositions.
- Les donnees sensibles client doivent rester anonymisees.
- La clé `service_role` reste strictement serveur/worker ; aucun composant client ne doit la référencer.
- Les décisions d'accès Auth SSR ne doivent jamais utiliser `user_metadata` ou `raw_user_meta_data`, seulement `app_metadata`.

## Limites UI

- La home est volontairement compacte et orientee decision.
- Les logs techniques restent dans Supabase/tracing, pas dans la vue Romu.
- Les fiches profondes existent pour les leads prioritaires, pas pour tout le scan Exploration.

## Non-negociables de maintenance readiness

- Le cron GitHub Actions consomme vraiment `scout_agent_tasks` via `agent:tasks:real` avec secrets configurés.
- `BM_SCOUT_AUTH_MODE=internal` est activé hors démo, avec `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et comptes internes autorisés.
- Les providers reels dépassent les seeds configurées, scannent réellement le marché et prouvent la qualité des sources ; OpenAI web est prouvé sur Core borné, SerpAPI reste à brancher avec clé et artefacts à volume pour Exploration.
- `artifacts/provider-comparison/latest-comparison.json` recommande un provider réel couvrant Core et Exploration à volume configuré/PRD.
- `npm run verify:supabase` passe avec l'env serveur.
- `--persist` cree un run lisible en Supabase via la RPC.
- Un run reel Agents SDK utilise les feedbacks/outcomes Supabase et modifie les recommandations learning.
- `npm run quality:readiness` passe.
- L'audit thermo-nuclear final ne contient plus de P1 bloquant.
