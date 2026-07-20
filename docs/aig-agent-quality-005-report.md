# AIG-AGENT-QUALITY-005 — Audit réel de la qualité des agents & du multi-provider

> Vérité d'exécution, pas de config. Chaque ligne porte un verdict de l'échelle :
> **PROVEN LIVE** · **PROVEN TEST** · **CONFIGURED** · **PARTIAL** · **UNAVAILABLE** · **BROKEN**.
> Donnée absente = `null`/inconnue, jamais `0`. Aucun coût/latence/score inventé.
>
> Base : Postgres `aigent` sur gpu1 (lecture seule). Code : commit `503212c`,
> worktree `feature/aig-agent-quality-005`. Audit démarré 2026-07-21.

---

## Avertissement — la prémisse du brief est PÉRIMÉE

Le brief décrit « sept copilots `copilot-fin-*`, provider **local**, bench 16/16 »
comme famille à auditer. **Ces agents n'existent plus** : les sept ont été
supprimés le 2026-07-20 (cascade DB vérifiée, 7 copilots + 7 manifestes + 7
versions + 26 outils + 5 runs à zéro). Conséquence directe : **aucun agent en
base n'utilise le provider `local` ni `google`.** Le multi-provider annoncé n'est
plus exercé par aucun agent — voir Lot A / matrice provider.

---

## Lot A — Vérité DB & inventaire canonique  ·  **PROVEN LIVE** (lecture réelle gpu1)

### A1. Population
| Statut | Nombre |
|---|---|
| draft | 30 |
| active | 8 |
| **total** | **38** |

### A2. Runtime × provider — le fait le plus lourd
| runtime | provider | modèle | nombre |
|---|---|---|---|
| langgraph | openai | gpt-5.4 | 32 |
| openai-assistants | openai | gpt-5.4 | 6 |

**100 % des copilots sont `openai` / `gpt-5.4`.** Zéro `google`, zéro `local`,
zéro `mistral`. Les 6 `openai-assistants` sont la gamme trading (Atlas, Vector,
Sentinel, Pulse, Meridian, Sage) qui tourne sur le chemin **direct** model-router.

### A3. Exécution réelle — 26 agents sur 38 n'ont JAMAIS tourné
- **12 copilots** ont au moins un run ; **26 ont zéro run** (affichés, jamais exécutés).
- Historique total : **137 `agent_runs`**.
- Répartition des runs réels :

| copilot | runs | dernier run | completed | needs-confirm | blocked |
|---|---|---|---|---|---|
| power-ops-copilot | 43 | 2026-07-20 | 40 | 2 | 1 |
| agent-builder-copilot | 16 | 2026-07-12 | 9 | 5 | 2 |
| atlas-market-structure | 15 | 2026-07-18 | 15 | 0 | 0 |
| sage-trading-coach | 14 | 2026-07-18 | 14 | 0 | 0 |
| sentinel-risk-manager | 11 | 2026-07-18 | 11 | 0 | 0 |
| pulse-execution-scout | 11 | 2026-07-18 | 11 | 0 | 0 |
| vector-quant-regime | 11 | 2026-07-18 | 11 | 0 | 0 |
| meridian-macro-context | 11 | 2026-07-18 | 11 | 0 | 0 |
| bull21-review / qa-release / repo-inspector / security-sentinel | 1-2 | 2026-07-12/13 | — | — | — |

### A4. Modèle réellement exécuté — **BROKEN** (0/137 vérifiés)
| resolved_provider | resolved_model | model_unverified | runs |
|---|---|---|---|
| (null) | (null) | true | 130 |
| openai | (null) | true | 7 |

**Aucun run de tout l'historique ne prouve quel modèle a réellement exécuté.**
`model_unverified = true` partout ; même les 7 runs qui ont capté un provider
n'ont pas de `resolved_model`. `gpt-5.4` est déclaré sur les 38 agents mais
n'a jamais été vérifié comme exécuté. → Exigence brute du brief (« modèle
exécuté réellement persisté ») : **non satisfaite**.

Cause code (`runner.ts:370-371`) : `resolvedModel` init `null`, `modelUnverified`
init `true` ; sur le chemin LangGraph le graphe instancie son modèle en interne
et ne renvoie pas l'id réel → le flag reste `true`. Documenté, mais c'est
exactement le trou de vérité que l'audit doit nommer.

