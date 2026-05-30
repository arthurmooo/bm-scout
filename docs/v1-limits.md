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
- Le chemin reel Agents SDK consomme un provider configuré et expose des tools métier. Ce n'est pas encore une vraie recherche marche autonome à volume PRD.
- La feedback memory modifie bien scoring/message en local, mais doit encore être prouvée sur runs réels persistés.
- Les agents produisent des sorties structurees, mais la qualite commerciale finale reste a valider par Romu.
- Les recherches web gratuites ou publiques restent dependantes de la disponibilite des sources.
- Les volumes PRD 15 Core / 100 Exploration sont des objectifs de routine, pas encore des preuves de production.

## Limites data

- Supabase stocke runs, companies, contacts, preuves, scores, fiches, messages, feedbacks, outcomes, do-not-contact, lessons, email confidence, insights structurés et run steps.
- La persistance worker passe par RPC transactionnelle, mais doit etre reverifiee dans chaque env avant demo.
- La console lit Supabase cote serveur si `SUPABASE_SERVICE_ROLE_KEY` existe, sinon affiche les fixtures demo.
- Le dedoublonnage avance et l'historique multi-semaines complet ne sont pas encore industrialises.
- `scout_agent_tasks` et `scout_action_events` existent pour proactivite/actions. Un runner de queue existe, mais le cron production n'est pas branche.

## Limites conformite

- La V1 prepare seulement des messages en copier-coller manuel.
- Les statuts do-not-contact, opposition et negative outcome sont presents.
- Le DNC est maintenant bloque par QC TS, worker offline et trigger DB sur messages.
- La V1 ne remplace pas une validation juridique.
- La prospection B2B francophone doit rester limitee, sourcee et respectueuse des oppositions.
- Les donnees sensibles client doivent rester anonymisees.

## Limites UI

- La home est volontairement compacte et orientee decision.
- Les logs techniques restent dans Supabase/tracing, pas dans la vue Romu.
- Les fiches profondes existent pour les leads prioritaires, pas pour tout le scan Exploration.

## Non-negociables de maintenance readiness

- Le cron production consomme vraiment `scout_agent_tasks` via `agent:tasks:real`.
- Les providers reels dépassent les seeds configurées et scannent réellement le marché.
- `npm run verify:supabase` passe avec l'env serveur.
- `--persist` cree un run lisible en Supabase via la RPC.
- Un run reel Agents SDK utilise les feedbacks/outcomes Supabase et modifie les recommandations learning.
- `npm run quality:readiness` passe.
- L'audit thermo-nuclear final ne contient plus de P1 bloquant.
