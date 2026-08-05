# Guide d'usage des couches UI — comment choisir sans en inventer une 6e

> **Statut** : observation datée du 2026-08-03, pas une règle. Les règles
> actives sont dans `CLAUDE.md` §8 et `AGENTS.md` § Frontend. Ce document
> explique comment consommer ce qui existe déjà ; il ne crée aucune
> contrainte nouvelle et ne fige aucun style.

## Le problème que ce guide résout

Il n'y a pas cinq design systems concurrents dans Aigent — il y a **quatre
couches**, chacune avec un rôle écrit en commentaire dans son propre fichier.
Le bug le plus fréquent n'est pas visuel, c'est un **mélange de couche** : un
écran qui prend un composant de la mauvaise couche pour un usage qui en
demandait une autre. Exemple réel trouvé sur `/` (Aperçu) le 2026-08-02 :
`KpiStrip` et `blocks.tsx` utilisaient `Badge` (palette zinc neutre) pour un
état de sévérité sans map de ton — tous les badges rendaient le même gris.
**Corrigé 2026-08-06** : une seule autorité visuelle = `Badge` Catalyst via
`SEVERITY_BADGE_COLOR` (`src/lib/ui/severity-badge.ts`). La couche `aig-chip*` /
`SeverityChip` art a été retirée.

Ce guide donne l'arbre de décision pour ne pas refaire cette erreur.

## Les quatre couches, dans l'ordre où les lire

### Couche 1 — `src/components/ui/` — le kit Catalyst officiel

**Ce que c'est** : copie telle quelle de `catalyst-ui-kit.zip` (Tailwind
Plus). `Button`, `Badge`, `Text`, `Heading`, `Dialog`, `Table`, `Sidebar`,
`Avatar`, `Link`, `Divider`, `Checkbox`, `Textarea`, `Navbar`, `Fieldset` — 14
primitives, inventaire exact dans `src/components/ui/README.md`.

**Palette** : zinc + `dark:`. **Jamais de `--aig-*` ici** — gate
`check:ui-kit-integrity`, section 4 (anti-fork), le vérifie ligne par ligne.

**Rôle** : le **chrome** — dialogs, formulaires, navigation, structure de
page. Pas la donnée métier.

**Quand l'utiliser** : dès que tu as besoin d'un bouton, d'un champ, d'une
modale, d'une table générique, d'un lien. Ne le modifie pas à la légère —
`check:ui-kit-integrity` (gate branchée) refuse toute perte d'export, de
cible tactile 44px, ou de marqueur d'accessibilité (focus ring,
`forced-colors:`, `data-disabled:`).

**Piège** : ne pas inventer une 2ᵉ grammaire de pastilles (`aig-chip*`). Pour
un statut produit, utiliser `Badge` avec `SEVERITY_BADGE_COLOR[tone]` — jamais
une classe maison parallèle.

### Couche 2 — `src/theme/tokens.css` — les tokens, source de vérité des couleurs

**Ce que c'est** : les valeurs littérales `--aig-*` (surfaces, textes,
accent, sévérité, élévations, radius) définies **une seule fois**, plus des
alias sémantiques (`--surface-*`, `--border-*`, `--shadow-*`) qui ne font que
référencer `--aig-*` — jamais de couleur dupliquée.

**Rôle** : la palette elle-même. Rien d'autre ne doit contenir une couleur
littérale sur les surfaces de production — gate `check:production-visual-authority`
l'interdit (couleurs hex/rgb/oklch hors `var(--aig-…)`, et toute redéfinition
locale de `RUN_STATUS_COLOR`).

**Quand y toucher** : jamais en passant. Une nouvelle teinte, un nouveau
palier d'élévation → mission dédiée, pas un ajout au fil d'une page.

**Cas particulier — statuts d'exécution (`AgentRunStatus`)** : l'autorité
n'est pas `tokens.css` mais **`src/lib/cockpit/status.ts`**
(`RUN_STATUS_COLOR`, `SEVERITY`) — valeurs dupliquées volontairement en dur
en JS parce qu'elles voyagent hors CSS (props, SVG, `style` inline).
`tokens.css` en garde un miroir CSS (`--aig-severity-*`) pour les cas CSS
pur. **`status.ts` reste la source ; toute modification part de là.**

### Couche 3 — compositions de surface (Catalyst only)

**Ce que c'est (2026-08-06)** : `surface-primitives.tsx` compose **uniquement**
des primitives Catalyst (`Badge`, `Text`, `Subheading`, `Divider`, `Code`).
Le map `SeverityTone` → couleur Badge vit dans `src/lib/ui/severity-badge.ts`
(données, pas un composant UI).

