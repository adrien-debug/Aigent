#!/usr/bin/env node
/**
 * Gate d'intégrité du kit de primitives `src/components/ui/`.
 *
 * CE QU'ELLE VÉRIFIE — la SUBSTANCE du kit, pas ses octets.
 *
 * Elle a longtemps été une empreinte SHA-256 des 14 fichiers : toute
 * modification la faisait rougir, y compris une évolution légitime. C'était un
 * gel, pas une garantie — et un gel finit toujours par être contourné par un
 * `--update` réflexe, ce qui ne prouve alors plus rien du tout. Elle interdisait
 * surtout ce qu'on vient de faire : unifier l'apparence du kit sur les jetons
 * `--aig-*` pour supprimer la double autorité visuelle.
 *
 * Elle vérifie désormais ce dont la perte a RÉELLEMENT cassé le produit :
 *
 *  1. INVENTAIRE — les 14 primitives existent et exportent ce que le produit
 *     importe. Une mission « sortir de Catalyst » avait supprimé 2438 lignes
 *     pour en écrire 257 : `Button` était tombé de 6 couleurs consommées à 4.
 *
 *  2. CIBLE TACTILE — `TouchTarget` conserve sa zone de 44 px. La même mission
 *     l'avait vidée de sa substance ; les 15 gates sont restées vertes, le
 *     build aussi, les 2105 tests aussi (revert `5e2aa63`).
 *
 *  3. ACCESSIBILITÉ — anneau de focus, `forced-colors`, `data-disabled` et
 *     `aria-hidden` restent présents. Ce sont eux qui rendent le kit utilisable
 *     au clavier et en contraste forcé ; ils disparaissent sans bruit.
 *
 *  4. AUTORITÉ VISUELLE UNIQUE — aucune couleur Tailwind brute (`zinc-*`,
 *     `white`, `blue-500`…) ne revient dans le kit. C'est la règle qui empêche
 *     la double autorité de se reformer fichier par fichier. Le détail est
 *     tenu par `check:legacy-design-doctrine`, qui scanne le kit ; ici on garde
 *     un filet indépendant pour que la règle survive à la suppression de
 *     l'autre gate.
 *
 * CE QU'ELLE NE GARANTIT PAS — que les écrans utilisent le kit, qu'ils ne le
 * combattent pas de l'extérieur (`className` agressifs, `!important`), ni que
 * les primitives FONCTIONNENT. Elle lit du texte, pas un rendu. Aucune gate de
 * ce repo ne mesure ce qui s'affiche : après avoir touché une primitive, ouvrez
 * un écran qui la consomme et regardez-le.
 *
 * Voir `src/components/ui/README.md` pour l'inventaire et les usages.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const KIT_DIR = 'src/components/ui'

/**
 * Les primitives attendues et, pour chacune, les exports que le produit
 * consomme. Retirer un export d'ici est une décision de revue, pas un accident.
 */
const REQUIRED = {
  'avatar.tsx': ['Avatar'],
  'badge.tsx': ['Badge', 'BadgeButton'],
  'button.tsx': ['Button', 'TouchTarget'],
  'checkbox.tsx': ['Checkbox', 'CheckboxField', 'CheckboxGroup'],
  'dialog.tsx': ['Dialog', 'DialogActions', 'DialogBody', 'DialogDescription', 'DialogTitle'],
  'divider.tsx': ['Divider'],
  'fieldset.tsx': ['Description', 'ErrorMessage', 'Field', 'Fieldset', 'Label', 'Legend'],
  'heading.tsx': ['Heading', 'Subheading'],
  'link.tsx': ['Link'],
  'navbar.tsx': ['Navbar'],
  'sidebar.tsx': ['Sidebar', 'SidebarBody', 'SidebarFooter', 'SidebarHeader', 'SidebarItem'],
  'table.tsx': ['Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow'],
  'text.tsx': ['Code', 'Strong', 'Text', 'TextLink'],
  'textarea.tsx': ['Textarea'],
}

