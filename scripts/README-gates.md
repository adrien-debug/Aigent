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

---

## 1. Où chaque gate est câblée

| Chaîne | Contenu | Bloque quoi |
| --- | --- | --- |
| `npm run check` | typecheck · lint:fast · lint · ds · catalyst · headings:static · legacy-bridge · views · agent-truth · danger · render-truth · status-truth · registry-parity · registry-integrity · tool-rows · charts · rsc-boundary · secrets · audit:dead | CI (`.github/workflows/ci.yml`) + pré-livraison |
| `npm run check:browser` | headings (complet) · surfaces · **a11y (ROUGE)** | rien : exige un serveur de dev, jamais dans la CI |
| `npm run check:pending` | tables · class-collision | rien : les deux sont ROUGES, donc **délibérément hors de `check`** |

**Pourquoi `check:tables` et `check:class-collision` ne sont PAS dans `check` (26/07/2026).**
Les deux sont justes et sondées dans les deux sens (§3). Elles sont rouges parce que le
code l'est : 2 en-têtes sticky piégées, 83 overrides `className` morts. Les câbler
maintenant rendrait `npm run check` rouge pour tout le monde, et la pression suivante
serait de gonfler l'allowlist — exactement la triche que ce repo a déjà supprimée. Elles
vivent donc en scripts autonomes, avec un `check:pending` qui les lance ensemble.
**Le jour où `npm run check:pending` sort 0, la seule chose à faire est d'ajouter
`&& npm run check:tables && npm run check:class-collision` à la fin de `check`.** Rien
d'autre : les deux gates sont déjà indépendantes du serveur, sans dépendance, et dotées
d'une allowlist à justification obligatoire.

**Pourquoi `check:a11y` n'est nulle part.** Elle mesure des **pixels** : elle pilote un
navigateur et lit les styles calculés (c'est ce qui lui permet de voir `oklch()`,
`color-mix()`, les alphas empilés et l'`opacity` d'un ancêtre — invisibles à tout grep).
Elle exige donc un serveur de dev, et elle est **ROUGE** : 51 glyphes sous AA sur 6
routes / 6, mesurés entre 3,59:1 et 4,02:1 pour un seuil de 4,5. La phrase honnête à
dire est : **le contraste AA de ce dashboard n'est pas gardé aujourd'hui.**

```bash
npm run dev                                        # arbre principal, port 3210
npm run check:a11y                                 # verdict + navigateur
npm run check:a11y -- --base http://localhost:3230 # depuis un worktree d'agent
npm run check:a11y -- --emit /tmp/contrast.json    # garder la capture
npm run check:a11y -- --input /tmp/contrast.json   # re-verdict sans navigateur
```

