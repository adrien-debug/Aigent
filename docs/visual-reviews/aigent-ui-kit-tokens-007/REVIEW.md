# Mission de gouvernance — une seule autorité visuelle

Observation datée du **2026-08-02**. Observation, pas règle.

## Le défaut

Le produit parlait `--aig-*`, le kit Catalyst `src/components/ui/**` parlait
`zinc-*` / `white` / `dark:`. Deux systèmes visuels superposés, et pas du code
dormant : `Text` est importé par 43 fichiers produit, `Badge` par 35, `Button`
par 12.

La gate `check:legacy-design-doctrine` annonçait « 0 violation » **sans pouvoir
voir le kit** : il n'était pas dans son périmètre.

## Inventaire — mesuré, pas estimé

`measure-inventory.mjs` (archivé ici, rejouable).

| | avant | après |
|---|---|---|
| couleurs Tailwind brutes dans les 14 primitives | **276** | **0** |
| fichiers du kit concernés | 13 / 14 | **0** |

Les variantes `dark:` disparaissent au lieu d'être traduites : les jetons sont
déjà sombres, donc chaque paire clair/sombre se réduit à une valeur.

**Nuance sur le « 79 sous `dark:` »** : ce chiffre ne compte que la forme
directe `dark:<prefix>-<couleur>`. En comptant toutes les classes portant
`dark:` quelque part (`dark:data-hover:bg-white/5`…), on est plutôt à ~121. Le
276 et le 0, eux, sont exacts et recomptés indépendamment.

## Les deux gates, requalifiées

### `check:ui-kit-integrity` — de l'empreinte à la substance

L'empreinte SHA-256 était un **gel** : elle interdisait l'évolution légitime
(dont cette migration) et se contournait par un `--update` réflexe, donc elle ne
prouvait rien. Elle vérifie désormais ce dont la perte a cassé le produit :

- **inventaire** — 14 primitives, 43 exports consommés ;
- **la liste ne prend plus de retard** — les exports réellement importés par le
  produit sont dérivés du code et comparés à la liste. C'est ce contrôle qui a
  révélé que `SidebarHeading`, `SidebarLabel` et `SidebarSection`, rendus par le
  shell sur **toutes** les routes, n'étaient pas protégés ;
- **cible tactile** — `TouchTarget` garde ses 44 px ;
- **accessibilité** — `forced-colors`, `data-disabled`, anneau de focus
  réellement dessiné, nom accessible du lien de ligne ;
- **autorité visuelle unique** — 0 couleur Tailwind brute.

Le manifeste `scripts/ui-kit.sha256.json` est supprimé.

### `check:legacy-design-doctrine` — trois angles morts fermés

Périmètre **54 → 90 fichiers** : le kit, `builder`, `projects`, `lab`,
`actions`, `visualizations`, `app/error.tsx`. Nouvelles règles : accents
Tailwind bruts (`sky-*`, `amber-*`, `red-*`…) et `oklch()`/`lab()` littéraux.

## Gates sondées dans les DEUX sens

Une gate verte non sondée ne prouve rien. Dix sondes, chacune vérifiée rouge
puis restaurée verte :

| sonde | résultat |
|---|---|
| couleur brute réintroduite | rouge ✓ |
| cible tactile vidée | rouge ✓ |
| export supprimé | rouge ✓ |
| `forced-colors` retiré | rouge ✓ |
| kit hors périmètre | rouge ✓ |
| accent Tailwind brut | rouge ✓ |
| export caché en commentaire | rouge ✓ |
| `outline-none` (focus supprimé) | rouge ✓ |
| `oklch()` littéral | rouge ✓ |
| fichier `.jsx` dans le kit | rouge ✓ |

### Faux verts trouvés par revue adverse, puis fermés

1. **`/*` dans une chaîne désarmait le stripper** — le plus exploitable : une
   violation posée entre `'doc /* legacy'` et `'*/ fin'` devenait invisible aux
   14 règles. Le stripper suit désormais l'état lexical. Vérifié : la version
   naïve masque la violation, la nouvelle l'expose.
