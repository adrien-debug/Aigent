#!/usr/bin/env node
/**
 * Class-collision guard — fails when a caller's `className` override is DEAD,
 * silently swallowed by the primitive's own default utility.
 *
 * THE ROOT DEFECT. Every primitive of `src/components/ui/` composes its classes
 * as `clsx(className, 'defaults…')` — the caller's string comes FIRST. That
 * reads like "the caller can override", and it is false: Tailwind resolves two
 * utilities of the same CSS property by their order in the COMPILED STYLESHEET,
 * never by their order inside the `class` attribute. The default is the one
 * that wins, and the override evaporates without a single warning:
 *
 *   <TableCell className="px-6 py-3">   renders py-4  (16px, not the 12px asked)
 *   <Text className="text-xs">          renders 14px from 640px up, because the
 *                                       default `sm:text-sm/6` carries a media
 *                                       variant the bare caller class cannot beat
 *   <Badge className="px-0 text-[10px]"> renders the default padding and size
 *
 * None of the 17 gates that existed before this one could see it: typecheck,
 * lint, check:catalyst (which primitive?), check:ds (which colour?) all pass on
 * a component whose override is inert. The class attribute is well-formed; only
 * the CASCADE is wrong. So the rule gets an actual tool.
 *
 * WHAT IT DOES (static analysis, no compiled stylesheet — see LIMITS):
 *   1. Reads every primitive of `src/components/ui/`, keeps the `clsx(…)` calls
 *      whose FIRST argument is `className` (those are the vulnerable ones — a
 *      `clsx('defaults', className)` is safe and is ignored), and extracts the
 *      default utilities WITH their variants (`sm:`, `dark:`, `first:`, …).
 *      Prop conditions are EVALUATED against their declared defaults, so
 *      `dense ? 'py-3' : 'py-4'` (`dense = false`) yields `py-4` only — what an
 *      unconfigured primitive actually renders.
 *   2. Parses the LITERAL `className` of every JSX call of those primitives in
 *      the dashboard perimeter.
 *   3. Reports a caller utility when it targets the same CSS property as a
 *      default AND the default's variant beats it (see `defaultBeatsCaller`).
 *   4. Ignores anything marked `!important` — v4 suffix (`px-0!`) and v3 prefix
 *      (`!mt-0`), both in use in this repo: `!` wins over stylesheet order, so
 *      the override is genuinely applied and there is nothing to report.
 *   5. Honours a written-justification allowlist, `class-collision-allowlist.json`.
 *
 * LIMITS — stated so nobody credits this gate with more than it does:
 *   - Static families, not the compiled CSS. Two utilities of the same property
 *     are declared in conflict without reading which rule Tailwind emitted last.
 *     For `clsx(className, …)` that is sound in the direction that matters: the
 *     defaults are what the primitive guarantees, so a caller that fights them
 *     is at best relying on an ordering nobody controls.
 *   - Only LITERAL classNames. `className={cond ? a : b}` with variables, or a
 *     class built at runtime, is invisible here.
 *   - Only the `clsx(className, …)` inline defaults. Utilities that come from a
 *     prop-keyed map (`colors[color]` in badge/button) are NOT extracted: the
 *     applied set depends on a prop this gate does not evaluate. Callers that
 *     fight a colour map are therefore NOT caught.
 *   - Defaults that arrive through a bare module CONST are not extracted
 *     either: `Panel` composes `tone === 'raised' ? surfaceRaised : …`, and
 *     `surfaceRaised` is a string const, not a literal. Its `rounded-xl` /
 *     `bg-white` / `ring-1` are therefore NOT indexed, so a
 *     `<Panel className="rounded-lg">` — dead, in fact — is not reported.
 *     A known MISS, listed in scripts/README-gates.md, never a wrong accusation.
 *   - Unknown/unmapped utilities are ignored rather than guessed (fail-open on
 *     classification, never a fabricated violation).
 *   - Static families, never the compiled sheet: this gate has no notion of
 *     which rule Tailwind emitted last, so `check:class-collision` green does
 *     NOT mean "the rendered pixels match the class list" — only that no LITERAL
 *     caller class fights a KNOWN inline default. The pixel-level statement
 *     belongs to `check:a11y` / a browser, not here.
 *
 * Pure Node, no deps. Run via `node scripts/check-class-collision.mjs`.
 *   `--list-families`  dumps the property mapping of the utilities it read —
 *                      how you audit the classifier instead of trusting it.
 *   `--only=<sub>`     restricts the scan to paths containing <sub>, for fixing
 *                      one file at a time and for probing the gate on a fixture.
 *                      CI takes no argument and scans the whole perimeter.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SRC = join(ROOT, 'src')
const UI_DIR = join(SRC, 'components', 'ui')
const ALLOWLIST_PATH = join(HERE, 'class-collision-allowlist.json')

// Dashboard perimeter — the surfaces AGENTS.md binds to the Catalyst primitives.
// Marketing (`app/(site)`, `components/marketing`) follows a different, deliberate
// convention and is out of scope here as everywhere else.
const SCAN_DIRS = [
  join('app', 'admin'),
  join('components', 'agent-ops'),
  join('components', 'views'),
  join('components', 'shell'),
]

/* ------------------------------------------------------------------ *
 * Tokenizer: variants + `!important`, bracket-aware.
 * ------------------------------------------------------------------ */

/**
 * Splits a utility on its variant colons — ignoring any `:` nested in `[]` or
 * `()`, so `data-[state=open]:bg-x` and `bg-[url(a:b)]` survive intact.
 */