/** Couleur Tailwind brute — la marque d'une seconde autorité visuelle. */
const RAW_COLOR =
  /\b(?:bg|text|ring|border|fill|stroke|divide|outline|shadow|from|via|to|placeholder|decoration|accent|caret)-(?:(?:zinc|slate|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black)(?:\/[\d.]+)?\b/g

/**
 * Marqueurs d'accessibilité, avec le fichier qui doit les porter. Ce ne sont
 * pas des détails d'apparence : sans eux le kit devient inutilisable au clavier
 * ou en contraste forcé, et rien d'autre ne le signale.
 */
const A11Y = [
  { file: 'button.tsx', pattern: /forced-colors:/, label: 'contraste forcé (button)' },
  { file: 'button.tsx', pattern: /data-disabled:/, label: 'état désactivé (button)' },
  { file: 'checkbox.tsx', pattern: /forced-colors:/, label: 'contraste forcé (checkbox)' },
  // Une ligne cliquable de `Table` pose un lien en recouvrement ; sans nom
  // accessible, un lecteur d'écran annonce un lien vide.
  { file: 'table.tsx', pattern: /aria-label/, label: 'nom accessible du lien de ligne (table)' },
]

const errors = []
const notes = []

// ---------------------------------------------------------- 1. INVENTAIRE
const present = new Set(
  readdirSync(KIT_DIR).filter((n) => n.endsWith('.tsx') || n.endsWith('.ts')),
)

const sources = {}
for (const name of Object.keys(REQUIRED)) {
  if (!present.has(name)) {
    errors.push(`PRIMITIVE MANQUANTE  ${KIT_DIR}/${name}`)
    continue
  }
  sources[name] = readFileSync(join(KIT_DIR, name), 'utf8')
}

for (const [name, exports] of Object.entries(REQUIRED)) {
  const src = sources[name]
  if (!src) continue
  for (const symbol of exports) {
    // `export function X`, `export const X`, `export { X }`, `export const X = forwardRef`
    const re = new RegExp(
      `export\\s+(?:async\\s+)?(?:function|const|class)\\s+${symbol}\\b|export\\s*\\{[^}]*\\b${symbol}\\b`,
    )
    if (!re.test(src)) errors.push(`EXPORT PERDU        ${KIT_DIR}/${name} → ${symbol}`)
  }
}

// ------------------------------------------------------- 2. CIBLE TACTILE
// La zone de confort de 44 px ne se lit pas dans un rendu : elle vit dans un
// `span` absolu dont la taille est écrite en toutes lettres.
const button = sources['button.tsx']
if (button) {
  if (!/TouchTarget/.test(button)) {
    errors.push('CIBLE TACTILE       button.tsx → `TouchTarget` a disparu')
  } else if (!/\[max\(100%,2\.75rem\)\]/.test(button)) {
    errors.push(
      'CIBLE TACTILE       button.tsx → `TouchTarget` ne garantit plus 2.75rem (44 px)',
    )
  }
}

// -------------------------------------------------------- 3. ACCESSIBILITÉ
for (const { file, pattern, label } of A11Y) {
  const src = sources[file]
  if (src && !pattern.test(src)) errors.push(`ACCESSIBILITÉ       ${label} — marqueur absent`)
}

// Anneau de focus : présent dans tout composant focusable, quelle que soit sa
// couleur (l'accent du produit ou autre) — c'est sa PRÉSENCE qui compte.
for (const file of ['button.tsx', 'checkbox.tsx', 'textarea.tsx', 'badge.tsx']) {
  const src = sources[file]
  if (src && !/outline|focus/.test(src)) {
    errors.push(`ACCESSIBILITÉ       ${file} → aucun anneau de focus détecté`)
  }
}

// ------------------------------------------------ 4. AUTORITÉ VISUELLE UNIQUE
let rawTotal = 0
for (const [name, src] of Object.entries(sources)) {
  // On ignore les commentaires : ils DOCUMENTENT la migration et citent donc
  // les anciens jetons. Une gate qui interdit d'expliquer son propre travail
  // pousse à effacer l'explication.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
  const hits = code.match(RAW_COLOR) || []
  if (hits.length) {
    rawTotal += hits.length
    const uniq = [...new Set(hits)].slice(0, 6).join(', ')
    errors.push(`COULEUR BRUTE       ${KIT_DIR}/${name} → ${hits.length}× (${uniq})`)
  }
}

// ------------------------------------------------------------------ VERDICT
if (errors.length === 0) {
  console.log('✓ ui-kit-integrity — substance du kit préservée.')
  console.log(
    `  ${Object.keys(REQUIRED).length} primitive(s), ${Object.values(REQUIRED).flat().length} export(s) consommé(s) vérifié(s).`,
  )
  console.log(
    '  Cible tactile 44 px, marqueurs d’accessibilité présents, 0 couleur Tailwind brute.',
  )
  console.log(
    '  Ne garantit PAS que les écrans l’utilisent ni que les primitives fonctionnent : cette gate lit du texte, pas un rendu.',
  )
  for (const n of notes) console.log(`  ${n}`)
  process.exit(0)
}

console.error('✗ ui-kit-integrity — la substance du kit a régressé.\n')
for (const e of errors) console.error(`  ${e}`)
if (rawTotal > 0) {
  console.error(`
Une couleur Tailwind brute dans le kit recrée la DOUBLE AUTORITÉ VISUELLE que
cette gate existe pour empêcher : le produit parle \`--aig-*\`, le kit parlerait
autre chose. Utilisez les jetons — \`text-(--aig-text)\`, \`bg-(--aig-raised)\`,
\`border-(--aig-line)\`, \`--aig-severity-*\` pour la sémantique.`)
}
console.error(`
Modifier le kit est LÉGITIME — c'est du code du repo, pas du vendor. Cette gate
n'interdit pas le changement : elle interdit la PERTE (un export, la cible
tactile, un marqueur d'accessibilité, l'autorité visuelle unique).`)
process.exit(1)