### A5. Statuts de run — HITL et blocage ONT eu lieu  ·  **PROVEN LIVE**
| statut | nombre |
|---|---|
| completed | 127 |
| needs-confirmation | 7 |
| blocked | 3 |

7 interruptions HITL et 3 blocages réellement persistés → le chemin de pause et
le garde-fou de blocage se sont déclenchés en conditions réelles au moins ces
fois-là (détail HITL en Lot E).

### A6. Garde-fous — état des outils  ·  **PARTIAL**
- **158 outils** ; **148 sans confirmation**, **10 avec confirmation**.
- Risque : 137 low · 13 medium · 6 high · 2 critical.
- `mutates` : **158 = true** (100 %). Aucun `false`.

Deux gaps réels :
1. **`mutates` jamais backfillé** — les 158 outils sont présumés mutants, y
   compris les lectures pures (`read_repo_file`, `read_project_summary`…). Le
   toggle de confirmation est donc verrouillé sur ~150 outils read-only sans
   recours (le PATCH n'accepte pas `mutates`).
2. **Invariant non rétroactif** — la règle « mutates OU high/critical ⇒
   requiresConfirmation » n'est appliquée qu'aux écritures futures : 8 outils
   high/critical existent mais seuls 10 outils au total exigent confirmation.
   À vérifier au cas par cas (Lot F) si les 8 high/critical sont couverts.

### A7. Infra benchmark & test disponible
| table | lignes |
|---|---|
| benchmark_suites | 25 |
| benchmark_runs | 56 |
| test_suites | 27 |
| test_cases | 122 |
| test_runs | 78 |

Volume réel présent — qualité de ces benchmarks à auditer en Lot F (fixtures vs
réel, critères métier, épinglage de version).

---

## Vérité du câblage code (chemin direct)  ·  **CONFIGURED**

`src/lib/agent-mission-control/model-router.ts` :
- `ModelProvider = 'openai' | 'google' | 'local'` (mistral retiré de l'union).
- Dispatch : `openai→callOpenAI`, `google→callGemini`, `local→callLocalVllm`,
  défaut → `ProviderUnavailableError('unknown provider')`.
- `mistral` : correctement **non câblé** — `model-provider.mjs:90` jette
  `provider 'mistral' is not wired in V1`.

Donc les trois providers sont **câblés dans le code** (CONFIGURED). Mais aucun
agent en base ne les exerce sauf openai → voir divergence #1.

---

## Divergences détectées (Lot A + code)

| # | Divergence | Sévérité |
|---|---|---|
| 1 | Code multi-provider (openai/google/local) vs **0 agent** utilisant google ou local | Structurelle — le multi-provider n'est prouvé par aucun agent |
| 2 | `resolved_model = null` + `model_unverified = true` sur **137/137 runs** — la plateforme ne peut prouver aucun modèle exécuté | BROKEN (vérité) |
| 3 | `tools.mutates = true` sur 158/158 ; invariant confirmation non rétroactif (10 confirmations pour 8 high/critical + 158 mutants) | Garde-fou |
| 4 | 26/38 agents affichés sans aucun run réel | Vérité d'affichage |
| 5 | Brief assume la famille finance locale (bench 16/16) — supprimée le 2026-07-20 | Périmé |
| 6 | HEAD a avancé pendant l'audit (`503212c`, refactor UI par un autre agent sur main) | Contexte |

---

## Verdict provisoire (fin Lot A)

- **OpenAI** : PROVEN LIVE au sens « des runs réels ont eu lieu » (137 runs), mais
  **modèle exécuté jamais vérifié** → qualité de la preuve dégradée.
- **Gemini (google)** : CONFIGURED (code) · **UNAVAILABLE sur agents** (aucun n'en utilise, aucune preuve d'exécution).
- **Local vLLM** : CONFIGURED (code) · **UNAVAILABLE sur agents** (famille finance supprimée, aucun agent restant).
- **Mistral** : correctement non câblé — pas un provider fonctionnel.

Lots B–F (campagnes live facturées : matrice provider au niveau model-router,
HITL bout-en-bout, adversarial, benchmarks) : **à exécuter**. Voir section suivante.

_(Document en cours — Lot A clos et prouvé. Lots B–G à venir.)_