**Retiré** : `aig-chip*`, `aig-btn-accent`, art SVG/motion de `surface-state`.

**Quand l'utiliser** : `SeverityChip` n’est plus qu’un alias mince de `Badge`
(blast radius) ; préférer `Badge color={SEVERITY_BADGE_COLOR[tone]}` à terme.
`SurfaceStat` / `SurfaceSection` / `SurfaceCallout` / `SurfaceMetaRow` =
compositions Catalyst, pas une 2ᵉ grammaire visuelle.

### Couche 4 — `src/components/cockpit/primitives.tsx` — le métier que Catalyst n'a pas

**Ce que c'est** : `Panel` (section avec header Catalyst + corps),
`Unavailable`/`NotMeasured`/`Fact`/`FactValue` (absence de donnée comme état
de premier rang — jamais de faux zéro), `Rail` (barre de sévérité verticale),
`initialsOf`.

**Règle explicite du fichier** : aucun équivalent de primitive du kit ici —
ni badge, ni avatar, ni bouton, ni texte, ni séparateur. Uniquement ce que
Catalyst ne fournit pas.

**Quand l'utiliser** : structure d'un panneau (`Panel`), et **systématiquement**
pour toute valeur qui peut être absente. `null` → `NotMeasured`/`Unavailable`,
jamais `0`, jamais une boîte cachée. Un composant `Fact` avec `value === null`
rend `NotMeasured` automatiquement — la garde est dans le composant, pas à
la charge de l'appelant.

## Arbre de décision — avant d'écrire un composant

1. **C'est du chrome (bouton, lien, modale, champ, table générique) ?**
   → Couche 1, `src/components/ui/`. Ne pas modifier le fichier lui-même.

2. **C'est une couleur, une élévation, un radius ?**
   → Couche 2. Si le token existe déjà dans `tokens.css` ou `status.ts`,
   le référencer (`var(--aig-…)` en CSS, l'import JS en TS). Ne jamais
   écrire de littéral (`#...`, `rgb(...)`, `oklch(...)`) dans un fichier de
   composant — la gate `check:production-visual-authority` le bloque.

3. **C'est un statut/sévérité produit (run terminé, bloqué, échoué...) ?**
   → `Badge color={SEVERITY_BADGE_COLOR[tone]}` (`src/lib/ui/severity-badge.ts`).
   Pas de 2ᵉ grammaire `aig-chip*`.

4. **La valeur peut être absente (`null`, pas encore mesurée) ?**
   → Couche 4, `NotMeasured`/`Unavailable`/`Fact`. Jamais un `0` ou une
   chaîne vide à la place d'une absence — voir `AGENTS.md` § Vérité des
   données.

5. **Rien de tout ça n'existe déjà dans les 4 couches ?**
   → Composer avec Catalyst (`src/components/ui/`) dans le fichier d'écran.
   Ne pas créer une 5e couche générique "juste pour cette page".

## Contrôles réellement branchés — ce qu'ils vérifient et ce qu'ils ratent

Trois gates touchent ces couches, toutes dans `npm run check` :

| Gate | Vérifie | Ne garantit PAS |
|---|---|---|
| `check:production-visual-authority` | Aucune couleur littérale hors `var(--aig-…)` sur les surfaces de production ; pas de redéfinition locale de `RUN_STATUS_COLOR` | Le rendu réel des Badge Catalyst vs tokens `--aig-severity-*` restants (SVG) |
| `check:ui-kit-integrity` | Les 17 primitives Catalyst existent avec leurs exports ; cible tactile 44px ; marqueurs a11y ; le kit n'est pas recoloré en `--aig-*` | Que les écrans utilisent le kit correctement — lit du texte, pas un rendu |
| `check:no-legacy-design-governance` | L'ancienne doctrine démantelée ne revient pas | Rien sur la cohérence des couches actuelles |

**Aucune gate ne mesure le rendu.** Après avoir touché une de ces couches,
ouvrir l'écran consommateur dans un navigateur reste le seul moyen de
vérifier que ça se voit correctement.

**Écart fermé (2026-08-06)** : `aig-chip*` et `aig-btn-accent` retirés ;
sévérité = `Badge` + `SEVERITY_BADGE_COLOR` ; `surface-state` texte-only.

## Ce que ce guide n'est pas

Pas une doctrine visuelle, pas un layout imposé, pas une palette de marque.
`CLAUDE.md` §8 et `AGENTS.md` § Frontend restent les seules règles ; ceci en
est un mode d'emploi de lecture, à corriger dès que le code bouge sous lui.