function splitVariants(token) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth--
    else if (c === ':' && depth === 0) {
      parts.push(token.slice(start, i))
      start = i + 1
    }
  }
  parts.push(token.slice(start))
  const base = parts.pop()
  return { variants: parts, base }
}

/**
 * `!important` in both dialects: v3 prefix (`!mt-0`, 20+ occurrences here) and
 * v4 suffix (`mt-0!`). Either one lifts the utility out of stylesheet-order
 * arbitration, so the caller genuinely wins and the collision is not one.
 */
function parseUtility(token) {
  const { variants, base } = splitVariants(token)
  const important = base.startsWith('!') || base.endsWith('!')
  const clean = base.replace(/^!/, '').replace(/!$/, '')
  return { raw: token, variants, base: clean, important }
}

// Variants that move the declaration to ANOTHER box than the one carrying
// `className`: children (`*:`, `**:`, `[&_th]:`, `[&>td]:`) and pseudo-elements
// (`before:`, `after:`, `placeholder:`…). A utility behind one of them can never
// collide with the caller's own utility, whatever the family — comparing them
// would be pure noise.
const PSEUDO_ELEMENT_VARIANTS = new Set([
  'before', 'after', 'first-letter', 'first-line', 'marker', 'selection', 'file', 'backdrop', 'placeholder',
])