`check:a11y` ajoute au-dessus de `check-contrast.mjs` un **préflight** : sans serveur
elle sort **2** (« je n'ai pas pu mesurer ») et jamais **1** ni **0**, pour qu'une
absence de mesure ne puisse pas se lire comme un succès.

---

## 2. Carte des gates

### Périmètre dashboard
Partout ci-dessous, « dashboard » = `src/app/admin/**`, `src/components/agent-ops/**`,
`src/components/views/**`, `src/components/shell/**`. Le marketing
(`src/app/(site)/**`, `src/components/marketing/**`) suit une convention **différente et
volontaire** : aucune de ces gates ne le scanne, et ce n'est pas un oubli.

| Gate | Garantit | Ne garantit PAS | Sonde |
| --- | --- | --- | --- |
| `check:ds`<br>`check-palette.mjs` | aucune teinte hors `accent`/`zinc` dans `src` ; la rampe accent de `theme.css` est complète, ancrée sur `#A7FB90`, monotone ; **3 paires codées en dur** passent AA | **le contraste des écrans.** Il calcule 3 paires sur la rampe accent, point. Aucune page, aucun plan de surface, aucun texte réellement rendu. Dire qu'il « vérifie les contrastes AA » est faux | ajouter `text-sky-500` dans un fichier `src/` → rouge ; le retirer → vert |
| `check:catalyst` | zéro `<button>/<input>/<select>/<textarea>/<table>` natif dans le dashboard ; spacing sur l'échelle fixe | qu'une primitive soit **bien employée**. Un `<Button>` invisible, mal contrasté ou sans libellé passe | poser un `<button>` natif dans `agent-ops/` → rouge |
| `check:danger` | un échec / une destruction porte `--state-danger-*`, jamais l'accent | que le rouge soit *lisible*, ni qu'un vrai échec soit signalé quelque part | peindre un `role="alert"` en `accent-500` → rouge |
| `check:tables` | une `<TableHead sticky top-*>` est adossée à un `<Table fixed>` ; une `<TableRow hover:bg-*>` est navigable (`href`) ; une colonne responsive partage le breakpoint de son en-tête | **la lecture SOURCE seulement.** Un `fixed={someProp}`, un className construit à l'exécution, un wrapper dont l'`overflow` est décidé au runtime lui sont invisibles. Et une sticky correctement adossée n'est pas pour autant *jolie* | §3 |
| `check:class-collision` | aucun `className` LITTÉRAL d'appelant n'est écrasé par un défaut inline de la primitive (`clsx(className, …)`) | **les pixels.** Elle raisonne sur des familles CSS, jamais sur la feuille compilée. Aveugle aux className calculés, aux maps par prop (`colors[color]` de Badge/Button) et aux défauts venant d'une **const de module** (les `rounded-xl`/`bg-white`/`ring-1` de `surfaceRaised` ne sont pas indexés, donc un `<Panel className="rounded-lg">` — mort en fait — n'est pas signalé) | §3 |
| `check:charts` | aucun moteur de graphique SVG maison ne réapparaît dans le dashboard | que les graphiques Recharts soient justes, lisibles, ou même montés | coller un `<polyline>` dans un composant dashboard → rouge |
| `check:rsc-boundary` | aucun Server Component ne passe une prop **fonction** à un Client Component | les autres valeurs non sérialisables ; et il ne résout les identifiants que localement | passer `format={fn}` d'un serveur à un `'use client'` → rouge |
| `check:surfaces` (navigateur) | dans le DOM composé, aucun plan ne contient un élément du **même** plan (card dans card) | tout le reste du visuel. Et il ne voit que les 9 routes de sa liste | monter un `EmptyStatePanel` dans une `Section` → rouge |
| `check:headings` (navigateur) | l'outline rendu est légal : un `h1` par page, aucun saut de rang, pas d'empty state au rang d'une section | que les titres soient *justes* ou utiles | `--static-only` ne teste QUE la règle 3 : un `check:headings:static` vert ne dit rien de l'outline |
| `check:a11y` / `check:contrast` (navigateur) | chaque nœud de texte **rendu** des 6 routes atteint son seuil AA, fonds ancêtres et `opacity` composités | AA hors de ces 6 routes / 2 viewports ; et rien des autres critères a11y (focus, cible tactile, nom accessible, ordre de tabulation). Approximation déclarée : l'`opacity` des ancêtres n'est pas ré-appliquée au fond — la mesure est donc au pire *optimiste*, jamais pessimiste | §3 |
| `check:views` | chaque `page.tsx` d'admin est soit migrée (corps ≤ 20 lignes, zéro token legacy) soit inscrite dans `not-yet-migrated.json` | que la vue migrée rende quoi que ce soit de correct |
| `check:legacy-bridge` | aucun **nouvel** importeur du pont `surface-card.tsx` / des tokens `--color-surface-*` | rien sur les importeurs déjà inscrits ; les allowlists sont monotones décroissantes, jamais purgées automatiquement |
| `check:status-truth` | un libellé de statut affiché vient de `labels.ts`, jamais d'une chaîne écrite sur place | que le statut affiché soit **vrai** — seulement qu'il soit dit dans un seul vocabulaire |
| `check:render-truth` | aucune absence de mesure n'est rendue comme un 0 / `NaN` / une phrase affirmative | que la donnée présente soit juste |
| `check:agent-truth` | aucun roster de config ni package figé n'est servi par l'app | que les agents servis soient exécutables |
| `check:registry-parity` | tout outil « runnable » côté direct existe aussi dans le registre LangGraph | que l'outil fonctionne |
| `check:registry-integrity` | les énumérations d'ids outils/runtimes dérivent toutes du registre canonique | que les **lignes `tools`** en base soient conformes (c'est `check:tool-rows`) |
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

`check:tables` et `check:class-collision` acceptent `--only=<sous-chaîne>` : c'est le
mécanisme prévu pour sonder sur une fixture jetable sans toucher au reste du repo.

### Sondes réellement passées le 26/07/2026

**`check:tables`** — fixtures temporaires dans `src/components/views/__gate_probe__/`,
supprimées après coup.

