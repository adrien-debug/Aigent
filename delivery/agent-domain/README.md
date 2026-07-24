# Agent-domain export — récupération (AIGENT-CORE-FACTORY-035)

Filet de sécurité **restaurable** de tout le périmètre agents, pris avant toute purge
legacy. La purge n'est autorisée qu'APRÈS que le nouveau cœur soit prouvé ; cet export
est ce qui la rend réversible.

## Contenu
`export.json` — dump déterministe (clés triées, rows triées par `id`, re-export
byte-identique) de 19 tables agent-domain + 3 tables business en `_context` (lecture
seule, jamais purgées, jamais restaurées).

Couverture (au SHA `dc4bbc3`) : copilots(7) · versions(8) · manifests(8) · tools(33) ·
runs(44) · steps(258) · tool_calls(101) · test_* · benchmark_* · proposals(1) ·
delivery_events(3). **Aucun secret** (env/clés/tokens jamais écrits).

## Régénérer l'export
```bash
node --env-file=.env.local scripts/export-agent-domain.mjs
```

## Restaurer (réversibilité de la purge)
```bash
# 1. vérifier ce qui serait ré-inséré (dry-run, aucune écriture)
node --env-file=.env.local scripts/restore-agent-domain.mjs

# 2. restaurer réellement (upsert idempotent sur la clé primaire, parents d'abord)
node --env-file=.env.local scripts/restore-agent-domain.mjs --apply
```

Le restore ne touche jamais `projects` / `mission_runs` / `mission_findings` (données
business, jamais supprimées par la purge). L'upsert `merge-duplicates` rend le restore
ré-exécutable sans doublon.
