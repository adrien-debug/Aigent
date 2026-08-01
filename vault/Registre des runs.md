---
type: registre
mis_a_jour: 2026-08-01
source: runtime_telemetry_events via /api/agent-ops/metrics
---

# Registre des runs

Relevé du 2026-08-01, mesuré sur `runtime_telemetry_events` via la route
d'exposition `/api/agent-ops/metrics`.

## Chiffres constatés

| Mesure | Valeur | Note |
|---|---|---|
| Runs observés | **38** | fenêtre récente bornée |
| `completed` | 24 | terminal réussi |
| `failed` | 9 | terminal échoué |
| `started` | 5 | encore en vol — **jamais** compté comme succès |
| Taux de succès | **72,7 %** | sur les seuls runs terminaux |
| Latence moyenne | 7 608 ms | sur les runs **portant** une latence |
| Latence p95 | 20 598 ms | idem |
| Couples (projet, agent) | 15 | 12 agents nus, 3 servant plusieurs projets |
| Dernier événement | 2026-07-30 | ~47 h avant le relevé |

## Ce que ces chiffres ne disent pas

**15 des 38 événements n'ont pas de latence mesurée.** Ils ne sont pas comptés
comme 0 ms : ils sont exclus du calcul. Une moyenne sur 23 valeurs, pas sur 38.

Le taux de succès de 72,7 % porte sur les 33 runs **terminaux** (24 + 9). Les 5
runs `started` sont exclus — les fondre dedans fabriquerait un taux inventé.

## Alerte réelle en cours

Le workflow n8n « veille de santé de flotte » remonte, sur ces données :

> taux de succès 72.7% sous le plancher de 80%

Ce n'est pas une alerte de démonstration : c'est l'état réel de la flotte au
relevé.

## Provenance

`runtime_telemetry_events` → `summarizeFleetRuntimeTelemetry()` →
`/api/agent-ops/metrics` → Prometheus → Grafana (dashboard `aigent-runs`).

Voir [[Parcours de qualification]] · [[Modèle — run]]
