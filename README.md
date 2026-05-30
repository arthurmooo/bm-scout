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
npm run quality:readiness
npm run worker:test
```

`quality:runs` exécute le harnais fixture des 4 runs obligatoires : Core BM, Exploration, Feedback & Learning, QC négatif. Les sorties sont enregistrées dans `artifacts/quality-runs/latest-report.md`.

`quality:readiness` est volontairement bloquant tant que la V1 reste `not_ready`. Aujourd'hui il échoue encore parce que la console Supabase serveur, la CLI `--persist` avec service role locale et le run réel Learning alimenté par Supabase restent à prouver.

## Worker agentique

```bash
npm run worker:install
npm run worker:offline
cd services/agent-worker
../../.venv/bin/python -m bm_scout_worker.cli --real --mode core
../../.venv/bin/python -m bm_scout_worker.cli --real --mode core --persist
```

Le chemin réel utilise OpenAI Agents SDK avec `Runner.run`, `trace`, agents spécialisés, agents-as-tools, handoff QC, outputs Pydantic et guardrail de qualité. La persistance `--persist` passe par la RPC Supabase transactionnelle `scout_persist_mission_output`.

## Documentation de livraison

- `docs/architecture-v1.md` : architecture produit et technique.
- `docs/launch-runbook.md` : installation, lancement, gates.
- `docs/demo-scenario.md` : scénario de démonstration Romu.
- `docs/v1-limits.md` : limites assumées de la V1.
- `docs/prd-completion-audit.md` : couverture PRD et preuves manquantes.
- `docs/thermo-nuclear-final-audit.md` : audit maintenabilité strict.
