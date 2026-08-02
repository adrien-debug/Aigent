# AIGENT-OPUS-013 — passe QA bornée

> Observation datée, pas une règle. Une passe complète, close.
> Base : `origin/main` @ `1d1bb5b` (« Merge PR #82: AIGENT-CODEX-012 release candidate »).
> Branche : `mission/aigent-pixel-runtime-loop-013`, worktree isolé.

## Verdict — PARTIAL

Quatre défauts prouvés corrigés, un faux vert de gate fermé, deux défauts
prouvés **laissés ouverts** parce qu'ils exigent une décision produit (§ Ouverts).

## Vérification d'état initial

`origin/main` est bien à `1d1bb5b` — le SHA annoncé dans le prompt. Aucun écart.

## Défauts prouvés et corrigés

### D1 — Le badge de statut chevauchait le nom de l'outil · `/runtime?tab=visual-tooling`

La piste de statut était figée à `6.5rem` (104 px), une constante posée à la
main. `NOT_CONFIGURED` rend **123 px**.

Mesure à 1440×900 **avant** (`before-runtime-visual-tooling-1440x900.png`) :

| outil | statut | bord droit badge | début du nom | écart |
|---|---|---:|---:|---:|
| grafana | NOT_CONFIGURED | 449 | 442 | **−7 px** |
| n8n | NOT_CONFIGURED | 449 | 442 | **−7 px** |
| langgraph | RUNNING | 394 | 442 | +48 px |
| canvas-aigent | VERIFIED | 391 | 442 | +51 px |

À l'écran : « NOT_CONFIGUREDGrafana » et « NOT_CONFIGUREDn8n », soudés.

**Correction** : `sm:grid-cols-[6.5rem_…]` → `sm:grid-cols-[auto_…]`. Le plus
large des badges dimensionne la piste ; le `gap-x-3` redevient une gouttière
réelle. **Après** : les 7 lignes à **+12 px exactement**, aucun overflow.

### D2 — `needs-confirmation` rendu comme un état inactif · `/runs`

`src/lib/cockpit/status.ts` se déclare « une seule définition pour l'écran
ENTIER » et donne `needs-confirmation` → `SEVERITY.warn` (ambre). Trois fichiers
de `/runs` avaient recopié une échelle divergente :

| statut | autorité | `/runs` avant | effet |
|---|---|---|---|
| `needs-confirmation` | `warn` ambre | `muted` / `zinc` | un run **qui attend un humain** peint dans le registre le plus éteint |
| `blocked` | `blocked` violet | `warn` / `amber` | un verdict Sentinel **terminal** confondu avec un avertissement |
| `running` | `running` bleu | `sky` | dérive cosmétique, même cause |

`src/components/cockpit/run-stream.tsx` (accueil), lui, suivait l'autorité : le
**même run changeait de couleur entre l'accueil et `/runs`**.

**Correction** : les trois fichiers dérivent de `RUN_STATUS_COLOR` au lieu de le
recopier. Vérifié au rendu — les cinq pastilles de légende de `/runs` calculent
`#0da87f` · `#e8455f` · `#8e63ee` · `#3d82ee` · `#be850f`, exactement l'autorité.

### D3 — Faux vert de gate : `divide-white/N` invisible pour `check:legacy-design-doctrine`

La gate énumérait les préfixes un par un (`bg-` `text-` `border-` `stroke-`
`fill-`). `divide-` manquait. **Six** `divide-white/N` vivaient dans le produit
pendant que la gate affichait `0 violation(s)` **sur les fichiers qui les
contenaient**. La dérive que l'invariant existe pour empêcher avait déjà
commencé : cinq fichiers en `/5`, un en `/6`, pour le même séparateur.

**Sonde rouge** — réintroduction de `divide-white/5` :
```
factory-scan — src/components/projects/list-screen.tsx:122 — <utilitaire>-white/black interdit
```
**Sonde rouge 2** — `ring-white/10`, jamais couvert auparavant : détecté.
**Vert** après retrait des deux sondes.

**Correction** : une règle unique sur un jeu de préfixes
(`bg|text|border|stroke|fill|divide|ring|outline|shadow|accent|caret|decoration`),
plus les 6 occurrences migrées vers l'utilitaire `aig-line-soft`.

### D4 — `VERIFIED` contradictoire avec « jamais sondé » : **non retenu**

Examiné et **écarté après lecture du code**. La ligne Canvas rend
`VERIFIED · Canvas Aigent · fait démontrablement son travail · jamais sondé`.
« jamais sondé » vient du ternaire `checkedAt === null`, pas du vocabulaire de
statut. Canvas est une **surface embarquée, pas un service** : `checkedAt: null`
et `latencyMs: null` sont les valeurs *vraies*. Fabriquer un horodatage pour
faire joli serait la vraie violation. L'en-tête du panneau désamorce
explicitement la lecture erronée. **Aucune correction — le code a raison.**

## Défauts prouvés, laissés OUVERTS (décision produit)

### O1 — `not_configured` : gris sur `/learning`, **rouge** sur `/runtime`

Même type `TelemetryHealthStatus`, deux échelles :
- `src/components/learning/learning-screen.tsx:74` → `not_configured: 'zinc'`
- `src/components/runtime/tab-telemetry.tsx:34` → `not_configured: 'red'`

Un `AIGENT_RUNTIME_TELEMETRY_TOKEN` absent se lit « rien d'inquiétant » sur un
écran et « panne » sur l'autre. **Il n'existe aucune autorité** pour ce type —
c'est pourquoi les deux fichiers ont divergé. Trancher, c'est décider ce que le
produit *affirme* quand un canal n'est pas configuré : absence de mesure (gris,
cohérent avec la doctrine « une valeur non mesurée reste `null` ») ou défaut
d'exploitation (rouge). Non tranché sans Adrien.

