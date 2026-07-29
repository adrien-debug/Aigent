# Les gates de ce repo — et ce qu'elles ne voient pas

> Ce fichier est la **carte des angles morts**, pas un catalogue de features.
> Une gate verte est une information étroite : elle dit *« la règle que j'implémente
> n'est pas violée »*, jamais *« l'écran est bon »*. Ce document existe parce que ce
> repo a déjà vécu l'inverse — `typecheck` + `lint` + `build` + 1483 tests + CI
> **tous verts sur un graphique mort en runtime** — et parce qu'il a déjà supprimé
> une gate creuse (`test:storybook-unit` terminé par `|| true`, incapable d'échouer
> tout en occupant une ligne de `npm run check`).
>
> Règle de lecture : **la colonne « ne garantit PAS » est la colonne utile.**
>
> **P007 (teardown frontend, 29/07/2026)** — le dashboard legacy
> (`src/app/admin/**`, `src/components/agent-ops/**`, `src/components/views/**`,
> `src/components/shell/**`) a été supprimé. Les gates qui ne gardaient QUE ce
> périmètre (`check:ds`, `check:catalyst`, `check:danger`, `check:tables`,
> `check:class-collision`, `check:charts`, `check:surfaces`, `check:headings`,
> `check:a11y`/`check:contrast`, `check:views`, `check:legacy-bridge`, et les chaînes
> `check:browser`/`check:pending` qui les regroupaient) ont été supprimées avec lui —
> elles n'existent plus dans `package.json`. Ce fichier ne documente plus que les
> gates qui gardent du backend/business vivant.

---

## 1. Où chaque gate est câblée

| Chaîne | Contenu | Bloque quoi |
| --- | --- | --- |
| `npm run check` | typecheck · lint:fast · lint · no-legacy-front · agent-truth · render-truth · status-truth · registry-parity · registry-integrity · tool-rows · tool-definitions · rsc-boundary · secrets · audit:dead | CI (`.github/workflows/ci.yml`) + pré-livraison |

---

## 2. Carte des gates

