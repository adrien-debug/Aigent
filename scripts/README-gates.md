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
> **Teardown frontend (29/07/2026)** — le dashboard legacy a été supprimé, puis le
> reset complet du front a retiré tout `src/components/`. Les gates qui ne
> gardaient QUE ce périmètre ont été supprimées avec lui.
>
> **Ménage de gouvernance (30/07/2026)** — sept gates orphelines survivaient dans
> `package.json` en pointant sur des fichiers effacés. Elles ont été **supprimées
> du repo** : `check:console-branding`, `check:console-design-system`,
> `check:chart-empty-guard`, `check:empty-state-explained`,
> `check:error-state-not-usable`, `check:no-zero-fallback-states`,
> `check:status-truth`. Cinq d'entre elles étaient rouges en permanence (dont une
> qui crashait sur une `ENOENT` Node brute) ; deux passaient **vertes par
> vacuité** en nommant des répertoires qu'elles n'avaient jamais ouverts. Ce
> fichier ne documente plus que les gates qui gardent quelque chose de vivant.

---

## 1. Où chaque gate est câblée

**`package.json` fait foi, pas ce tableau.** Pour la composition exacte :
`node -e "console.log(require('./package.json').scripts.check)"`.

| Chaîne | Contenu | Bloque quoi |
| --- | --- | --- |
| `npm run check` | typecheck · lint:fast · lint · no-legacy-front · ui-kit-integrity · agent-truth · lifecycle-truth · registry-parity · registry-integrity · dev-port · render-truth · **rsc-boundary** · secrets · audit:dead | CI (`.github/workflows/ci.yml`) + pré-livraison |
| `npm run verify` | `check` + quality:dead (knip) + test (vitest offline) + build | pré-intégration quand le build ou une surface de rendu bouge |

**La chaîne `check` est entièrement statique et hors ligne.** Deux gates en ont
été retirées le 30/07/2026 parce qu'elles interrogeaient la base live :

| Commande | Pourquoi hors chaîne |
| --- | --- |
| `check:tool-rows` | appel réseau vers PostgREST gpu1 ; s'auto-skippe (exit 0) sans backend, donc **vacuité systématique en CI** — précisément là où elle prétendait protéger. Un `fetch` non gardé y produisait une stack undici brute en cas de coupure. |
| `check:tool-definitions` | même diagnostic, même second `fetch` non gardé. |

Ce sont désormais des **commandes d'exploitation**, à lancer volontairement pour
auditer la base. ⚠️ Leur option `--fix` **ÉCRIT en base** (PATCH/POST sur `tools`
et `tool_definitions`) : sans `--fix` elles sont en lecture seule, avec `--fix`
elles ne sont plus un audit.

**`check:rsc-boundary` est entrée dans la chaîne le 31/07/2026.** Elle était
restée hors chaîne tant que le front était vide ; le cockpit lui a rendu une
cible (46 composants client, Recharts compris), donc elle garde de nouveau
quelque chose de vivant. La sonde qui l'a rebranchée a trouvé un **trou de
premier ordre** — voir §3.

---

## 2. Carte des gates