function retargetsOtherElement(variants) {
  return variants.some(
    (v) => v === '*' || v === '**' || /^\[&[\s_>+~]/.test(v) || PSEUDO_ELEMENT_VARIANTS.has(v)
  )
}

/* ------------------------------------------------------------------ *
 * Classifier: utility -> the CSS properties it writes.
 * Two utilities collide iff their property sets intersect. Anything this map
 * does not know returns null and is never reported.
 * ------------------------------------------------------------------ */

const FONT_SIZES = new Set(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'])
const FONT_WEIGHTS = new Set([
  'thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black',
])
const FONT_FAMILIES = new Set(['sans', 'serif', 'mono'])
const TEXT_ALIGN = new Set(['left', 'center', 'right', 'justify', 'start', 'end'])
const TEXT_WRAP = new Set(['wrap', 'nowrap', 'balance', 'pretty'])
const TEXT_OVERFLOW = new Set(['ellipsis', 'clip'])
const DISPLAY = new Set([
  'block', 'inline-block', 'inline', 'flex', 'inline-flex', 'table', 'inline-table', 'table-caption',
  'table-cell', 'table-column', 'table-column-group', 'table-footer-group', 'table-header-group',
  'table-row-group', 'table-row', 'flow-root', 'grid', 'inline-grid', 'contents', 'list-item', 'hidden',
])
const POSITION = new Set(['static', 'fixed', 'absolute', 'relative', 'sticky'])
const TEXT_TRANSFORM = new Set(['uppercase', 'lowercase', 'capitalize', 'normal-case'])

const BOX_SIDES = {
  '': ['top', 'right', 'bottom', 'left'],
  x: ['left', 'right'],
  y: ['top', 'bottom'],
  t: ['top'],
  r: ['right'],
  b: ['bottom'],
  l: ['left'],
  s: ['left'],
  e: ['right'],
}

/** Does an arbitrary value `[…]` / `(…)` read as a colour or as a length? */
function arbitraryKind(value) {
  const inner = value.replace(/^[[(]/, '').replace(/[\])]$/, '')
  if (/^#|(^|\W)(rgb|hsl|oklch|oklab|color-mix)\(/.test(inner)) return 'color'
  if (/^--/.test(inner) || /var\(--/.test(inner)) {
    // A CSS variable in a `text-*` slot is a colour unless it names a size.
    return /(size|space|spacing|length|width|height|leading)/.test(inner) ? 'length' : 'color'
  }
  if (/^-?[\d.]+(px|rem|em|pt|ch|ex|vw|vh|%)$/.test(inner)) return 'length'
  return 'unknown'
}

/**
 * Returns the list of CSS properties a utility writes, or null when the
 * utility is outside the mapped vocabulary.
 */
function propertiesOf(base) {
  const u = base.replace(/^-/, '') // -mt-2 and mt-2 write the same property

  if (DISPLAY.has(u)) return ['display']
  if (POSITION.has(u)) return ['position']
  if (TEXT_TRANSFORM.has(u)) return ['text-transform']
  if (u === 'truncate') return ['overflow', 'text-overflow', 'white-space']
  if (u === 'italic' || u === 'not-italic') return ['font-style']
  if (u === 'underline' || u === 'overline' || u === 'line-through' || u === 'no-underline') {
    return ['text-decoration-line']
  }

  // text-* : font-size, colour, alignment, wrapping, overflow — same prefix,
  // four different properties. Getting this split right is the whole point of
  // the `Text className="text-xs"` case.
  let m = u.match(/^text-(.+)$/)
  if (m) {
    const value = m[1]
    const [head, ...rest] = splitOnSlash(value)
    if (FONT_SIZES.has(head)) return rest.length ? ['font-size', 'line-height'] : ['font-size']
    if (TEXT_ALIGN.has(head)) return ['text-align']
    if (TEXT_WRAP.has(head)) return ['text-wrap']
    if (TEXT_OVERFLOW.has(head)) return ['text-overflow']
    if (/^[[(]/.test(head)) {
      const kind = arbitraryKind(head)
      if (kind === 'length') return rest.length ? ['font-size', 'line-height'] : ['font-size']
      if (kind === 'color') return ['color']
      return null
    }
    return ['color'] // text-zinc-500, text-white, text-current, text-accent-700…
  }

  m = u.match(/^font-(.+)$/)
  if (m) {
    if (FONT_WEIGHTS.has(m[1])) return ['font-weight']
    if (FONT_FAMILIES.has(m[1])) return ['font-family']
    if (/^[[(]/.test(m[1])) return null // font-[…] is ambiguous, don't guess
    return null
  }

  if (/^leading-/.test(u)) return ['line-height']
  if (/^tracking-/.test(u)) return ['letter-spacing']
  if (/^whitespace-/.test(u)) return ['white-space']
  if (/^overflow-x-/.test(u)) return ['overflow-x']
  if (/^overflow-y-/.test(u)) return ['overflow-y']
  if (/^overflow-/.test(u)) return ['overflow']
  if (/^opacity-/.test(u)) return ['opacity']
  if (/^z-/.test(u)) return ['z-index']
  if (/^rounded(-|$)/.test(u)) return roundedProperties(u)

  // padding / margin — modelled side by side, because `px-6` vs `py-3` must NOT
  // be a collision while `p-2` vs `py-3` must be one.
  m = u.match(/^([pm])([xytrbles]?)-(.+)$/)
  if (m) {
    const kind = m[1] === 'p' ? 'padding' : 'margin'
    const sides = BOX_SIDES[m[2]]
    if (!sides) return null
    return sides.map((s) => `${kind}-${s}`)
  }

  if (/^size-/.test(u)) return ['width', 'height']
  if (/^w-/.test(u)) return ['width']
  if (/^h-/.test(u)) return ['height']
  if (/^min-w-/.test(u)) return ['min-width']
  if (/^max-w-/.test(u)) return ['max-width']
  if (/^min-h-/.test(u)) return ['min-height']
  if (/^max-h-/.test(u)) return ['max-height']
  if (/^gap-x-/.test(u)) return ['column-gap']
  if (/^gap-y-/.test(u)) return ['row-gap']
  if (/^gap-/.test(u)) return ['column-gap', 'row-gap']
  if (/^items-/.test(u)) return ['align-items']
  if (/^justify-items-/.test(u)) return ['justify-items']
  if (/^justify-/.test(u)) return ['justify-content']
  if (/^self-/.test(u)) return ['align-self']
  if (/^flex-(row|col)/.test(u)) return ['flex-direction']
  if (/^(bg-gradient|bg-\[url)/.test(u)) return null
  if (/^bg-/.test(u)) return ['background-color']

  // border-* : width when the value is a side/number, colour otherwise.
  m = u.match(/^border(?:-([xytrbles]))?(?:-(.+))?$/)
  if (m) {
    const sides = BOX_SIDES[m[1] ?? '']
    const value = m[2]
    if (!sides) return null
    if (value === undefined || /^\d+$/.test(value)) return sides.map((s) => `border-${s}-width`)
    if (/^(solid|dashed|dotted|double|hidden|none)$/.test(value)) return ['border-style']
    return sides.map((s) => `border-${s}-color`)
  }

  return null
}

/**
 * Directional families write the same declaration on several sides at once, so
 * two of them can overlap on one side while carrying the SAME value:
 * `gap-1.5` vs `gap-x-1.5`, `p-4` vs `px-4`. The override is then redundant,
 * not dead — the rendered value is the one the caller asked for. Returns
 * `{family, value}` for those, null for everything else.
 */
function directionalValue(base) {
  const u = base.replace(/^-/, '')
  let m = u.match(/^([pm])[xytrbles]?-(.+)$/)
  if (m) return { family: m[1] === 'p' ? 'padding' : 'margin', value: m[2] }
  m = u.match(/^gap(?:-[xy])?-(.+)$/)
  if (m) return { family: 'gap', value: m[1] }
  m = u.match(/^rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|ee|es))?-(.+)$/)
  if (m) return { family: 'rounded', value: m[1] }
  return null
}

/** `text-sm/6` -> ['text-sm-ish', '6'] but only when the `/` is at depth 0. */
function splitOnSlash(value) {
  let depth = 0
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth--
    else if (c === '/' && depth === 0) return [value.slice(0, i), value.slice(i + 1)]
  }
  return [value]
}

function roundedProperties(u) {
  const m = u.match(/^rounded(?:-(t|r|b|l|s|e|tl|tr|br|bl|ss|se|ee|es))?(?:-(.+))?$/)
  if (!m) return ['border-radius']
  const corners = {
    t: ['tl', 'tr'], b: ['bl', 'br'], l: ['tl', 'bl'], r: ['tr', 'br'],
    s: ['tl', 'bl'], e: ['tr', 'br'],
  }
  const key = m[1]
  if (!key) return ['border-radius-tl', 'border-radius-tr', 'border-radius-br', 'border-radius-bl']
  const list = corners[key] ?? [key]
  return list.map((c) => `border-radius-${c}`)
}

/* ------------------------------------------------------------------ *
 * Cascade model: when does the DEFAULT beat the CALLER?
 * ------------------------------------------------------------------ */

/**
 * Returns a reason string when the primitive's default wins over the caller's
 * utility, or null when the caller keeps control.
 *
 *   default nude      vs caller nude   -> default wins: same media condition and
 *                                         same specificity, so the winner is the
 *                                         one emitted last in the compiled sheet,
 *                                         which the caller cannot influence at all
 *                                         (this is exactly the `py-4` case).
 *   default `sm:`     vs caller nude   -> default wins from 640px up: the variant
 *                                         is emitted after the bare utilities.
 *   default `dark:`   vs caller nude   -> default wins in dark mode.
 *   default nude      vs caller `sm:`  -> caller wins inside its own condition:
 *                                         NOT reported (the caller's variant is
 *                                         emitted after the bare default).
 *   disjoint variants (`hover:` vs `focus:`) -> different states, not comparable.
 */
function defaultBeatsCaller(def, caller) {
  const d = new Set(def.variants)
  const c = new Set(caller.variants)
  if (d.size === c.size && [...d].every((v) => c.has(v))) {
    return d.size === 0
      ? 'même condition (aucun variant) — la feuille compilée tranche, pas l’attribut class'
      : `même condition (${[...d].join(':')}) — la feuille compilée tranche, pas l’attribut class`
  }
  if (c.size < d.size && [...c].every((v) => d.has(v))) {
    const extra = [...d].filter((v) => !c.has(v))
    return `le défaut porte ${extra.map((v) => `${v}:`).join('')} que l’appelant n’a pas — il gagne dans cette condition`
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Reading the primitives: which defaults sit AFTER `className` in clsx?
 * ------------------------------------------------------------------ */

/** Balanced scan from the `(` at `open`, string-aware. Returns the call body. */
function readCall(source, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return null
}

function stringLiteralsOf(body) {
  const out = []
  const re = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"/g
  let m
  while ((m = re.exec(body))) out.push(m[1] ?? m[2])
  return out
}

/** Splits a call body on its top-level commas, string- and bracket-aware. */
function splitArgs(body) {
  const args = []
  let depth = 0
  let quote = null
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) {
      args.push(body.slice(start, i))
      start = i + 1
    }
  }
  args.push(body.slice(start))
  return args.map((a) => a.trim()).filter(Boolean)
}

/**
 * Resolves `styles.base` — Button keeps its defaults in a module-level object
 * instead of inline literals, so without this the most-used primitive of the
 * repo would report ZERO defaults and its callers would look clean.
 *
 * Only UNCONDITIONAL references are resolved (a bare `styles.base` argument).
 * `outline ? styles.outline : styles.solid` depends on a prop this gate does
 * not evaluate and is deliberately left alone, like the colour maps.
 */
function resolveMemberLiterals(source, expression) {
  const m = expression.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/)
  if (!m) return null
  const [, objName, propName] = m
  const objRe = new RegExp(`\\b(?:const|let|var)\\s+${objName}\\s*=\\s*\\{`)
  const objAt = source.search(objRe)
  if (objAt === -1) return null
  const objBody = readBraces(source, source.indexOf('{', objAt))
  if (objBody === null) return null
  const propRe = new RegExp(`(^|[,{\\s])${propName}\\s*:\\s*\\[`)
  const propMatch = objBody.match(propRe)
  if (!propMatch) return null
  const arrayAt = objBody.indexOf('[', propMatch.index)
  const arrayBody = readBrackets(objBody, arrayAt)
  return arrayBody === null ? null : stringLiteralsOf(arrayBody)
}

function readBrackets(source, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return null
}

/**
 * Props with a declared default value, read from the destructuring
 * (`dense = false`, `inset = 'md'`) and from the context defaults
 * (`{ dense: false }`). A name declared twice with two different values is
 * marked ambiguous (null) — an unknown keeps BOTH branches of its ternary, so
 * ambiguity costs recall, never precision.
 *
 * String defaults matter as much as booleans: `Panel` gates its padding on
 * `inset === 'sm' && 'p-4'`, `inset === 'md' && 'p-6'`, `inset === 'lg' && 'p-8'`
 * with `inset = 'md'`. Without evaluating those comparisons all THREE paddings
 * posed as defaults at once — a shape the primitive can never render — and a
 * `<Panel inset="none" className="p-3">`, whose override is perfectly alive
 * because no padding default is emitted at all, was reported as dead. That is a
 * false positive, and a gate that cries wolf is how an allowlist gets inflated.
 */
function propEnvOf(source) {
  const env = new Map()
  const put = (name, value) => {
    if (env.has(name) && env.get(name) !== value) env.set(name, null)
    else if (!env.has(name)) env.set(name, value)
  }
  for (const m of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:=|:)\s*(true|false)\b/g)) put(m[1], m[2] === 'true')
  // `name?: 'a' | 'b'` (a type annotation, not a default) is skipped: `\s*`
  // cannot cross the `?`, so only real initialisers land in the env.
  for (const m of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:=|:)\s*'([^'\\]*)'/g)) put(m[1], m[2])
  return env
}

/**
 * `cond`, `!cond`, `x === 'lit'`, `x !== 'lit'` evaluated against the declared
 * defaults; null when the expression or the operand is outside that vocabulary.
 */
function evalCondition(expr, env) {
  const t = expr.trim()
  let m = t.match(/^([A-Za-z_$][\w$]*)\s*(===|!==)\s*'([^'\\]*)'$/)
  if (m) {
    const value = env.get(m[1])
    if (typeof value !== 'string') return null
    return m[2] === '===' ? value === m[3] : value !== m[3]
  }
  m = t.match(/^(!?)([A-Za-z_$][\w$]*)$/)
  if (!m) return null
  const value = env.get(m[2])
  if (typeof value !== 'boolean') return null
  return m[1] === '!' ? !value : value
}

