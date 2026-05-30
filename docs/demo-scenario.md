# Scenario demo - BM Scout V1

Objectif : montrer a Romu que BM Scout se comporte comme un analyste acquisition interne, pas comme un chatbot ou un generateur de volume.

Durée cible : 12 minutes.

## 1. Ouverture

Message a poser :

> BM Scout a prepare la semaine. La question n'est pas "combien de leads", mais "qu'est-ce que Romu doit traiter maintenant".

Montrer :

- le brief du jour ;
- la section a traiter maintenant ;
- le lead prioritaire ;
- les apprentissages.

Critere de reussite :

- Romu comprend la prochaine action en moins de 30 secondes.

## 2. Core BM

Ouvrir Cambon Partners.

Montrer :

- fit Core BM ;
- signaux observes ;
- hypotheses de douleur separees des faits ;
- score justifie ;
- fiche courte ;
- fiche profonde ;
- personas ;
- email, relance et LinkedIn en copier-coller manuel ;
- decision Quality Control `pass`.

Questions a poser :

- Le lead est-il vraiment dans l'ICP ?
- Le signal est-il concret ?
- L'hypothese est-elle commercialement credible ?
- Le message pourrait-il etre envoye uniquement a cette entreprise/persona ?

Critere de reussite :

- Romu peut decider valider/enrichir/rejeter sans demander une recherche manuelle supplementaire.

## 3. Rejet et do-not-contact

Ouvrir Eight Advisory bloque.

Montrer :

- score ou fit possible ne suffit pas ;
- do-not-contact ecrase toute recommandation ;
- message bloque ;
- raison QC visible.

Critere de reussite :

- Romu voit que le systeme bloque une sortie commercialement risquee meme si le compte semble ICP.

## 4. Exploration

Montrer un lead Exploration retenu et un compte faible ecarte.

Insister :

- Exploration scanne large ;
- elle ne remonte pas tout ;
- elle ne produit pas de message direct ;
- elle explique les exclusions ;
- elle garde la difference Core vs opportuniste.

Critere de reussite :

- l'exploration ressemble a un radar qualifie, pas a du volume bruite.

## 5. Feedback et learning

Montrer les feedbacks simules Romu :

- tres bon lead ;
- mauvais lead ;
- message trop generique ;
- bon angle ;
- outcome positif ou negatif ;
- do-not-contact.

Montrer le rapport learning :

- 3 a 5 apprentissages ;
- recommandations semaine suivante ;
- prise en compte du do-not-contact.

Critere de reussite :

- Romu comprend que son jugement nourrit la semaine suivante.

## 6. QC negatif

Expliquer le cas faible injecte :

- lead sans signal concret ;
- hypothese inventee ;
- message generique ;
- contact incertain ;
- entreprise trop petite ;
- score non justifie.

Montrer :

- QC bloque ;
- raison claire ;
- demande enrichissement ou rejet ;
- aucun message generique laisse passer.

Critere de reussite :

- la demo montre autant les refus que les recommandations.

## Script de conclusion

> BM Scout n'est pas la machine qui envoie. C'est l'analyste qui prepare. Romu garde la relation commerciale, BM Scout garde le systeme : sources, priorites, messages, feedbacks, apprentissages.

## Limite a annoncer pendant la demo

La V1 actuelle n'est pas encore marqueable `ready` tant que la console Supabase serveur, la CLI `--persist` et le run reel Learning alimente par Supabase ne sont pas prouves dans le meme environnement.