| Gate | Garantit | Ne garantit PAS |
| --- | --- | --- |
| `check:no-legacy-front` | aucun import d'une couche visuelle démolie, aucune route admin recréée sur disque, et la présence positive des 3 fichiers du squelette | qu'un écran neuf soit bon — seulement qu'il ne ressuscite pas l'ancien |
| `check:rsc-boundary` | aucun Server Component ne passe une prop **fonction** à un Client Component — dans les trois formes : arrow inline, `function` expression, et référence à une fonction locale. Le scan de tag est **brace-aware** (voir §3 : la version regex était aveugle aux arrows) | qu'une prop fonction atteinte **indirectement** traverse : une fonction rangée dans un objet (`config={{ format: f }}`), passée via spread (`{...props}`), ou dont l'identifiant est importé plutôt que déclaré localement, reste invisible. Elle ne dit rien du contenu du composant client, ni du rendu |
| `check:render-truth` | dans `src/lib/runs-console/**`, `src/lib/cockpit/**` et `src/components/cockpit/**` (15 fichiers) : aucune absence de mesure rendue comme un 0, un `NaN` ou une phrase affirmative. **Échoue si une racine de scan a disparu ou si 0 fichier a été lu**. Exempte une seule forme, la somme courante `x.m = (x.m ?? 0) + …`, qui ne peut pas publier de zéro (§3) | que la donnée présente soit juste ; et **rien dans les gros agrégateurs** — `dashboard-overview.ts`, `agent-detail.ts` et `data.ts` alimentent le cockpit et ne sont scannés par AUCUNE gate : un faux zéro né là arrive ici déjà blanchi. Elle lit **ligne à ligne** : un `?? 0` posé sur deux lignes, ou via une variable intermédiaire, passe |
| `check:lifecycle-truth` | 5 mensonges précis interdits dans `agent-lifecycle-trace.ts` : « deployed » sans preuve consommateur, « healthy » sans diagnostic réel, faux zéro télémétrie, « promoted » déconnecté d'une version de prod, `active_in_consumer` calculé autrement que le littéral `'unknown'` | quoi que ce soit **hors de ce fichier unique** — sa portée est d'un seul module, pas du domaine lifecycle |
| `check:dev-port` | le port de dev est épinglé à 3987 dans les 4 resolvers, et aucun des trois ports interdits (3000, 3001, 3210 — jamais binder, jamais sonder) n'apparaît en code vif ou en doctrine ; **échoue si un resolver a disparu** | qu'un serveur tourne réellement sur 3987 — c'est une gate statique |
| `check:agent-truth` | aucun import de `market/dropship/agents/roster` et aucune lecture de `delivery/tradeagent/**` depuis `src/app`/`src/components` ; aucun provider/modèle littéral **assigné** (`=`, `:`) **ni retombé par `??`/`\|\|`** dans `available-agents.ts` ; **et qu'un nombre non nul de fichiers runtime + le contrat canonique + les 4 cibles protégées ont bien été ouverts** (le compte exact est affiché à l'exécution — ne le fige pas ici, il dérive) | que les agents servis soient **exécutables**. Elle lit **ligne à ligne** : un défaut fabriqué via une fonction, un ternaire, une constante déclarée ailleurs, ou une chaîne concaténée reste invisible. Elle ne regarde le check 3 que dans **un seul fichier** — le même défaut ailleurs dans `src/lib` passe |
| `check:registry-parity` | **les 3** familles composant `RUNNABLE_TOOL_NAMES` (5 natifs + 9 market + 3 realestate) sont buildables par `REGISTRY_IDS` — valeurs **importées** du `.mjs`, plus regex ; parité **bidirectionnelle** market ET realestate ; **et que la composition de `RUNNABLE_TOOL_NAMES` n'a pas gagné une 4ᵉ source non couverte** ; **et qu'aucun ensemble parsé n'est tombé sous son minimum** | que l'outil **fonctionne** (handler juste, provider joignable, description exploitable par le modèle). Ni que l'assistant LangGraph existe — c'est l'absence d'assistant, pas le runtime, qui produit `tool_call_count=0`. Les handlers TS restent lus **en source** : leur forme est bornée par un compte minimal, pas comprise |
| `check:registry-integrity` | canonique ⟺ `.mjs` exécutable ⟺ union `BehaviorToolId` ⟺ union `AgentRuntime` (22 outils, 4 runtimes, **valeurs réelles** via `tsx`) ; semver, `secretRefs` UPPER_SNAKE, `kind`/`risk`/`mutates`/`requiresConfirmation`/`certification` valides **sur tous les outils** ; **`mutates: true` ⇒ `requiresConfirmation: true`** ; **et qu'aucun ensemble n'est vide** | que les **lignes `tools`** en base soient conformes (c'est `check:tool-rows`) ; que la classification déclarée soit **vraie** (`mutates: false` est une affirmation humaine, rien ne la vérifie contre le handler) ; que l'outil s'exécute |
| `check:tool-rows` *(hors chaîne, réseau)* | les lignes `tools` réellement provisionnées ne contredisent pas le registre canonique | **rien du tout quand la base est injoignable ou non configurée** — elle sort 0 en s'annonçant SKIPPED. Ne la lis jamais comme une preuve en CI |
| `check:tool-definitions` *(hors chaîne, réseau)* | le catalogue `tool_definitions` en base est aligné sur le registre, et chaque montage porte sa FK | même angle mort : SKIP silencieux sans backend |
| `check:secrets` | `gitleaks` sur tout l'historique + hook `pre-commit` sur l'index | **un secret qu'aucune règle gitleaks ne décrit** — ce n'est pas théorique : un mot de passe de dev écrit en prose dans un `.md` est resté versionné des semaines avec cette gate verte (`docs/HANDOFF-agents-platform.md`, supprimé le 30/07/2026) |
| `audit:dead` | aucun composant non référencé — elle s'est réarmée avec le cockpit et vérifie **9 composants** (le compte est affiché à l'exécution, ne le fige pas ici) | le code mort *à l'exécution* — une branche jamais atteinte reste « référencée ». Le code mort général est couvert par knip (`npm run quality:dead`) |

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

