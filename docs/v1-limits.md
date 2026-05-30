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

- Les runs reels Core et Exploration ont ete executes, mais le run reel Learning post-branchement Supabase reste a refaire.
- Le worker charge les feedbacks Supabase si l'env serveur existe ; sans env, il repasse en seed local.
- Les agents produisent des sorties structurees, mais la qualite commerciale finale reste a valider par Romu.
- Les recherches web gratuites ou publiques restent dependantes de la disponibilite des sources.

## Limites data

- Supabase stocke runs, companies, contacts, preuves, scores, fiches, messages, feedbacks, outcomes, do-not-contact et lessons.
- La persistance worker passe par RPC transactionnelle, mais la CLI `--persist` n'a pas encore ete executee avec une service role key locale.
- La console lit Supabase cote serveur si `SUPABASE_SERVICE_ROLE_KEY` existe, sinon affiche les fixtures demo.
- Le dedoublonnage avance et l'historique multi-semaines complet ne sont pas encore industrialises.

## Limites conformite

- La V1 prepare seulement des messages en copier-coller manuel.
- Les statuts do-not-contact, opposition et negative outcome sont presents.
- La V1 ne remplace pas une validation juridique.
- La prospection B2B francophone doit rester limitee, sourcee et respectueuse des oppositions.
- Les donnees sensibles client doivent rester anonymisees.

## Limites UI

- La home est volontairement compacte et orientee decision.
- Les logs techniques restent dans Supabase/tracing, pas dans la vue Romu.
- Les fiches profondes existent pour les leads prioritaires, pas pour tout le scan Exploration.

## Non-negociables avant readiness

- `npm run verify:supabase` passe avec l'env serveur.
- `--persist` cree un run lisible en Supabase via la RPC.
- Un run reel Agents SDK utilise les feedbacks/outcomes Supabase et modifie les recommandations learning.
- `npm run quality:readiness` passe.
- L'audit thermo-nuclear final ne contient plus de P1.
