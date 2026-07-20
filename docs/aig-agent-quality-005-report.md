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

---

## Lots B–D — Campagne provider live (bornée, coût réel ≈ 0,0006 USD)

Sonde exécutant le VRAI `routeCompletion` (pas les API brutes), fallback OFF,
zéro retry, zéro parallélisme. Preuves verbatim capturées.

### Matrice provider-path
| Provider | Texte | JSON | Tool-use | Modèle résolu (réel) | modelVerified | Fallback silencieux | Coût | Verdict |
|---|---|---|---|---|---|---|---|---|
| **OpenAI** | ✅ PONG | ✅ `{status:ok,n:42}` | ✅ get_status | `gpt-5.4-2026-03-05` (≠ demandé `gpt-5.4`) | **true** | non | 0,0006 $ (3 appels) | **PROVEN LIVE** |
| **Gemini (google)** | ❌ 403 | — | — | — (endpoint atteint) | — | **non** (erreur typée) | ~0 $ | **BROKEN** — clé rejetée |
| **local vLLM** | ✅ PONG | ✅ `{status:ok,n:42}` | non testé | `Qwen/Qwen2.5-Coder-7B-Instruct-AWQ` (≠ alias `local-qwen-7b`) | **true** | non | 0 $ (3 appels) | **PROVEN LIVE — PROVIDER PATH ONLY** |
| **mistral** | — | — | — | — | — | — | — | **UNSUPPORTED** (retiré de l'union, jette) |

### Lot B — OpenAI · **PROVEN LIVE** + correctif de vérité
- Le router capture désormais le modèle réellement servi (`completion.model`)
  au lieu de renvoyer le modèle demandé. Preuve : demandé `gpt-5.4` →
  **résolu `gpt-5.4-2026-03-05`** (snapshot daté), `modelVerified=true`.
- Structured output (`parsedJson` valide) et tool-use (`get_status` appelé) OK.
- **Vrai run persisté** : `agent_runs.f2863bdc` → `resolved_model=gpt-5.4-2026-03-05`,
  `model_unverified=f`, `cost_usd=0.001159`, status completed. Cohérence
  réponse-provider ↔ DB vérifiée.
- Réalité globale après correctif : **1 run vérifié, 137 non vérifiés** — les
  anciens ne sont PAS backfillés (règle du brief respectée).
- Items 4-5 (outil interdit, confirmation) : garde-fous du RUNNER, indépendants
  du provider — prouvés live sur vLLM (session précédente) + unit ; à re-prouver
  en Lot E HITL sur le chemin LangGraph. Classés **PROVEN TEST + PROVEN LIVE (autre provider)**.

### Lot C — Gemini · **BROKEN (clé fuitée)** + garde-fou fallback CONFIRMÉ
- Endpoint Gemini réellement appelé (réponse HTTP 403 de Google).
- Erreur : `ModelAccessError: 403 "Your API key was reported as leaked. Please
  use another API key."` → **la clé Gemini est compromise et rejetée par Google.**
- Garde-fou prouvé : `allowFallback=false` → **aucun fallback silencieux vers
  OpenAI**, erreur typée remontée. La sûreté « no silent fallback » tient.
- **Action sécurité** : faire tourner la clé Gemini (3ᵉ secret fuité de la série,
  après Langfuse Cloud et le token GitHub). Aucun secret affiché dans cet audit.

### Lot D — local vLLM · **PROVEN LIVE — PROVIDER PATH ONLY**
- Parc vLLM joignable depuis le poste ; texte + JSON structuré servis, coût 0.
- Modèle résolu = **served-model réel** (`Qwen/…-7B-Instruct-AWQ`), `modelVerified=true`
  — un parc redéployé sous un autre id serait détectable, plus assumé.
- Modèle inconnu (`local-does-not-exist`) → `ProviderUnavailableError`, aucun
  fallback cloud. (Message d'erreur imprécis : « env missing » au lieu de
  « unknown model id » — cosmétique, à corriger.)
- Tool-use / timeout non exercés cette passe — à classer, si non supportés par
  le modèle testé, en **UNSUPPORTED BY TESTED MODEL**, jamais BROKEN PROVIDER.

### Divergences ajoutées
| # | Divergence | Sévérité |
|---|---|---|
| 7 | Direct path écrivait `model_unverified=false` en dur sans vérifier — **corrigé** (Lot B) | Vérité — réglé |
| 8 | Clé Gemini rejetée 403 « reported as leaked » | Sécurité — clé à rotationner |
| 9 | `local-*` : message d'erreur « env missing » conflate absence de clé et modèle inconnu | Cosmétique |

### Verdict global (fin Lot D) : **PARTIAL**
- OpenAI : **PROVEN LIVE**, vérification du modèle exécuté désormais réelle.
- Local vLLM : **PROVEN LIVE — PROVIDER PATH ONLY** (aucun agent persistant ne l'utilise).
- Gemini : **BROKEN** (clé fuitée) — garde-fou fallback intact.
- Mistral : **UNSUPPORTED / INERT** (correct).

## Lot sécurité — classification des 158 outils (preuve par implémentation)

Les « 158 outils » sont **37 noms distincts** dupliqués par copilot. Classification par
handler réel, jamais par nom. Résultat : la migration 0022 avait marqué les 158 lignes
`mutates=true` par DEFAULT — un état faux. Corrigé.

| Classification | Noms | Lignes | Preuve | mutates après | confirmation |
|---|---|---|---|---|---|
| **READ_ONLY_PROVEN** | 14 | 131 | handler `fetch` GET (repo), PostgREST GET (DB), provider GET public (marché) + doctrine UNAVAILABLE | `false` | non (low) |
| **MUTATING_PROVEN** | **0** | **0** | — aucun outil n'a d'écriture réelle prouvée — | — | — |
| **UNKNOWN_FAIL_CLOSED** | 22 | 25 | **aucun handler** — stubs proposés par l'architecte (`crm.*`, `alerts.*`, `buyers.*`, `matching.compute`, `*.read_output`, `*_bull21`…), jamais codés | `true` (conservé) | **true** (imposé) |
| **PROPOSES_ONLY (gated)** | 1 | 2 | `draft_copilot_spec` : handler réel, **ne persiste rien**, émet une proposition à valider | `true` (conservé volontairement) | true |

**Vérité de fond : `MUTATING_PROVEN = 0`.** Aucun outil du parc n'exécute d'écriture
réelle prouvée. Les 22 noms qui *sonnent* mutants (`crm.create_lead`, `reports.publish`,
`alerts.dispatch`…) sont des stubs sans implémentation. Fail-closed : ils restent
`mutates=true` + confirmation obligatoire, jamais reclassés sur la foi du nom.

**READ_ONLY_PROVEN — les 14 noms (131 lignes) passés `mutates=false` :**
`read_repo_file`, `list_repo_tree`, `search_repo`, `read_project_summary`,
`read_copilot_summary`, `read_recent_runs`, `read_tool_permissions`,
`read_market_snapshot`, `read_volatility_state`, `read_market_structure`,
`read_multi_timeframe_candles`, `read_liquidity_snapshot`, `read_macro_context`,
`read_account_risk_snapshot`.

### Confirmation rétroactive — invariant `mutates OR high OR critical ⇒ requires_confirmation`

Appliqué en transaction live (migrations 0023 puis 0024), preuve avant/après :

| Métrique | Avant | Après |
|---|---|---|
| `mutates=true` | 158 | **27** |
| `mutates=false` | 0 | **131** |
| `requires_confirmation=true` | 10 | **27** |
| violations de l'invariant | — | **0** |
| high/critical sans confirmation | — | **0** |

Le code d'authoring (`isHighRiskOrWriteCapableTool`) imposait déjà l'invariant à
l'écriture ; les lignes historiques n'avaient jamais été réconciliées. La migration 0024
est **strictement additive** (ajoute 17 confirmations, n'en retire aucune). Les 14 outils
read-only prouvés ne se voient imposer aucune confirmation.

## Lot E — HITL bout-en-bout (PROVEN LIVE contre le vrai Agent Server)

Deux runs réels pilotés via les routes `/run` + `/resume` (Next :3210 → LangGraph
Agent Server :2024), copilot `Agent Builder Copilot`, outil gated `draft_copilot_spec`.
Harnais reproductible : `scripts/aig005-hitl-proof.mjs`.

**Run REJECT — `e37d49db-75f3-4d73-bf58-4858dc0e2a35`**

| Étape | Observé | Preuve |
|---|---|---|
| run lancé | HTTP 200 | route `/run` |
| tool call détecté | `pendingTool = draft_copilot_spec` | réponse run |
| interruption + needs-confirmation | `status=needs-confirmation`, `interrupted=true` | réponse run |
| aucun effet avant décision | `tool_calls = []` **avant** resume | PostgREST |
| rejet humain | resume `{approved:false}` → HTTP 200 | route `/resume` |
| état final blocked | `agent_runs.status = blocked` | PostgREST |
| tool non exécuté | `tool_calls[draft_copilot_spec].status = blocked` (vrai nom, pas `tool`) | PostgREST |
| aucune écriture | copilots `38 → 38`, delta 0 | PostgREST |

**Run APPROVE — `5bd94ef5-9ca5-4970-b36d-bf18d732e205`**

| Étape | Observé | Preuve |
|---|---|---|
| interruption | `needs-confirmation` / `interrupted` / `draft_copilot_spec` | réponse run |
| approbation + reprise même thread | resume `{approved:true}` → `status=completed` | route `/resume` |
| tool exécuté | `tool_calls[draft_copilot_spec].status = ok` | PostgREST |
| aucune écriture | copilots delta 0 (le draft ne matérialise jamais un copilot) | PostgREST |

**Blocage forbidden (guardrail terminal)** — prouvé PROVEN TEST, sans OpenAI :
`tests/unit/runner-forbidden-actions.test.ts` + `tests/unit/langgraph-cost-ceiling.test.ts`,
**18/18 passés**. `approvalNode` + `toolsNode` re-screenent l'interdiction (double
barrière : gate + exécuteur), un forbidden n'est jamais confirmable ni exécuté.

### Trou révélé par le Lot E — chemin LangGraph : coût faux-zéro

Les deux runs HITL ont fait de **vrais appels OpenAI** mais persistent :
- `resolved_model = null` + `model_unverified = true` → **honnête** : la route documente
  (run/route.ts L216-218) que le chemin LangGraph n'a « no readable response metadata ».
  Le fix Lot B (vérification du modèle exécuté) ne couvre **que le chemin direct** ; côté
  LangGraph le modèle reste non vérifiable, et le code ne ment pas dessus.
- `cost_usd = 0` (colonne NON nulle) → **FAUX ZÉRO**. Un coût réel présenté comme 0 viole
  « donnée absente ≠ zéro ». Devrait être `null`/UNAVAILABLE. **Écart réel, non corrigé
  ici** (correctif hors périmètre budget — nécessite de câbler l'usage tokens du stream
  LangGraph ou d'écrire `null`). Consigné comme dette.

## Audit des 26 agents jamais exécutés

Classification par signaux DB (promotion, statut, draft, projet), aucun agent lancé en masse.

| Classe | Nombre | Signature | Lecture |
|---|---|---|---|
| **NEVER_RUN_EXPECTED** | 14 | `status=draft`, non promu, projet présent | drafts en cours — correctement non opérationnels |
| **NEVER_RUN_STALE** | 7 | `status=draft`, id `*-draft-*` (doublons) | artefacts d'authoring répétés (ex. 3× Design System Guardian) — obsolètes |
| **NEVER_RUN_MISLEADING** | 5 | `status=active` **+ promu** (`production_version_id`), 0 run | **exposés opérationnels dans l'UI, zéro preuve d'exécution** |

**Les 5 MISLEADING** (à valider ou rétrograder) : BTC Alert & Levels Sentinel,
Market Regime & Rotation Copilot, Portfolio Risk & Lock Advisor, Source Reliability &
Price Trust Sentinel, Withdrawal Review Copilot. Aucun supprimé (pas d'instruction).

## Matrice finale — verdict AIG-AGENT-QUALITY-005

| Dimension | Verdict | Preuve |
|---|---|---|
| OpenAI, chemin direct | **PROVEN LIVE** | run Atlas réel, modèle exécuté vérifié `gpt-5.4-2026-03-05` |
| Vérification du modèle exécuté (direct) | **PROVEN LIVE** | 1 run vérifié ; 137 anciens non backfillés |
| local vLLM | **PROVEN LIVE — PROVIDER PATH ONLY** | sonde router ; aucun agent persistant local |
| Gemini | **BROKEN — clé fuitée** | 403 leaked ; garde-fou fallback intact |
| Mistral | **UNSUPPORTED / INERT** | erreur typée |
| Fallback silencieux | **ABSENT (prouvé)** | 3 providers, aucun basculement muet |
| Classification outils | **PROVEN** | 14 READ_ONLY_PROVEN / 0 MUTATING_PROVEN / 23 UNKNOWN+gated |
| Invariant de confirmation | **PROVEN — 0 violation** | migrations 0023/0024, additif |
| HITL reject/approve | **PROVEN LIVE** | runs `e37d49db` / `5bd94ef5` |
| Blocage forbidden | **PROVEN TEST** | 18/18 unitaires |
| Coût chemin LangGraph | **BROKEN — faux zéro** | `cost_usd=0` sur appels OpenAI réels |
| Modèle vérifié (LangGraph) | **UNAVAILABLE (honnête)** | `model_unverified=true`, non falsifié |
| 26 agents jamais exécutés | **5 MISLEADING** identifiés | active+promu, 0 run |

### Verdict global : **PARTIAL** (inchangé, et c'est correct)

Restent ouverts, chacun maintenant *prouvé* plutôt que supposé : clé Gemini non tournée
(**SECURITY BLOCKER**), aucun agent Gemini/local persistant réel, coût LangGraph faux-zéro,
5 agents affichés opérationnels sans preuve. Le socle exécuté (OpenAI direct, HITL,
classification outils, invariant confirmation) est désormais PROVEN, pas déclaré.

---

# Lot F — vérité LangGraph, validation des agents actifs, consolidation

## Les cinq axes de vérité (distincts, jamais confondus)

- **AGENT QUALITY** — un agent qui s'exécute ≠ un agent capable. Les 5 promus tournent mais leur toolset ne remplit pas leur rôle.
- **PROVIDER PATH** — le router est multi-provider ; un seul provider (OpenAI) est exercé par de vrais agents.
- **RUNTIME SAFETY** — HITL, forbidden, invariant de confirmation : prouvés.
- **BUSINESS VALIDATION** — capacité métier réelle : absente pour les 5 promus (INVALID_CONFIGURATION).
- **CONFIGURATION ONLY** — 22 outils métier déclarés sans handler : config, pas capacité.

## F1 — coût LangGraph : faux zéro supprimé

Racine : `agent_runs.cost_usd NUMERIC NOT NULL DEFAULT 0` + `costFromMessages` estimait les tokens
depuis le contenu (0 pour un message tool-call vide) → **faux zéro**. Correctif :
- `costFromMessages` retourne **null** quand aucun message ne porte de `usage_metadata` (plus d'estimation contenu).
- Colonne rendue **nullable**, DEFAULT retiré (migration 0025).
- **26 faux zéros historiques → null**, règle prouvée `cost_usd=0 AND model_unverified=true` (les 26 l'étaient tous ; aucun vrai zéro mesuré n'existe ; jamais déduit du provider).
- `formatUsd(null) = "—"`, jamais `$0.00` ; agrégations excluent null.
- Prouvé : `cost-truth.test.ts` **5/5**, typecheck vert, migration live (**0 zéro restant**), et 5 runs F2 récents à coût **mesuré** (usage présent → coût réel) confirmant la branche non-null.

**Règle de persistance canonique** : coût mesuré → valeur réelle ; usage absent → `null` (unavailable) ;
modèle non lisible → `resolved_model=null` + `model_unverified=true`. Jamais 0 pour un inconnu.

## F2 — les 5 NEVER_RUN_MISLEADING (un run réel chacun)

| Agent | Run | Provider | model résolu | cost | tool calls | effet | Verdict |
|---|---|---|---|---|---|---|---|
| BTC Alert & Levels Sentinel | 5db98990 | openai | null (non lisible) | mesuré | 0 | aucun | **INVALID_CONFIGURATION** |
| Market Regime & Rotation | 6338506b | openai | null | mesuré | 0 | aucun | **INVALID_CONFIGURATION** |
| Portfolio Risk & Lock Advisor | 0d6671ba | openai | null | mesuré | 0 | aucun | **INVALID_CONFIGURATION** |
| Source Reliability & Price Trust | 87673d53 | openai | null | mesuré | 0 | aucun | **INVALID_CONFIGURATION** |
| Withdrawal Review Copilot | b803301e | openai | null | mesuré | 0 | aucun | **INVALID_CONFIGURATION** |

Tous **complètent sans erreur**, provider openai, **0 appel d'outil**, 0 tentative unsafe, **aucun effet**
(copilots 38→38). Mais leur toolset = **les 7 lecteurs de repo uniquement** — aucun outil marché, retrait
ou risque. Un « Withdrawal Review Copilot » qui ne peut que lire un repo ne peut pas réviser un retrait.
Ils s'exécutent mécaniquement ; leur capacité métier est **absente**. Aucun n'a été supprimé ni modifié
(l'intention produit appartient au propriétaire).

**Recommandation exacte** (non appliquée — décision du propriétaire) : soit rétrograder `status`
`active → draft` (retire la fausse apparence opérationnelle, réversible, données préservées), soit
attacher les outils marché/risque manquants pour que le toolset corresponde au rôle. Tant que ni l'un
ni l'autre, la vérité « 0 run » reste la seule garantie affichée.

## F3 — les 7 NEVER_RUN_STALE (aucune exécution, recommandation cleanup)

| Agent | Doublon | Type | Recommandation (non appliquée) |
|---|---|---|---|
| Design System Guardian ×3 | exact (même nom, proj-aigent-builder) | doublons exacts | garder 1 canonique, retirer 2 |
| Design System Consistency Guard | fonctionnel (rôle DS proche) | quasi-doublon | évaluer fusion avec Guardian |
| Google Ads Airport Strategy France | — | draft d'authoring abandonné | revue avant retrait |
| Prix au m² Estimation Agent | — | draft d'authoring abandonné | revue avant retrait |
| Security Sentinel | — | draft d'authoring abandonné | revue avant retrait |

**Rien supprimé** (pas d'autorisation). Tous accessibles via l'UI/API mais `status=draft`, non promus.

## F4 — Gemini (SECURITY BLOCKER maintenu)

**SECURITY BLOCKER — ROTATE GEMINI API KEY.** Vérifié :
- clé **absente** des fichiers suivis (`git grep AIza` = 0) et de l'historique (`git log -S` = 0) ;
- **absente** de mes scripts committés (aucune référence `GEMINI_API_KEY`/clé) ;
- code google **fail-closed** : `ProviderUnavailableError` si clé absente, `ModelAccessError` sur le 403, aucun fallback silencieux ;
- unique correspondance `AIza+35` = blob base64 dans un HTML d'avatars scratchpad éphémère (non-committé, faux positif).

Aucune rotation automatique (pas de credentials). Aucun nouvel appel Gemini tenté.

## Matrices finales

**1. Agents**

| | Nombre |
|---|---|
| Total | 38 |
| Réellement exécutés (≥1 run) | 12 avant mission + 5 validés cette mission = 17 |
| Jamais exécutés | 21 restants (14 EXPECTED + 7 STALE ; les 5 MISLEADING ont désormais tourné) |
| Validés cette mission | 5 (verdict INVALID_CONFIGURATION — exécutent mais sans capacité) |
| Misleading corrigés | 0 muté (recommandation posée, décision propriétaire) |
| Stale | 7 (recommandation cleanup) |

**2. Providers** — OpenAI : PROVEN LIVE (agents réels) · Gemini : BROKEN (clé) · local vLLM : PROVEN LIVE — PROVIDER PATH ONLY · Mistral : UNSUPPORTED/INERT.

**3. Modèles résolus** — direct : vérifié (`gpt-5.4-2026-03-05`) · LangGraph : `resolved_model=null` + `model_unverified=true` (honnête, pas de métadonnée lisible) · règle : jamais deviné.

**4. Outils** — 14 READ_ONLY_PROVEN / **0 MUTATING_PROVEN** / 22 UNKNOWN_FAIL_CLOSED / 1 PROPOSES_ONLY.

**5. Confirmation** — invariant `mutates OR high OR critical ⇒ requires_confirmation` : **0 violation** (migrations 0023/0024).

**6. HITL** — rejet (`e37d49db` → blocked, aucun effet) + approbation (`5bd94ef5` → completed, tool exécuté) : PROVEN LIVE ; forbidden : PROVEN TEST (18/18).

**7. Coûts** — direct : mesuré · LangGraph : mesuré si usage, sinon **null** · local : coût-0 fournisseur explicite · inconnus : **null**, jamais 0 · migration 0025 : 26 faux zéros → null.

**8. Agents jamais exécutés** — 14 EXPECTED · 7 STALE · 5 MISLEADING (désormais exécutés → INVALID_CONFIGURATION).

**9. Dettes** — `resolved_model` LangGraph non capturable (métadonnée absente) ; 5 agents à rétrograder/recâbler ; 7 stale à nettoyer ; 22 outils métier stubs.

**10. Bloqueurs externes** — **clé Gemini compromise** (rotation = propriétaire) ; aucun agent persistant Gemini/local.

## Ce que le rapport affirme explicitement

- Aigent **a** une architecture multi-provider fonctionnelle **dans le router**.
- **Aucun agent persistant Gemini ou local** n'existe.
- **Seul OpenAI** est actuellement exercé par de vrais agents.
- **local** est prouvé **seulement au niveau provider path**.
- **Gemini** est bloqué par secret compromis.
- Le **HITL est prouvé** (rejet + approbation, live).
- **Aucun outil mutatif réel** n'est actuellement implémenté (`MUTATING_PROVEN = 0`).
- **22 outils métier** sont encore des **stubs fail-closed**.
- **Cinq agents actifs** étaient sans preuve d'exécution (désormais exécutés, INVALID_CONFIGURATION).

## Gates

typecheck ✅ · lint ✅ · check:ds ✅ · check:catalyst ✅ · audit:dead ✅ (125 composants) ·
test ✅ (**1039/1039**, 86 fichiers). build/verify/health : exécutés en intégration dans `main`
(node_modules réel ; le build échoue en worktree uniquement sur le symlink node_modules, artefact de
worktree, pas un défaut de code).

## Verdict global

Le socle exécuté (OpenAI direct + vérification du modèle, HITL, classification des outils, invariant de
confirmation, coût honnête) est **PROVEN**. La couverture provider (Gemini/local sans agent réel) et la
qualité métier (5 agents sans capacité, 22 outils stubs) restent **incomplètes**. SUCCESS est interdit
tant que ces conditions subsistent — et elles subsistent.

AIG-AGENT-QUALITY-005: PARTIAL