> **Relevé daté — ce n'est pas l'état courant.** Les chemins cités ci-dessous
> (`src/app/admin/page.tsx`…) étaient les cibles de sonde à cette date ; le reset
> frontend les a supprimés depuis. La valeur de ce tableau est la **méthode** et
> les défauts qu'elle a révélés, pas les chemins.

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

### Rebranchement des deux gates de rendu (31/07/2026)

Les deux gates qui gardent le rendu ont été sondées et corrigées en rebranchant
le cockpit. **Les deux étaient vertes pour de mauvaises raisons.**

#### `check:rsc-boundary` — aveugle à l'arrow inline, la forme la plus courante

La gate existe pour attraper le bug du 26/07/2026 (`TrendChart cy="NaN"` :
typecheck + build + 1483 tests + CI verts sur un chart mort au rendu client).
Sonde : une prop fonction passée à `<HourlyRunsChart>` (module `'use client'`,
Recharts) depuis `overview-screen.tsx`, un Server Component.

| Forme sondée | AVANT correctif | APRÈS correctif |
| --- | --- | --- |
| `tickFormatter={formatTick}` (référence locale) | exit 1 ✓ | exit 1 ✓ |
| `tickFormatter={(v) => \`${v}\`}` (**arrow inline**) | **exit 0 — aveugle** | exit 1 ✓ |
| `buckets={buckets.map((b) => ({...b}))}` (anti-tautologie : arrow **dans** une expression de données, légitime) | exit 0 ✓ | exit 0 ✓ |

**Cause racine** : le scan de tag était `<([A-Z]\w*)\b([^>]*?)\/?>`. La classe
`[^>]` s'arrête au premier `>` du source — et `=>` en contient un. Les props
étaient donc tronquées à `tickFormatter={(v) =` et l'arrow disparaissait : le
test `isArrow` du script était **du code mort**, jamais atteignable. Même trou
sur `(\w+)=\{([^}]*)\}`, qui coupait toute valeur contenant un objet.
→ Corrigé : lecture du tag et des props avec **suivi de profondeur d'accolades**
(`readTagProps`, `matchProps`), seule façon de rendre le cas arrow atteignable.

#### `check:render-truth` — ne scannait que 4 fichiers sur un cockpit vivant

Périmètre étendu de `src/lib/runs-console` (4 fichiers) à `+ src/lib/cockpit` et
`+ src/components/cockpit` (**15 fichiers**). L'extension a produit **une seule**
remontée, jugée **faux positif** :

| Remontée | Arbitrage |
| --- | --- |
| `src/lib/cockpit/named-runs.ts:138` — `card.costUsd = (card.costUsd ?? 0) + run.costUsd` | **Faux positif.** L'accumulateur est semé à `null`, la ligne n'est atteinte que sous un `if (run.costUsd !== null && !== undefined)`, et si aucun run ne porte de coût la carte reste `null`. Le 0 est l'identité de `+`, pas une affirmation sur la mesure. **Rien corrigé dans `src/`** |

La règle a été **affinée, pas affaiblie** : seule la somme courante
`x.m = (x.m ?? 0) + …` est exemptée, via une backreference qui exige **le même
champ des deux côtés du `=`** et un `+` immédiat. Les trois sosies dangereux
restent rouges, vérifiés : `card.costUsd = other.costUsd ?? 0`,
`card.costUsd = (card.costUsd ?? 0)` sans `+`, et
`total.costUsd = (card.costUsd ?? 0) + x` sur un autre champ.

Les trois règles ont ensuite été sondées **dans le nouveau périmètre** en
injectant le défaut dans `src/components/cockpit/rows.tsx` — coercition
`Number(card?.costUsd)` → exit 1 ; `formatUsd(card.costUsd ?? 0)` → exit 1 ;
`: 'never run'` → exit 1. Toutes les mutations restaurées, `git status` propre.

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