### O2 — `unavailable` s'oppose à lui-même dans la MÊME page

`learning-screen.tsx` : `TELEMETRY_COLOR.unavailable = 'zinc'` (ligne 76) et
`RUNTIME_COLOR.unavailable = 'red'` (ligne 340) — deux panneaux empilés,
même libellé partagé, deux couleurs opposées. Le gris est celui qui respecte la
doctrine (« je n'ai pas pu savoir » n'est pas une panne). Même décision que O1.

## Preuves

64 combinaisons route × viewport, navigateur réel, backend réel :

| | |
|---|---|
| routes | 16 (12 statiques + onglets runtime + lab) |
| viewports | 1440×900 · 1280×800 · 1280×600 · 375×812 |
| overflow horizontal | **0** |
| erreurs console | **0** |
| requêtes ≥ 400 | **0** |
| erreurs de page | **0** |

`npm run check` — 16 gates, vert. `gitleaks` : 1173 commits, aucun secret.
`npm run test` — **183 fichiers, 2343 passés, 1 expected fail, 0 échec.**
`npm run build` — vert.

Captures : `before-*` / `after-*`, aux 4 viewports, correspondant au HEAD de la
branche.

## Limites de cette passe — ce qui n'est PAS prouvé

- **`/runs` a été mesuré sur une liste VIDE** (`a[href*="?run="]` = 0). Les
  couleurs de statut sont vérifiées sur les pastilles de légende, qui rendent
  toujours ; les rails de ligne sont corrigés par dérivation mais **non observés
  sur des données réelles**. Un run `blocked` ou `needs-confirmation` réel n'a
  pas été rendu à l'écran.
- Aucune gate ne mesure le rendu ; la vérification pixel est ce document, pas
  une gate qui se rejouera.
- Interactions clavier et lecteurs d'écran : non couverts par cette passe.
- `check:tool-rows` / `check:tool-definitions` (base live) non lancés.
- Les états `hover` / `active` / `disabled` n'ont pas été parcourus un par un.
