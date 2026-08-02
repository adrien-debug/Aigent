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
 *  2. CIBLE TACTILE — `TouchTarget` conserve sa zone de 44 px en contexte
 *     tactile (mobile / pointer coarse). En pointeur fin (desktop dense), le
 *     contrôle compact reste permis.
 *     La même mission
 *     l'avait vidée de sa substance ; les 15 gates sont restées vertes, le
 *     build aussi, les 2105 tests aussi (revert `5e2aa63`).
 *
 *  3. ACCESSIBILITÉ — anneau de focus, `forced-colors`, `data-disabled` et
 *     `aria-hidden` restent présents. Ce sont eux qui rendent le kit utilisable
 *     au clavier et en contraste forcé ; ils disparaissent sans bruit.
 *
 *  4. CATALYST OFFICIEL — le kit (`src/components/ui/*.tsx` Catalyst) ne doit
 *     PAS être recoloré en `--aig-*`. La palette zinc + `dark:` vit dans le kit ;
 *     le graphite produit vit dans `src/theme/*` et les utilities `aig-*`.
 *     `check:production-visual-authority` tient la production hors couleurs brutes
 *     de statut ; cette gate empêche le retour du fork recoloré.
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

/** Fichiers Aigent dans le dossier ui — hors périmètre Catalyst. */
const KIT_META = new Set(['README.md', 'index.ts', 'ui-kit-catalog.tsx'])

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
  'sidebar.tsx': [
    'Sidebar',
    'SidebarBody',
    'SidebarFooter',
    'SidebarHeader',
    'SidebarHeading',
    'SidebarItem',
    'SidebarLabel',
    'SidebarSection',
  ],
  'table.tsx': ['Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow'],
  'text.tsx': ['Code', 'Strong', 'Text', 'TextLink'],
  'textarea.tsx': ['Textarea'],
}

/** Recolorage fork — le kit officiel ne référence pas les jetons produit. */
const AIG_TOKEN_IN_KIT = /--aig-[a-z-]+|var\(--aig-/g

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

/**
 * Retire les commentaires, et — si `dropStrings` — les littéraux de chaîne.
 *
 * Les assertions POSITIVES de cette gate cherchent la présence d'un texte, et
 * sur la source brute un commentaire suffisait à les satisfaire :
 * `// export { Strong }` rendait la gate verte alors que l'export avait
 * disparu. Deux régimes sont donc nécessaires :
 *
 *  · `dropStrings: true` pour ce qui doit être du CODE — les exports. Une
 *    mention dans une chaîne ou un commentaire ne prouve rien.
 *  · `dropStrings: false` pour ce qui vit LÉGITIMEMENT dans une chaîne — les
 *    classes Tailwind (`forced-colors:`, `data-disabled:`, l'anneau de focus,
 *    la cible tactile). Les vider reviendrait à ne plus rien pouvoir vérifier.
 *
 * Dans les deux cas les commentaires tombent : c'est par eux que passait
 * l'essentiel des faux verts.
 */
function codeOnly(text, dropStrings = true) {
  let out = ''
  let state = 'code'
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    const next = text[i + 1]
    if (state === 'code') {
      if (c === '/' && next === '*') {
        state = 'block'
        i += 1
        continue
      }
      if (c === '/' && next === '/') {
        state = 'line'
        i += 1
        continue
      }
      if (c === "'" || c === '"' || c === '`') {
        state = c
        if (!dropStrings) out += c
        continue
      }
      out += c
      continue
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code'
        out += c
      }
      continue
    }
    if (state === 'block') {
      if (c === '*' && next === '/') {
        state = 'code'
        i += 1
      }
      continue
    }
    if (!dropStrings) out += c
    if (c === '\\') {
      if (!dropStrings) out += text[i + 1] ?? ''
      i += 1
      continue
    }
    if (c === state) state = 'code'
  }
  return out
}

const sources = {}
/** Code sans chaînes — pour les assertions qui doivent porter sur du CODE. */
const code = {}
/** Code AVEC chaînes, commentaires retirés — pour les classes Tailwind. */
const markup = {}
for (const name of Object.keys(REQUIRED)) {
  if (!present.has(name)) {
    errors.push(`PRIMITIVE MANQUANTE  ${KIT_DIR}/${name}`)
    continue
  }
  sources[name] = readFileSync(join(KIT_DIR, name), 'utf8')
  code[name] = codeOnly(sources[name], true)
  markup[name] = codeOnly(sources[name], false)
}