/** Depth- and quote-aware `a ? b : c` split, nested ternaries included. */
function splitTernary(expr) {
  let depth = 0
  let quote = null
  let qmark = -1
  let pending = 0
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && c === '?') {
      if (qmark === -1) qmark = i
      else pending++
    } else if (depth === 0 && c === ':' && qmark !== -1) {
      if (pending > 0) pending--
      else return { cond: expr.slice(0, qmark), then: expr.slice(qmark + 1, i), else: expr.slice(i + 1) }
    }
  }
  return null
}

/** Depth- and quote-aware `cond && rest` split. */
function splitAnd(expr) {
  let depth = 0
  let quote = null
  for (let i = 0; i < expr.length - 1; i++) {
    const c = expr[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && c === '&' && expr[i + 1] === '&') {
      return { cond: expr.slice(0, i), rhs: expr.slice(i + 2) }
    }
  }
  return null
}

/**
 * Literals a clsx argument contributes to the DEFAULT rendering — the one an
 * unconfigured primitive produces.
 *
 * Evaluating the prop conditions is what makes the gate precise rather than
 * merely loud. `dense ? 'py-3' : 'py-4'` with `dense = false` in the context
 * defaults emits `py-4` and ONLY `py-4`: keeping both branches would (a) let
 * `py-3` pose as a default and silence the very case this gate exists for
 * (`<TableCell className="py-3">` rendering 16px), and (b) accuse a caller
 * writing `py-4` of fighting a `py-3` that a default table never emits.
 * When the condition cannot be resolved, both branches are kept — an unknown
 * is not a licence to drop a default.
 */