| Sonde | Fixture | Résultat |
| --- | --- | --- |
| ROUGE (repo réel) | `agent-leaderboard.tsx:120`, `recent-runs-table.tsx:50` | exit 1, 2 findings nommés |
| ROUGE (fixture) | `<Table className="w-full fixed inset-0">` + sticky · `<TableRow hover:bg-*>` sans href · colonne `md` sous en-tête `lg` | exit 1, **les 3 règles** tirent |
| VERTE / ANTI-TAUTO | `<Table fixed>` + sticky · `<TableRow href hover:bg-*>` · colonne `md` sous en-tête `md` | exit 0 — mêmes classes, mais légitimes |
| Allowlist sans justification | `reason: "trop court"` | **exit 2** — la gate refuse de démarrer |
| Allowlist justifiée | 3 entrées ≥ 15 car. | exit 0, **les 3 dettes réimprimées** sur le run vert |

**`check:class-collision`** — même méthode.

| Sonde | Fixture | Résultat |
| --- | --- | --- |
| ROUGE (repo réel) | 83 overrides morts, 20 fichiers | exit 1 |
| ROUGE (fixture) | `<Panel className="p-3">` · `<Text className="text-xs">` · `<Table><TableCell className="py-3">` | exit 1, 3 findings |
| VERTE / ANTI-TAUTO | `<Panel inset="none" className="p-3">` · `<Text className="text-xs!">` · `<Text className="mt-4">` · `<Table dense><TableCell className="py-3">` | exit 0 — **les mêmes chaînes de classes** que la fixture rouge |
| Allowlist sans justification | `reason: "court"` | **exit 2** |
| Allowlist justifiée | 3 entrées | exit 0, dettes réimprimées |

La ligne « VERTE / ANTI-TAUTO » est la preuve qui compte : `p-3` et `py-3` apparaissent
**mot pour mot** dans les deux fixtures, et seul le contexte (`inset="none"`, `dense`,
le `!`) fait basculer le verdict. La gate discrimine du sens, pas la présence d'une
chaîne.

**`check:a11y`** — préflight sondé sans serveur (`--base http://localhost:3299` →
**exit 2**, message nommant l'URL et le remède), puis délégation sondée contre un
serveur réel (exit 1, 35 glyph runs sous AA sur `/admin` seul).

### Sonder les gates navigateur

`check:headings`, `check:surfaces` et `check:a11y` partagent `--emit` / `--input` :
capturer une fois, re-juger sans navigateur. C'est ce qui rend leur sonde ROUGE
reproductible — on modifie la capture, pas le repo.

---

## 4. Les deux allowlists à justification obligatoire

`scripts/class-collision-allowlist.json` et `scripts/table-guard-allowlist.json`
partagent délibérément le même contrat :

- clé **sans numéro de ligne** (`file|component|utility`, `file|rule|subject`) : une
  entrée ne pourrit pas au premier import ajouté au-dessus ;
- `reason` **obligatoire, ≥ 15 caractères écrits** — la gate sort **2** et refuse de
  démarrer sur une entrée sans justification. Une allowlist malformée ne se lit jamais
  comme un succès ;
- une entrée qui ne correspond plus à rien est signalée en warning au prochain scan
  complet ;
- **toute entrée active est réimprimée sur le run VERT**, avec sa justification. Une
  gate verte ne cache jamais la dette sur laquelle elle est assise.

**Les deux fichiers sont vides aujourd'hui, et ils doivent le rester.** La sortie normale
d'un défaut est de le corriger. Gonfler une allowlist pour faire verdir une gate est la
seule manière connue de transformer un outil en décoration — et c'est exactement ce que
ce repo a déjà supprimé une fois.

---

## 5. Ce qu'aucune gate ne garde ici

À énoncer tel quel, sans l'arrondir :

- **le contraste AA du dashboard** — `check:a11y` existe, mesure, échoue (51 glyphes) et
  n'est branchée nulle part ;
- **la cascade `clsx(className, defaults)`** — `check:class-collision` existe, échoue
  (83 overrides morts) et n'est pas dans `check` ;
- **les en-têtes sticky** — `check:tables` existe, échoue (2) et n'est pas dans `check` ;
- **l'alignement pixel** (trous dans une grille, cartes qui ne remplissent pas leur
  cellule dans leur état vide, déséquilibre de titres) — aucune gate ne le mesure. Il n'y
  a que l'œil et le navigateur ;
- **le focus visible, la taille des cibles tactiles, l'ordre de tabulation, les noms
  accessibles** — hors périmètre de toutes les gates a11y présentes ;
- **le comportement responsive réel** — `check:tables` vérifie la *cohérence* des
  breakpoints entre en-tête et cellule, pas que la table soit utilisable à 390 px.