| Gate | Garantit | Ne garantit PAS |
| --- | --- | --- |
| `check:no-legacy-front` | aucun import d'une couche visuelle démolie par P006, aucune route `/admin-v2`, aucune route admin démolie recréée sur disque | qu'un écran neuf soit bon — seulement qu'il ne ressuscite pas l'ancien |
| `check:rsc-boundary` | aucun Server Component ne passe une prop **fonction** à un Client Component | les autres valeurs non sérialisables ; et il ne résout les identifiants que localement |
| `check:status-truth` | un libellé de statut affiché vient de `labels.ts`, jamais d'une chaîne écrite sur place | que le statut affiché soit **vrai** — seulement qu'il soit dit dans un seul vocabulaire |
| `check:render-truth` | aucune absence de mesure n'est rendue comme un 0 / `NaN` / une phrase affirmative | que la donnée présente soit juste |
| `check:agent-truth` | aucun import de `market/dropship/agents/roster` et aucune lecture de `delivery/tradeagent/**` depuis `src/app`/`src/components` ; aucun provider/modèle littéral **assigné** (`=`, `:`) **ni retombé par `??`/`\|\|`** dans `available-agents.ts` ; **et que les 236 fichiers runtime + le contrat canonique + les 4 cibles protégées ont bien été ouverts** | que les agents servis soient **exécutables**. Elle lit **ligne à ligne** : un défaut fabriqué via une fonction, un ternaire, une constante déclarée ailleurs, ou une chaîne concaténée reste invisible. Elle ne regarde le check 3 que dans **un seul fichier** — le même défaut ailleurs dans `src/lib` passe |
| `check:registry-parity` | **les 3** familles composant `RUNNABLE_TOOL_NAMES` (5 natifs + 9 market + 3 realestate) sont buildables par `REGISTRY_IDS` — valeurs **importées** du `.mjs`, plus regex ; parité **bidirectionnelle** market ET realestate ; **et que la composition de `RUNNABLE_TOOL_NAMES` n'a pas gagné une 4ᵉ source non couverte** ; **et qu'aucun ensemble parsé n'est tombé sous son minimum** | que l'outil **fonctionne** (handler juste, provider joignable, description exploitable par le modèle). Ni que l'assistant LangGraph existe — c'est l'absence d'assistant, pas le runtime, qui produit `tool_call_count=0`. Les handlers TS restent lus **en source** : leur forme est bornée par un compte minimal, pas comprise |
| `check:registry-integrity` | canonique ⟺ `.mjs` exécutable ⟺ union `BehaviorToolId` ⟺ union `AgentRuntime` (22 outils, 4 runtimes, **valeurs réelles** via `tsx`) ; semver, `secretRefs` UPPER_SNAKE, `kind`/`risk`/`mutates`/`requiresConfirmation`/`certification` valides **sur tous les outils** ; **`mutates: true` ⇒ `requiresConfirmation: true`** ; **et qu'aucun ensemble n'est vide** | que les **lignes `tools`** en base soient conformes (c'est `check:tool-rows`) ; que la classification déclarée soit **vraie** (`mutates: false` est une affirmation humaine, rien ne la vérifie contre le handler) ; que l'outil s'exécute |
| `check:tool-rows` | les lignes `tools` réellement provisionnées ne contredisent pas le registre canonique | rien quand la base est vide ou injoignable |
| `check:secrets` | `gitleaks` sur tout l'historique + hook `pre-commit` sur l'index | un secret qu'aucune règle gitleaks ne décrit |
| `audit:dead` | aucun composant non référencé | le code mort *à l'exécution* (une branche jamais atteinte reste « référencée ») |

---

## 3. Comment on sonde une gate — dans les DEUX sens

Une gate n'a de valeur que si on a vu **les deux verdicts**. Trois sondes, toujours :

1. **ROUGE** — le défaut réel est présent → la gate sort **1** et **nomme `fichier:ligne`**.
2. **VERTE** — le défaut corrigé (ou un périmètre propre) → la gate sort **0**.
3. **ANTI-TAUTOLOGIE** — un cas *qui ressemble au défaut mais est légitime* → la gate
   sort **0**. Sans cette troisième sonde, une gate qui échoue toujours et une gate qui
   passe toujours sont indiscernables d'une gate qui marche.

### Les gates métier — jamais LUES avant le 26/07/2026

`check:agent-truth`, `check:registry-parity` et `check:registry-integrity` étaient
dans `npm run check` depuis des semaines, **exécutées et jamais relues**. Elles
passaient. Deux d'entre elles passaient pour de mauvaises raisons.

**Méthode** : pour chaque garantie annoncée, casser réellement la chose gardée dans un
fichier du repo, exiger **exit 1** avec un message qui nomme le coupable, restaurer,
exiger **exit 0**. Aucune sonde n'a été jugée sur la lecture du code seule.

#### Le défaut de premier ordre trouvé

**`check:registry-parity` était aveugle à une famille d'outils entière.**
`RUNNABLE_TOOL_NAMES` (`available-agents.ts`) est l'union de `NATIVE_TOOL_NAMES` +
`TRADING_TOOL_HANDLERS` + `REALESTATE_TOOL_HANDLERS`. La gate ne comparait que les
handlers **trading**, contre un ensemble « buildable » qu'elle recomposait à la main
(`MARKET_TOOL_SPECS` ∪ clés littérales de `REGISTRY`) — en **oubliant** les ids étalés par
`...REALESTATE_TOOL_IDS`. Preuve mesurée : un handler `read_flood_risk` ajouté aux
handlers immobiliers — donc *runnable* pour le catalogue, monté par **rien** côté graphe —
laissait la gate **verte**. C'est mot pour mot la panne qu'elle existe pour empêcher
(agent `active`, `tool_call_count = 0`, « pas de données »), sur toute une famille.
Le commentaire d'`available-agents.ts` qui promet « cette liste ne peut pas dériver dans
ce mensonge sans qu'on le remarque » était donc **faux pour l'immobilier**.
→ Corrigé : l'ensemble buildable est maintenant **importé** (`REGISTRY_IDS`, valeurs
réelles), les trois familles sont comparées, et une 4ᵉ source ajoutée à
`RUNNABLE_TOOL_NAMES` fait échouer la gate tant que personne ne l'a couverte.

#### Cécité par parsing — la panne rejouée

`check:registry-parity` scrapait ses ids avec `^\s{2}([a-z_0-9]+):`. Ses helpers
renvoyaient `[]` — et non `null` — quand l'indentation changeait : **∅ comparé à ∅ passe
pour de la parité**. Preuve : les mêmes ids ré-indentés d'un cran faisaient tomber le
compte affiché de 19 à **10 buildable ids**… avec un ✓ vert.
Même famille de trou dans `check-agent-truth` (le check 3 est ancré sur un chemin en dur :
renommer `available-agents.ts` le supprimait, gate verte — mesuré) et dans
`check-registry-integrity` (toutes ses vérifications sont des boucles ; une boucle sur ∅
est verte par construction).
→ Corrigé partout : **compte minimal obligatoire** sur chaque ensemble indexé, et un
message qui dit explicitement « une gate qui indexe 0 élément doit ÉCHOUER ».