for (const [name, exports] of Object.entries(REQUIRED)) {
  const src = code[name]
  if (!src) continue
  for (const symbol of exports) {
    // `export function X`, `export const X`, `export { X }`, `export const X = forwardRef`
    const re = new RegExp(
      `export\\s+(?:async\\s+)?(?:function|const|class)\\s+${symbol}\\b|export\\s*\\{[^}]*\\b${symbol}\\b`,
    )
    if (!re.test(src)) errors.push(`EXPORT PERDU        ${KIT_DIR}/${name} → ${symbol}`)
  }
}

// ------------------------------ 1bis. LA LISTE NE DOIT PAS PRENDRE DE RETARD
//
// `REQUIRED` est écrite à la main, donc elle DÉRIVE : trois exports réellement
// rendus par le shell applicatif (`SidebarHeading`, `SidebarLabel`,
// `SidebarSection`) en étaient absents — les supprimer aurait cassé toutes les
// routes en laissant cette gate verte, exactement le mode de défaillance
// qu'elle prétend couvrir. On lit donc ce que le PRODUIT importe vraiment et on
// exige que la liste le couvre.
function consumedExports() {
  const found = new Set()
  const stack = ['src']
  const IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@\/components\/ui\/[a-z-]+['"]/g
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (path !== KIT_DIR) stack.push(path)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      const src = readFileSync(path, 'utf8')
      for (const m of src.matchAll(IMPORT)) {
        for (const raw of m[1].split(',')) {
          const name = raw.replace(/\btype\b/, '').trim().split(/\s+as\s+/)[0].trim()
          if (name) found.add(name)
        }
      }
    }
  }
  return found
}

const listed = new Set(Object.values(REQUIRED).flat())
const unprotected = [...consumedExports()].filter((s) => !listed.has(s)).sort()
if (unprotected.length > 0) {
  errors.push(
    `LISTE INCOMPLÈTE    export(s) rendus par le produit mais absents de REQUIRED : ${unprotected.join(', ')}`,
  )
}

// ------------------------------------------------------- 2. CIBLE TACTILE
// La zone de confort de 44 px vaut pour les interactions tactiles ; desktop
// dense reste compact. Ici on vérifie la présence des deux parties :
// - le plancher 44 px (`max(100%,2.75rem)`)
// - la clause de scope tactile (`pointer-fine:hidden`)
const button = markup['button.tsx']
if (button) {
  if (!/TouchTarget/.test(button)) {
    errors.push('CIBLE TACTILE       button.tsx → `TouchTarget` a disparu')
  } else if (!/\[max\(100%,2\.75rem\)\]/.test(button)) {
    errors.push(
      'CIBLE TACTILE       button.tsx → `TouchTarget` ne garantit plus 2.75rem (44 px)',
    )
  } else if (!/pointer-fine:hidden/.test(button)) {
    errors.push(
      'CIBLE TACTILE       button.tsx → `TouchTarget` doit rester scope tactile (`pointer-fine:hidden`)',
    )
  }
}

// -------------------------------------------------------- 3. ACCESSIBILITÉ
for (const { file, pattern, label } of A11Y) {
  const src = markup[file]
  if (src && !pattern.test(src)) errors.push(`ACCESSIBILITÉ       ${label} — marqueur absent`)
}

// Anneau de focus. La couleur est libre (accent du produit ou autre) : ce qui
// compte est qu'un anneau soit RÉELLEMENT dessiné quand l'élément prend le
// focus.
//
// Le test précédent — `/outline|focus/` — était INFALSIFIABLE dans
// `button.tsx` : le mot `outline` y apparaît huit fois comme nom de prop
// (`styles.outline`, `outline?: never`, `if (outline)`). On pouvait remplacer
// toute la règle de focus par `outline-none` et la gate restait verte. On exige
// donc une classe qui LIE un déclencheur de focus à un anneau visible, et on
// refuse explicitement sa suppression.
// Les segments intermédiaires (`sm:`, `after:`, `not-data-focus:`) sont
// autorisés entre le déclencheur et l'anneau : `textarea.tsx` dessine
// légitimement le sien en `sm:focus-within:after:ring-2`.
const FOCUS_RING =
  /(?:data-focus:|focus-visible:|focus-within:|focus:)(?:[a-z-]+:)*(?:outline-(?!none\b|hidden\b)|ring-(?!0\b))/