function defaultLiteralsOfArg(arg, source, env) {
  const t = arg.trim()
  if (!t) return []

  const ternary = splitTernary(t)
  if (ternary) {
    const value = evalCondition(ternary.cond, env)
    if (value === true) return defaultLiteralsOfArg(ternary.then, source, env)
    if (value === false) return defaultLiteralsOfArg(ternary.else, source, env)
    return [...defaultLiteralsOfArg(ternary.then, source, env), ...defaultLiteralsOfArg(ternary.else, source, env)]
  }

  const and = splitAnd(t)
  if (and) {
    if (evalCondition(and.cond, env) === false) return []
    return defaultLiteralsOfArg(and.rhs, source, env)
  }

  const member = resolveMemberLiterals(source, t)
  if (member) return member

  if (/^clsx\s*\(/.test(t)) {
    const body = readCall(t, t.indexOf('('))
    if (body === null) return []
    return splitArgs(body).flatMap((a) => defaultLiteralsOfArg(a, source, env))
  }

  return stringLiteralsOf(t)
}

/**
 * Reads the primitives and keeps, per component, the RAW clsx arguments that
 * sit after `className` — not a flattened utility set.
 *
 * Keeping them raw is what lets the same primitive be resolved differently at
 * each call site. `TableCell` composes `dense ? 'py-3' : 'py-4'` where `dense`
 * comes from the Table CONTEXT, so its real default is `py-4` under a plain
 * `<Table>` and `py-3` under a `<Table dense>`. A single flattened set can only
 * be right for one of the two: resolving `dense = false` once made the gate
 * accuse every `<TableCell className="py-3">` inside `<Table dense>` of
 * fighting a `py-4` that cell never renders — a false accusation, and a false
 * accusation is how an allowlist gets inflated until the gate means nothing.
 */
async function collectPrimitiveDefaults() {
  const files = (await readdir(UI_DIR)).filter((f) => f.endsWith('.tsx'))
  /** @type {Map<string, {file: string, source: string, baseEnv: Map<string, unknown>, argGroups: string[][], cache: Map<string, Map>}>} */
  const byComponent = new Map()

  for (const file of files) {
    const source = await readFile(join(UI_DIR, file), 'utf8')
    const baseEnv = propEnvOf(source)

    // Component boundaries. Every default we find is attributed to the nearest
    // preceding declaration — good enough because the primitives are one flat
    // list of top-level components, no nesting.
    const decls = []
    const declRe = /export\s+function\s+([A-Z]\w*)|export\s+const\s+([A-Z]\w*)\s*=\s*forwardRef\(\s*function/g
    let d
    while ((d = declRe.exec(source))) decls.push({ name: d[1] ?? d[2], at: d.index })

    // TWO shapes are indexed, and they are NOT judged alike.
    //
    //   clsx(className, defaults)  — the broken shape. Nothing resolves the
    //     conflict: both classes reach the sheet and the LAST DECLARED wins,
    //     which the caller cannot influence. Every collision is real.
    //
    //   cn(defaults, className)    — the fixed shape (tailwind-merge). It drops
    //     the earlier class of a same-group pair BEFORE the browser sees it, so
    //     the caller genuinely wins... but ONLY within one variant set. twMerge
    //     compares `text-xs` against `text-sm` and resolves it; it does NOT
    //     compare `text-xs` against `sm:text-sm/6`, because disjoint variants
    //     are not a conflict to it. So the variant cases survive the fix and
    //     MUST still be reported — otherwise this gate goes green the very day
    //     the primitives are migrated, while the defects it was written for are
    //     still on screen. A gate that stops looking is worse than no gate.
    const callRe = /\b(clsx|cn)\s*\(/g
    let m
    while ((m = callRe.exec(source))) {
      const fn = m[1]
      const open = m.index + m[0].length - 1
      const body = readCall(source, open)
      if (body === null) continue

      const callerFirst = /^\s*className\s*,/.test(body)
      const callerLast = /,\s*className\s*$/.test(body)
      // `cn(defaults, className)` is only twMerge-protected; any other `cn`
      // shape (className first) is as broken as the clsx one.
      const twMergeProtected = fn === 'cn' && callerLast && !callerFirst
      if (!callerFirst && !twMergeProtected) continue

      const owner = [...decls].reverse().find((x) => x.at < m.index)
      if (!owner) continue

      const entry =
        byComponent.get(owner.name) ??
        { file: `src/components/ui/${file}`, source, baseEnv, argGroups: [], cache: new Map(), twMergeProtected: true }
      // A component keeps protection only while EVERY one of its calls is protected.
      entry.twMergeProtected = entry.twMergeProtected && twMergeProtected
      entry.argGroups.push(twMergeProtected ? splitArgs(body).slice(0, -1) : splitArgs(body).slice(1))
      byComponent.set(owner.name, entry)
    }
  }

  return byComponent
}

/**
 * The utilities a primitive renders when the props visible at the call site
 * hold. `overrides` wins over the primitive's own declared defaults; a name in
 * neither stays unknown, and an unknown keeps BOTH branches of its ternary —
 * so the "identical class is redundant, not dead" skip downstream covers both,
 * and only a caller fighting BOTH branches is ever reported. Ambiguity costs
 * recall, never precision.
 */
function utilitiesFor(entry, overrides) {
  const key = [...overrides].map(([k, v]) => `${k}=${v}`).sort().join('&')
  const cached = entry.cache.get(key)
  if (cached) return cached

  const env = new Map(entry.baseEnv)
  for (const [name, value] of overrides) env.set(name, value)

  const utilities = new Map()
  for (const args of entry.argGroups) {
    for (const literal of args.flatMap((arg) => defaultLiteralsOfArg(arg, entry.source, env))) {
      for (const token of literal.split(/\s+/).filter(Boolean)) {
        const util = parseUtility(token)
        if (util.important) continue // an important default is unbeatable anyway; nothing the caller writes changes that
        if (retargetsOtherElement(util.variants)) continue
        const properties = propertiesOf(util.base)
        if (!properties) continue
        utilities.set(token, { raw: token, properties, variants: util.variants, base: util.base })
      }
    }
  }
  entry.cache.set(key, utilities)
  return utilities
}

/**
 * The literal props of a JSX opening tag: `dense`, `dense={true}`,
 * `inset="none"`, `inset={'none'}`. Anything computed (`dense={isDense}`) is
 * deliberately absent from the map, which leaves the name unknown rather than
 * guessed.
 */
function literalPropsOf(attrs) {
  const props = new Map()
  const re = /(?:^|\s)([a-z][\w]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(true|false|'[^']*'|"[^"]*")\s*\})?)?(?=\s|$|\/)/g
  let m
  while ((m = re.exec(attrs))) {
    const name = m[1]
    const braced = m[4]
    if (m[2] !== undefined) props.set(name, m[2])
    else if (m[3] !== undefined) props.set(name, m[3])
    else if (braced === 'true') props.set(name, true)
    else if (braced === 'false') props.set(name, false)
    else if (braced !== undefined) props.set(name, braced.slice(1, -1))
    else if (!/=/.test(m[0])) props.set(name, true) // bare prop: `<Table dense>`
  }
  return props
}

/* ------------------------------------------------------------------ *
 * Reading the callers: literal classNames on primitive JSX elements.
 * ------------------------------------------------------------------ */

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(tsx|jsx)$/.test(entry.name)) yield full
  }
}

/**
 * JSX tag scanner: every `<Name …>` / `</Name>` with its attribute text, in
 * source order. Not a parser — it walks to each tag's closing `>` while
 * tracking quotes and `{}` depth, which is what makes it survive the two things
 * a regex cannot: `className={clsx('a > b')}` and `onClick={() => …}`, both of
 * which contain a `>` that does not close the tag.
 */
function* scanJsxTags(source, from = 0, to = source.length) {
  const opener = /<(\/?)([A-Z][\w.]*)/g
  opener.lastIndex = from
  let match
  while ((match = opener.exec(source))) {
    if (match.index >= to) return
    const [, slash, name] = match
    const attrsAt = opener.lastIndex
    let depth = 0
    let quote = null
    let end = -1
    for (let i = attrsAt; i < to; i++) {
      const ch = source[i]
      if (quote) {
        if (ch === quote && source[i - 1] !== '\\') quote = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch
      else if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0) {
        end = i
        break
      }
    }
    if (end === -1) return
    yield {
      name,
      closing: slash === '/',
      selfClosing: source[end - 1] === '/',
      attrs: source.slice(attrsAt, end).replace(/\/$/, ''),
      attrsAt,
    }
    // An element passed AS A PROP (`<Section actions={<Text className="text-xs"/>}>`)
    // lives inside the outer tag's attribute text, and the depth-aware walk above
    // just stepped over all of it. Recurse into that span before resuming, or
    // those elements are invisible — three real dead overrides in factory-view.tsx
    // disappeared exactly that way while this scanner was being written.
    if (!slash) yield* scanJsxTags(source, attrsAt, end)
    // Resume AFTER the tag: what remains of an attribute value is a string, and
    // a `<Foo` inside a string is not an element.
    opener.lastIndex = end + 1
  }
}

/** Names imported from `@/components/ui/*` in this file — and only those. */
function importedPrimitives(source) {
  const names = new Set()
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@\/components\/ui\/[^'"]+['"]/g
  let m
  while ((m = re.exec(source))) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim()
      if (name && /^[A-Z]/.test(name)) names.add(name)
    }
  }
  return names
}