#### Table des sondes (26/07/2026, toutes rejouées après correction)

| Gate | Ce qu'on a cassé | AVANT correctif | APRÈS correctif |
| --- | --- | --- | --- |
| `agent-truth` | `import … from '…/market/agents/roster'` dans `src/app/admin/page.tsx` | exit 1 ✓ | exit 1 ✓ |
| `agent-truth` | lecture `'delivery/tradeagent/latest.json'` dans un fichier runtime | exit 1 ✓ | exit 1 ✓ |
| `agent-truth` | `const m = { model: "gpt-5.4" }` dans `available-agents.ts` | exit 1 ✓ | exit 1 ✓ |
| `agent-truth` | `const p = resolved.provider ?? "openai"` (même fichier) | **exit 0 — raté** | exit 1 ✓ |
| `agent-truth` | `available-agents.ts` renommé (le check 3 disparaît) | **exit 0 — aveugle** | exit 1, « le contrat canonique n'a pas été rencontré » |
| `registry-parity` | handler `read_flood_risk` ajouté à `REALESTATE_TOOL_HANDLERS` | **exit 0 — aveugle** | exit 1, dérive REALESTATE + non-buildable |
| `registry-parity` | `read_macro_context` retiré de `TRADING_TOOL_HANDLERS` | exit 1 ✓ | exit 1 ✓ (+ compte sous le minimum) |
| `registry-parity` | ids ré-indentés d'un cran (mêmes ids, forme changée) | **exit 0 — 19 → 10 buildable, ✓ vert** | exit 1, « 0 id(s) indexé(s), minimum 9 » |
| `registry-parity` | 4ᵉ source `FUTURE_TOOL_HANDLERS` dans `RUNNABLE_TOOL_NAMES` | **exit 0 — non couverte** | exit 1, « source NON couverte par la gate » |
| `registry-integrity` | `phantom_tool` ajouté au `REGISTRY` du `.mjs` | exit 1 ✓ | exit 1 ✓ |
| `registry-integrity` | `'read_macro_context'` retiré de l'union `BehaviorToolId` | exit 1 ✓ | exit 1 ✓ |
| `registry-integrity` | `mutates: true` + `requiresConfirmation: false` sur un outil | **exit 0 — champs extraits, jamais lus** | exit 1, « a write with no human gate » |
| `registry-integrity` | union `BehaviorToolId` remplacée par `= string` | non sondé | exit 1, « 0 élément(s) indexé(s), minimum 22 » |
| `registry-integrity` | lancée depuis `src/` | exit 1 (bruyant, pas aveugle) | exit 0 — racine ancrée sur le script |

Toutes les mutations ont été restaurées ; `git status` propre après chaque sonde, et les
trois gates repassent **vert** sur le repo réel.

#### Ce que ces gates ne garantiront jamais

Elles sont **statiques**. Aucune ne lance un agent, aucune n'appelle un outil, aucune ne
touche la base. En particulier :

- un outil parfaitement enregistré des deux côtés peut **échouer à chaque appel** — c'est
  le piège documenté dans `AGENTS.md` : sans assistant provisionné, un copilot `langgraph`
  tourne contre le graphe nu. **Aucune de ces gates ne détecte l'assistant manquant** ;
- `mutates: false` est une **affirmation humaine** : rien ne la confronte au handler ;
- `check:agent-truth` prouve qu'aucun roster n'est *importé*, pas que ce qui est servi est
  exécutable.

---

## 4. Ce qu'aucune gate ne garde ici

À énoncer tel quel, sans l'arrondir :

- **qu'un agent puisse réellement exécuter ses outils** — `check:registry-parity` et
  `check:registry-integrity` prouvent que les *listes* s'accordent, jamais qu'un assistant
  LangGraph est provisionné. Le symptôme documenté (`tool_call_count = 0`, « pas de
  données », agent d'apparence saine) reste possible avec les deux gates vertes ;
- **que les classifications du registre canonique soient vraies** — `mutates`, `risk`,
  `kind` sont déclarés à la main ; la gate vérifie leur *forme* et leur *cohérence*
  interne, jamais leur correspondance avec ce que le handler fait vraiment.
