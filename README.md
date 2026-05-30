# BM Scout

Console interne premium de prospection agentique pour BM Automation.

BM Scout n'est pas un CRM ni un SaaS standard. La V1 prépare le travail commercial de Romu :

- recherche Core BM et Exploration séparées ;
- qualification, signaux observés, hypothèses prudentes et scores justifiés ;
- fiches courtes et profondes ;
- contacts/personas, email froid, relance, LinkedIn manuel ;
- Quality Control anti-générique avant affichage ;
- feedback Romu, apprentissage hebdomadaire et blocage do-not-contact ;
- aucune action externe automatique.

## Lancer

```bash
npm install
npm run dev
```

Variables :

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` optionnel, par défaut `gpt-5.5`

## Tests

```bash
npm run test
npm run typecheck
npm run lint
npm run build
npm run quality:runs
```

`quality:runs` exécute les 4 runs obligatoires : Core BM, Exploration, Feedback & Learning, QC négatif. Les sorties sont enregistrées dans `artifacts/quality-runs/latest-report.md`.