/**
 * Walks the opening tag from `<Name`, tracking brace depth so a nested element
 * passed as a prop (`title={<Foo className="x" />}`) does not get its className
 * attributed to the outer tag — the nested tag is matched on its own pass.
 * Returns the literal className tokens, or null when there is none / it is not
 * a plain literal.
 */
function classNameOfTag(source, from) {
  let depth = 0
  let quote = null
  for (let i = from; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '{') { depth++; continue }
    if (c === '}') { depth--; continue }
    if (c === '>' && depth === 0) return null
    if (depth === 0 && source.startsWith('className=', i)) {
      const after = i + 'className='.length
      if (source[after] === '"' || source[after] === "'") {
        const end = source.indexOf(source[after], after + 1)
        if (end === -1) return null
        return { value: source.slice(after + 1, end), at: i }
      }
      if (source[after] === '{') {
        // `className={clsx('a', cond && 'b')}` — every literal inside is a class
        // the element can receive, so all of them are checked.
        const body = readBraces(source, after)
        if (body === null) return null
        return { value: stringLiteralsOf(body).join(' '), at: i }
      }
      return null
    }
  }
  return null
}

function readBraces(source, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return null
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

/**
 * The v4 `!important` form of a utility, variants preserved: `sm:text-xs` ->
 * `sm:text-xs!`. Printed as exit 2 so the suggestion is a class that can be
 * pasted, not a rule to re-derive.
 */
function importantForm(token) {
  return `${token}!`
}

/* ------------------------------------------------------------------ *
 * Allowlist
 * ------------------------------------------------------------------ */

async function loadAllowlist() {
  let raw
  try {
    raw = await readFile(ALLOWLIST_PATH, 'utf8')
  } catch {
    return { entries: [], keys: new Map() }
  }
  const parsed = JSON.parse(raw)
  const entries = parsed.entries ?? []
  const keys = new Map()
  const invalid = []
  for (const e of entries) {
    // A debt entry without a written justification is not a debt entry, it is a
    // silencer. The gate refuses to start rather than honour one.
    if (!e.file || !e.component || !e.utility || typeof e.reason !== 'string' || e.reason.trim().length < 15) {
      invalid.push(e)
      continue
    }
    keys.set(`${e.file}|${e.component}|${e.utility}`, e)
  }
  if (invalid.length > 0) {
    console.error('✗ class-collision: allowlist invalide — chaque entrée exige file, component, utility')
    console.error('  et une justification `reason` écrite (≥ 15 caractères).\n')
    for (const e of invalid) console.error(`  ${JSON.stringify(e)}`)
    process.exit(2)
  }
  return { entries, keys }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const defaults = await collectPrimitiveDefaults()

if (process.argv.includes('--list-families')) {
  // Resolved with NO call-site override — i.e. the shape an unconfigured
  // primitive renders. A `<Table dense>` call site resolves differently; that
  // is the point, and it is why this dump is an audit of the classifier, not a
  // statement about any particular caller.
  for (const [component, entry] of [...defaults].sort()) {
    console.log(`\n${component}  (${entry.file})`)
    for (const [token, u] of utilitiesFor(entry, new Map())) console.log(`  ${token.padEnd(46)} ${u.properties.join(', ')}`)
  }
  process.exit(0)
}

// `--only=<substring>` restricts the scan to the paths that contain it. Meant
// for fixing a file at a time and for probing the gate itself on a fixture;
// the CI invocation takes no argument and scans the whole perimeter.
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const only = onlyArg ? onlyArg.slice('--only='.length) : null

const { keys: allowed, entries: allowedEntries } = await loadAllowlist()
const usedAllowlistKeys = new Set()
const violations = []

for (const dir of SCAN_DIRS) {
  for await (const file of walk(join(SRC, dir))) {
    const rel = `src/${relative(SRC, file).split('\\').join('/')}`
    if (only && !rel.includes(only)) continue
    const source = await readFile(file, 'utf8')
    const primitives = importedPrimitives(source)
    if (primitives.size === 0) continue

    // Open/close-aware walk, so every tag knows which primitives ENCLOSE it.
    // That ancestry is not decoration: `TableCell` reads `dense` from the Table
    // context, so the enclosing `<Table dense>` is the only thing that says
    // which branch of `dense ? 'py-3' : 'py-4'` the cell actually renders.
    const stack = []
    for (const tag of scanJsxTags(source)) {
      if (tag.closing) {
        const at = stack.findLastIndex((frame) => frame.name === tag.name)
        if (at !== -1) stack.length = at
        continue
      }
      const props = literalPropsOf(tag.attrs)
      // Props visible at this call site: the ancestors' first (outermost to
      // innermost), the tag's own last — nearest declaration wins, exactly like
      // a React context provider chain.
      const scopedProps = new Map()
      for (const frame of stack) for (const [k, v] of frame.props) scopedProps.set(k, v)
      for (const [k, v] of props) scopedProps.set(k, v)
      if (!tag.selfClosing) stack.push({ name: tag.name, props })

      const component = tag.name
      if (!primitives.has(component)) continue
      const entry = defaults.get(component)
      if (!entry) continue
      const utilities = utilitiesFor(entry, scopedProps)

      const found = classNameOfTag(source, tag.attrsAt)
      if (!found) continue
      const line = lineOf(source, found.at)

      for (const token of found.value.split(/\s+/).filter(Boolean)) {
        const caller = parseUtility(token)
        if (caller.important) continue
        if (retargetsOtherElement(caller.variants)) continue
        const properties = propertiesOf(caller.base)
        if (!properties) continue

        // Re-stating a default verbatim (`<TableCell className="py-4">` while the
        // primitive already emits `py-4`) is redundant, not broken: the rendered
        // value is the one asked for. It must NOT be reported as beaten by the
        // OTHER branch of a prop ternary — `dense ? 'py-3' : 'py-4'` never emits
        // both, and `py-3` only exists on a dense table.
        if (utilities.has(caller.raw)) continue

        const callerDirectional = directionalValue(caller.base)

        const beaten = []
        for (const def of utilities.values()) {
          if (def.raw === caller.raw) continue // identical class: redundant, not a collision
          if (!def.properties.some((p) => properties.includes(p))) continue
          const defDirectional = directionalValue(def.base)
          if (
            callerDirectional &&
            defDirectional &&
            callerDirectional.family === defDirectional.family &&
            callerDirectional.value === defDirectional.value
          ) {
            continue // same value on an overlapping side: nothing visibly changes
          }
          const reason = defaultBeatsCaller(def, caller)
          if (reason) beaten.push({ def, reason })
        }
        if (beaten.length === 0) continue

        const key = `${rel}|${component}|${token}`
        if (allowed.has(key)) {
          usedAllowlistKeys.add(key)
          continue
        }
        // Keep the strongest explanation: a same-condition loss is the clearest
        // proof the override is dead, so it outranks a variant-scoped one.
        beaten.sort((a, b) => a.def.variants.length - b.def.variants.length)
        violations.push({
          file: rel,
          line,
          component,
          utility: token,
          properties,
          beatenBy: beaten[0].def.raw,
          reason: beaten[0].reason,
          others: beaten.slice(1).map((b) => b.def.raw),
        })
      }
    }
  }
}

// Under `--only` most of the perimeter was never read, so an unused entry
// proves nothing — only a full scan can call an allowlist entry stale.
const stale = only ? [] : [...allowed.keys()].filter((k) => !usedAllowlistKeys.has(k))

if (violations.length > 0) {
  console.error('✗ class-collision FAILED — des overrides className sont MORTS.\n')
  console.error('  Les primitives de src/components/ui/ composent clsx(className, defaults) :')
  console.error('  la classe de l’appelant arrive AVANT le défaut, et Tailwind tranche par')
  console.error('  l’ordre de la FEUILLE COMPILÉE, pas par l’ordre de l’attribut class.\n')

  const byFile = new Map()
  for (const v of violations) {
    if (!byFile.has(v.file)) byFile.set(v.file, [])
    byFile.get(v.file).push(v)
  }
  for (const [file, list] of [...byFile].sort()) {
    console.error(`  ${file}`)
    for (const v of list.sort((a, b) => a.line - b.line)) {
      console.error(`    ${file}:${v.line}  <${v.component} className="… ${v.utility} …">`)
      console.error(`      ${v.properties.join(', ')} — écrasé par le défaut « ${v.beatenBy} »`)
      console.error(`      ${v.reason}`)
      if (v.others.length > 0) console.error(`      (aussi en conflit : ${v.others.join(', ')})`)
      // Named exits, per violation, in order of preference — and the waiver key
      // printed verbatim so taking the third one is a visible, reviewable act
      // rather than a quiet edit nobody can diff against what it hides.
      console.error(`      → 1. supprimer « ${v.utility} » : il ne fait déjà rien.`)
      console.error(`      → 2. le rendre réel : « ${importantForm(v.utility)} », ou une prop de ${v.component}.`)
      console.error(
        `      → 3. dette assumée : {"file":"${v.file}","component":"${v.component}",` +
          `"utility":"${v.utility}","reason":"…"} dans scripts/class-collision-allowlist.json`
      )
    }
    console.error('')
  }

  const perComponent = new Map()
  for (const v of violations) perComponent.set(v.component, (perComponent.get(v.component) ?? 0) + 1)
  console.error('  Répartition par primitive :')
  for (const [c, n] of [...perComponent].sort((a, b) => b[1] - a[1])) console.error(`    ${c.padEnd(16)} ${n}`)

  console.error(`\n  ${violations.length} override(s) mort(s) dans ${byFile.size} fichier(s).`)
  console.error('\n  Trois sorties, dans cet ordre de préférence :')
  console.error('    1. Supprimer l’override : il ne fait déjà rien, il ment au lecteur.')
  console.error('    2. Le rendre réel : marquer la classe important (`py-3!`), ou mieux,')
  console.error('       donner à la primitive une prop (dense, tone, size…) qui porte le cas.')
  console.error('    3. Dette assumée : une entrée dans scripts/class-collision-allowlist.json')
  console.error('       avec une justification écrite — pas de silencieux anonyme.')
  process.exit(1)
}

if (stale.length > 0) {
  console.warn('⚠ class-collision: entrées d’allowlist devenues inutiles (la collision a disparu) :')
  for (const k of stale) console.warn(`    ${k.split('|').join('  ')}`)
  console.warn('  → les retirer de scripts/class-collision-allowlist.json.\n')
}

// A green run must never hide the debt it is standing on: every waiver that
// actually silenced a collision is reprinted on SUCCESS, with its justification.
// This is the difference between a gate that passes and a gate that has been
// talked into passing — the exact failure mode this repo already deleted once
// (the `|| true` of test:storybook-unit).
if (usedAllowlistKeys.size > 0) {
  console.log(`⚠ ${usedAllowlistKeys.size} collision(s) éteinte(s) par allowlist — la gate passe MALGRÉ elles :`)
  for (const key of usedAllowlistKeys) {
    const entry = allowedEntries.find((e) => `${e.file}|${e.component}|${e.utility}` === key)
    console.log(`    ${entry.file}  <${entry.component} className="… ${entry.utility} …">`)
    console.log(`      ${entry.reason}`)
  }
}

console.log(
  `✓ class-collision passed — aucun override className mort (${defaults.size} primitives lues, ` +
    `${[...defaults.values()].reduce((n, e) => n + utilitiesFor(e, new Map()).size, 0)} utilitaires par défaut indexés` +
    (usedAllowlistKeys.size > 0 ? `, ${usedAllowlistKeys.size} éteint(s) par allowlist` : '') +
    ').'
)