for (const file of ['button.tsx', 'checkbox.tsx', 'textarea.tsx', 'badge.tsx']) {
  const src = markup[file]
  if (!src) continue
  if (!FOCUS_RING.test(src)) {
    errors.push(`ACCESSIBILITÉ       ${file} → aucun anneau de focus réellement dessiné`)
  }
  if (/\boutline-none\b/.test(src)) {
    errors.push(`ACCESSIBILITÉ       ${file} → \`outline-none\` supprime l'anneau de focus`)
  }
}

// ------------------------------------------- 4. CATALYST OFFICIEL (anti-fork)
// Tout fichier .tsx du dossier est scanné, y compris les primitives ajoutées
// hors des 14 d'origine — sauf les métafichiers Aigent listés dans KIT_META.
for (const name of present) {
  if (name in sources || KIT_META.has(name) || !name.endsWith('.tsx')) continue
  sources[name] = readFileSync(join(KIT_DIR, name), 'utf8')
  markup[name] = codeOnly(sources[name], false)
  notes.push(`primitive Catalyst hors inventaire initial : ${name}`)
}

let forkHits = 0
for (const [name, src] of Object.entries(sources)) {
  if (KIT_META.has(name)) continue
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
  const hits = stripped.match(AIG_TOKEN_IN_KIT) || []
  if (hits.length) {
    forkHits += hits.length
    errors.push(
      `FORK RECOLORÉ      ${KIT_DIR}/${name} → ${hits.length}× jeton --aig-* (kit = Catalyst officiel, non recoloré)`,
    )
  }
}

// ---------------------------------------------------------- 5. BARREL UI
const BARREL = join(KIT_DIR, 'index.ts')
if (present.has('index.ts')) {
  const barrelSrc = codeOnly(readFileSync(BARREL, 'utf8'), true)
  const expected = new Set(Object.values(REQUIRED).flat())
  for (const symbol of expected) {
    const re = new RegExp(`\\b${symbol}\\b`)
    if (!re.test(barrelSrc)) {
      errors.push(`BARREL UI           index.ts → export manquant : ${symbol}`)
    }
  }
  const exportMatches = barrelSrc.matchAll(/export\s*\{([^}]+)\}/g)
  for (const m of exportMatches) {
    for (const raw of m[1].split(',')) {
      const symbol = raw.trim().split(/\s+as\s+/)[0].trim()
      if (symbol && !expected.has(symbol) && !symbol.startsWith('type ')) {
        notes.push(`barrel export hors REQUIRED : ${symbol}`)
      }
    }
  }
}

// ------------------------------------------------------------------ VERDICT
if (errors.length === 0) {
  console.log('✓ ui-kit-integrity — substance du kit préservée.')
  console.log(
    `  ${Object.keys(REQUIRED).length} primitive(s), ${Object.values(REQUIRED).flat().length} export(s) consommé(s) vérifié(s).`,
  )
  console.log(
    '  Cible tactile 44 px (scope tactile), marqueurs d’accessibilité présents, kit Catalyst non recoloré (--aig-* absent).',
  )
  console.log(
    '  Ne garantit PAS que les écrans l’utilisent ni que les primitives fonctionnent : cette gate lit du texte, pas un rendu.',
  )
  for (const n of notes) console.log(`  ${n}`)
  process.exit(0)
}

console.error('✗ ui-kit-integrity — la substance du kit a régressé.\n')
for (const e of errors) console.error(`  ${e}`)
if (forkHits > 0) {
  console.error(`
Le kit doit rester Catalyst OFFICIEL (palette zinc + dark:). Le graphite produit
vit dans \`src/theme/*\` et les utilities \`aig-*\` — pas dans \`src/components/ui/\`.
Source de référence : \`vendor/catalyst-ui-kit/typescript/\`.`)
}
console.error(`
Ne pas recolorer le kit : mettre à jour depuis \`vendor/catalyst-ui-kit/\` ou le
zip Tailwind Plus. Cette gate interdit la perte (export, cible tactile, a11y)
et le retour du fork recoloré.`)
process.exit(1)