2. **Assertions positives satisfaites par du texte mort** — `// export { X }` ou
   `const TODO = 'forced-colors: …'` suffisaient. Les assertions qui doivent
   porter sur du code lisent maintenant le code sans chaînes ni commentaires.
3. **Test de focus infalsifiable** — `/outline|focus/` était satisfait par les
   noms de props (`styles.outline`, `if (outline)`) : on pouvait poser
   `outline-none` et rester vert. Le test exige un anneau réellement lié à un
   déclencheur de focus, et refuse `outline-none`.
4. **Extensions non scannées** (`.jsx`, `.mjs`) et **fichier non listé** déposé
   dans le kit : les deux sont désormais lus.

### Faux rouges corrigés

`#8841` (numéro de ticket) était refusé comme couleur. Un hex de couleur doit
contenir une lettre a–f. Angle mort assumé en échange : une couleur purement
numérique (`#123456`) passe — le compromis le moins nuisible.

## Défauts produit trouvés par la mesure

- **`--aig-scrim` était OPAQUE** : `color-mix` de deux couleurs opaques rend une
  couleur opaque. Une modale noircissait complètement la page au lieu de la
  voiler. Corrigé en mixant avec `transparent` — vérifié à alpha **0.72**.
- **`queue-console.tsx`** portait `text-emerald-400`, `text-red-400`,
  `border-amber-500/40` — rendu à l'écran, hors périmètre de la gate.
- **`visualizations.css`** redéclarait un vert et un rouge d'état en `oklch()`
  propre. Devenus des alias `--viz-severity-*` de `--aig-severity-*`.

## Preuves

`measure-routes.mjs` + `routes-after.txt` (archivés, rejouables) :

| viewport | routes conformes | surfaces zinc rendues |
|---|---|---|
| 1440×900 | **19/19** | **0** |
| 1280×800 | **19/19** | **0** |
| 375×812 | **19/19** | **0** |

0 erreur console. `check` exit 0 · 2321 tests pass / 1 expected fail · build
exit 0. CSS émis vérifié : **159/159** classes à jeton produisent une règle
réelle, 0 construction dynamique de nom de classe.

## Ce que ce document ne prouve PAS

- **Aucune gate ne mesure le rendu.** Ces deux gates lisent du texte. Un anneau
  de focus présent mais invisible, un contraste insuffisant, une primitive
  cassée : rien ne les voit.
- **Aucun test automatisé ne couvre ces deux gates.** Les dix sondes ont été
  jouées à la main ; elles ne sont pas rejouables par `npm test`.
- **Contraste — signal non tranché.** Une revue calcule que les cinq sévérités
  employées comme couleur de TEXTE tombent entre 2.97:1 et 3.45:1 sur un fond
  voilé à 15 % (seuil 4.5). Mon propre calcul sur `--aig-base` nu donne
  4.38–5.86:1, et seul `blocked` échoue. L'écart vient du fond retenu. Les
  mesures navigateur n'ont pas départagé (conversion oklch→sRGB non fiable dans
  mon script). **Le point reste ouvert**, et la piste identifiée est un jeton
  dérivé `--aig-severity-*-text` éclairci pour l'usage texte.
- **Checkbox, Table et Dialog n'ont pas été exercés en composant réel** : les
  données actuelles ne permettent pas de les monter. Les états mesurés sur ces
  trois primitives sont de niveau jeton, pas de niveau composant.
- **Dérives sémantiques NON corrigées** (hors périmètre de cette mission) :
  `blocked` rendu en `warn` dans `runs/run-list.tsx`, en `bad` dans
  `qualification/roster-screen.tsx` ; `needs-confirmation` rendu en `muted` —
  un run qui attend un geste humain s'affiche comme inactif. Le canon est
  `RUN_STATUS_COLOR` (`src/lib/cockpit/status.ts`). Aucune gate ne compare un
  mapping local au canon.
- **`SEVERITY` (JS) et `--aig-severity-*` (CSS) restent deux définitions**
  synchronisées à la main. Les 5 valeurs sont alignées aujourd'hui ; rien ne le
  vérifie.
