/**
 * Agent Mission Control — Obsidian bridge (pure URI construction).
 *
 * Builds `obsidian://` deep links so an operator can jump from an Aigent screen
 * into their own Obsidian vault: open a note, pre-fill a review, run a search,
 * open the supervision Canvas. That is the ENTIRE scope. This module is not a
 * note editor, not a sync engine, and not a vault client.
 *
 * ## What this module deliberately does NOT do
 *
 *   - **No filesystem access.** It never reads or writes the vault, never stats
 *     a path, never checks that a note exists. Obsidian owns the vault; Aigent
 *     owns a string. Consequence to state honestly in any UI built on top: a
 *     link to a note that does not exist is a link Obsidian will answer with
 *     "note not found", and we cannot know that in advance. We do not pretend
 *     otherwise, and we do not probe the disk to find out.
 *   - **No community plugin.** Every action used here (`open`, `new`, `search`)
 *     is core Obsidian URI surface. A vault with zero plugins installed handles
 *     all of it.
 *   - **No fabricated link.** When the vault is not configured, every builder
 *     returns an `unavailable` result carrying a reason. It never returns `''`,
 *     never `'#'`, never a half-built `obsidian://open?vault=`. A button wired
 *     to an unavailable result must render disabled or absent — a link that
 *     leads nowhere is worse than no link, because it looks like a feature.
 *
 * ## URI syntax — source
 *
 * Taken from the official Obsidian help page <https://obsidian.md/help/uri>,
 * which documents the scheme as `obsidian://<action>?param=value` and states
 * plainly: "Ensure that your values are properly URI encoded."
 *
 * The three actions used, with the parameters this module sends:
 *
 *   - `obsidian://open?vault=<name>&file=<vault-relative path>`
 *     Opens an existing note. `file` is a path FROM THE VAULT ROOT, `.md`
 *     optional. We never send the `path` parameter (absolute filesystem path):
 *     it would hardcode one machine's disk layout into a link, which is exactly
 *     the coupling the config forbids.
 *   - `obsidian://new?vault=<name>&file=<vault-relative path>&content=<body>`
 *     Creates a note. We send `file` rather than `name` on purpose: `name` drops
 *     the note in the vault's "default location for new notes", a per-user
 *     preference we cannot see, so the note would land somewhere unpredictable.
 *     `file` places it exactly where the caller asked. We also always send
 *     `append=true` — see `buildCreateNoteUri` for why that is the safe default.
 *   - `obsidian://search?vault=<name>&query=<query>`
 *     Opens the search pane pre-filled.
 *
 * The Canvas builder is a special case of `open`, not a fourth action: per
 * <https://obsidian.md/help/Plugins/Canvas>, "Obsidian stores your canvas data
 * as `.canvas` files using an open file format called JSON Canvas". A canvas is
 * a FILE IN THE VAULT, so it opens with `obsidian://open` like any note. There
 * is no `obsidian://canvas` action, and inventing one would produce a URI
 * Obsidian silently ignores. Same conclusion for Bases (`.base` files,
 * <https://obsidian.md/help/bases>): a file, opened by `open`, no dedicated
 * action.
 *
 * ## Security — the reason this file is written defensively
 *
 * A URI is not a private channel. It is passed to the OS, it can land in shell
 * history, in a window title, in a crash log, in a screen recording, and on
 * macOS it transits through LaunchServices. So the rule is absolute:
 *
 *   **No prompt, no secret, no payload, no raw model output goes into a URI.**
 *
 * What a generated note may contain is a closed list: stable identifiers
 * (agent id, run id, version id), a status, a BOUNDED human summary, and
 * routes back into Aigent that are the real evidence. The evidence lives in
 * Aigent behind auth; the note holds a pointer to it, never a copy of it.
 *
 * Enforcement is `screenContent()`, which REFUSES rather than silently
 * sanitises. A refusal is a signal the caller must handle; a silent truncation
 * would hide the fact that something sensitive nearly leaked, which is the
 * failure mode we most want to avoid.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Whether the bridge can build links at all.
 *
 * `'configured'` means a vault name is present — nothing more. It is NOT a
 * claim that the vault exists, is open, or contains the paths we link to. We
 * have no channel to verify any of that (no filesystem access, by design), so
 * we do not imply it.
 */
export type ObsidianAvailability = 'configured' | 'not_configured'

/** Resolved bridge configuration. Present only when a vault name is set. */
export interface ObsidianConfig {
  availability: ObsidianAvailability
  /** Vault NAME as Obsidian knows it (not a path). Null when unconfigured. */
  vault: string | null
  /**
   * Vault-relative path to the supervision Canvas, when the operator declared
   * one. Null is a legitimate steady state: a vault with no Canvas is fine, the
   * Canvas button simply does not render.
   */
  canvasPath: string | null
  /**
   * Vault-relative folder where generated review notes are created. Defaults to
   * `Aigent` so notes never scatter into the vault root.
   */
  notesFolder: string
}

/**
 * Environment surface this module reads. Injectable so tests never mutate the
 * real `process.env` (a global whose mutation leaks across test files).
 */
/**
 * Deliberately carries an index signature alongside the three named keys, so
 * `process.env` (whose type is a bare index signature) is assignable. Without
 * it, a closed `Record` of three keys shares no property with `ProcessEnv` and
 * TypeScript rejects the default argument outright.
 */
export type ObsidianEnv = Partial<Record<ObsidianEnvVar, string | undefined>> & {
  readonly [key: string]: string | undefined
}

export type ObsidianEnvVar =
  | 'AIGENT_OBSIDIAN_VAULT'
  | 'AIGENT_OBSIDIAN_CANVAS_PATH'
  | 'AIGENT_OBSIDIAN_NOTES_FOLDER'

/** Folder used when `AIGENT_OBSIDIAN_NOTES_FOLDER` is unset. */
export const DEFAULT_NOTES_FOLDER = 'Aigent'

/**
 * Reads the bridge configuration from the environment.
 *
 * A blank or whitespace-only value counts as absent: `AIGENT_OBSIDIAN_VAULT=""`
 * is an operator saying "not configured", and treating it as a vault named
 * empty-string would build `obsidian://open?vault=` — a broken URI, precisely
 * the thing this module promises never to emit.
 *
 * No `import 'server-only'` here on purpose. This module reads a vault NAME,
 * which is not a credential, and holds no secret of any kind. Marking it
 * server-only would make every builder unusable from the client components that
 * need to render the links, forcing the config through a round trip for no
 * security gain.
 */
export function getObsidianConfig(env: ObsidianEnv = process.env): ObsidianConfig {
  const vault = trimToNull(env.AIGENT_OBSIDIAN_VAULT)
  if (!vault) {
    return { availability: 'not_configured', vault: null, canvasPath: null, notesFolder: DEFAULT_NOTES_FOLDER }
  }
  return {
    availability: 'configured',
    vault,
    canvasPath: normalizeVaultPath(trimToNull(env.AIGENT_OBSIDIAN_CANVAS_PATH)),
    notesFolder: normalizeVaultPath(trimToNull(env.AIGENT_OBSIDIAN_NOTES_FOLDER)) ?? DEFAULT_NOTES_FOLDER,
  }
}

function trimToNull(raw: string | undefined): string | null {
  const value = raw?.trim()
  return value ? value : null
}

/**
 * Normalises a vault-relative path: strips leading/trailing slashes and
 * collapses duplicates. An absolute-looking input (`/Users/...`) keeps its
 * segments but loses its leading slash — it becomes vault-relative, because
 * that is the only kind of path this module will ever emit. Machine-absolute
 * paths are never sent to Obsidian (see the module header).
 */
function normalizeVaultPath(raw: string | null): string | null {
  if (!raw) return null
  const cleaned = raw
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.')
    .join('/')
  return cleaned || null
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Why a link could not be produced. Each value maps to a distinct UI message. */
export type ObsidianUnavailableReason =
  | 'not_configured'
  | 'canvas_not_configured'
  | 'invalid_path'
  | 'empty_query'
  | 'sensitive_content'
  | 'uri_too_long'

/**
 * Every builder returns this. There is no string-returning overload, so a
 * caller cannot accidentally interpolate a failure into an `href`: the type
 * forces the `ok` check before `.uri` is reachable.
 */
export type ObsidianUriResult =
  | { ok: true; uri: string }
  | { ok: false; reason: ObsidianUnavailableReason; detail: string }

/** Narrow return type so `requireVault` keeps its discriminated-union narrowing. */
function unavailable(
  reason: ObsidianUnavailableReason,
  detail: string,
): Extract<ObsidianUriResult, { ok: false }> {
  return { ok: false, reason, detail }
}

// ---------------------------------------------------------------------------
// Length bound
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on a generated URI, in characters.
 *
 * Why a bound exists: a URI handed to the OS crosses layers that each impose
 * their own limit, and they truncate SILENTLY rather than erroring. The
 * practical floor across the platforms Obsidian runs on is the Windows
 * `ShellExecute` / registry command line, historically safe below ~2000
 * characters; browsers add their own address-bar limits in the same range
 * (Internet Explorer's 2083 being the classic one still baked into tooling).
 *
 * Why 1800 and not 2000: the URI we build is not the URI the OS finally sees —
 * a handler may re-wrap it, and percent-encoding a single accented character
 * costs up to 9 bytes. 1800 leaves headroom so a note whose summary is mostly
 * non-ASCII does not silently cross a limit we cannot observe.
 *
 * Why refusing beats truncating: a truncated `content` parameter creates a note
 * cut mid-sentence, or worse, mid-percent-escape, producing garbage in the
 * operator's vault. An explicit `uri_too_long` refusal is recoverable; a
 * corrupted note is not.
 */
export const MAX_URI_LENGTH = 1800

/**
 * Ceiling on the `content` body before encoding. Deliberately well under
 * `MAX_URI_LENGTH` because percent-encoding inflates the string (a newline
 * becomes `%0A`, an accented letter up to `%C3%A9`), so the encoded form can be
 * several times the raw length.
 */
export const MAX_CONTENT_LENGTH = 1200

// ---------------------------------------------------------------------------
// Sensitive content screening
// ---------------------------------------------------------------------------

/** Outcome of screening a body of text destined for a URI. */
export type ContentScreenResult =
  | { safe: true }
  | { safe: false; matches: string[] }

/**
 * Patterns that disqualify a string from entering a URI.
 *
 * These are intentionally BROAD. A false positive costs an operator one refused
 * link and a clear reason; a false negative puts a credential into the OS event
 * stream. The asymmetry is total, so the tuning is deliberately paranoid.
 *
 * Each entry names what it catches so a refusal can tell the caller WHICH rule
 * fired — "content refused" alone is not actionable.
 */
const SENSITIVE_PATTERNS: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  // Provider key shapes. `sk-` covers OpenAI and the many providers that copied
  // the prefix; the others are their own vendors' documented formats.
  { name: 'provider-api-key', pattern: /\bsk-[A-Za-z0-9_-]{8,}/ },
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: 'google-api-key', pattern: /\bAIza[A-Za-z0-9_-]{10,}/ },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/ },
  { name: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{12,}/ },
  { name: 'private-key-block', pattern: /-----BEGIN[A-Z ]*PRIVATE KEY-----/ },

  // Bearer / authorization headers pasted wholesale.
  { name: 'bearer-token', pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/i },
  { name: 'authorization-header', pattern: /\bauthorization\s*[:=]/i },

  // A JWT is three base64url segments joined by dots — recognisable on shape
  // alone, and never legitimate in a supervision summary.
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },

  // Keyword-assignment shapes: `password: hunter2`, `api_key=abc`, `SECRET => x`.
  // The value is required, so prose that merely mentions the word ("the password
  // rotation is overdue") is not caught — only something that looks assigned.
  {
    name: 'secret-assignment',
    pattern: /\b(?:pass(?:word|wd)|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|credential)s?\b\s*[:=]\s*\S/i,
  },

  // Env-var interpolation or a dotenv line: either means a config value is
  // being carried, and the value may be resolved before the URI is opened.
  { name: 'env-var-reference', pattern: /\$\{?[A-Z][A-Z0-9_]{3,}\}?/ },
  { name: 'process-env-reference', pattern: /process\.env\.[A-Za-z_]/ },
  { name: 'dotenv-assignment', pattern: /^[ \t]*(?:export[ \t]+)?[A-Z][A-Z0-9_]{5,}=\S/m },

  // Aigent's own token names. If one of these appears as a word in text headed
  // for a URI, something is carrying config it should not.
  { name: 'aigent-token-name', pattern: /\b(?:AMC_API_KEY|AMC_SESSION_SECRET|AIGENT_RUNTIME_[A-Z_]*TOKEN|AIGENT_INSTALLATION_TOKEN|SUPABASE_SERVICE_ROLE_KEY)\b/ },
]

/**
 * Long unbroken high-entropy runs — the shape of a raw secret even when it
 * carries no recognisable prefix.
 *
 * Base64/hex-ish runs are checked separately from the named patterns because
 * they need a length threshold rather than a literal match. 40 characters is
 * chosen so that ordinary content survives: the longest things a legitimate
 * summary carries are UUIDs (36 chars, and hyphen-broken so they never form a
 * 40-char unbroken run) and route paths (broken by `/`).
 */
const HIGH_ENTROPY_RUN = /[A-Za-z0-9+/_-]{40,}/
const LONG_HEX_RUN = /\b[0-9a-f]{32,}\b/i

/**
 * Screens a string for anything that must not enter a URI.
 *
 * Returns the list of rule names that fired rather than a bare boolean, so the
 * caller can log WHAT was refused without logging the offending content itself
 * — echoing the match back would reintroduce the leak this function prevents.
 */
export function screenContent(content: string): ContentScreenResult {
  const matches: string[] = []
  for (const { name, pattern } of SENSITIVE_PATTERNS) {
    if (pattern.test(content)) matches.push(name)
  }
  if (HIGH_ENTROPY_RUN.test(content)) matches.push('high-entropy-run')
  if (LONG_HEX_RUN.test(content)) matches.push('long-hex-run')
  return matches.length > 0 ? { safe: false, matches } : { safe: true }
}

/** Convenience predicate over `screenContent`. */
export function isContentSafeForUri(content: string): boolean {
  return screenContent(content).safe
}

// ---------------------------------------------------------------------------
// URI assembly
// ---------------------------------------------------------------------------

/**
 * Builds `obsidian://<action>?<params>` with every value percent-encoded.
 *
 * `encodeURIComponent` is applied to keys and values individually, which is the
 * only correct place to do it: encoding the assembled string instead would
 * leave a `&` inside a vault name acting as a parameter separator, and a `#`
 * truncating everything after it into a fragment. Vault names with spaces and
 * accents work for the same reason — they are encoded as values, not parsed.
 *
 * Enforces `MAX_URI_LENGTH` as the last step so no caller can bypass it.
 */
function assembleUri(action: string, params: ReadonlyArray<readonly [string, string]>): ObsidianUriResult {
  const query = params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  const uri = `obsidian://${action}?${query}`
  if (uri.length > MAX_URI_LENGTH) {
    return unavailable(
      'uri_too_long',
      `Built URI is ${uri.length} characters, over the ${MAX_URI_LENGTH} limit. Shorten the summary or link to the Aigent route instead.`,
    )
  }
  return { ok: true, uri }
}

/**
 * The single gate every builder passes through before touching a vault name.
 *
 * The failure branch is typed as the `ok: false` half of `ObsidianUriResult`
 * rather than the whole union: a plain union with `ObsidianUriResult` would
 * merge the two `ok: true` shapes and destroy narrowing on `.vault`.
 */
type VaultGate = { ok: true; vault: string } | Extract<ObsidianUriResult, { ok: false }>

function requireVault(config: ObsidianConfig): VaultGate {
  if (config.availability !== 'configured' || !config.vault) {
    return unavailable(
      'not_configured',
      'AIGENT_OBSIDIAN_VAULT is not set. Obsidian links are unavailable — render the control as disabled rather than linking nowhere.',
    )
  }
  return { ok: true, vault: config.vault }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Opens the configured vault, without targeting a note. */
export function buildOpenVaultUri(config: ObsidianConfig): ObsidianUriResult {
  const gate = requireVault(config)
  if (!gate.ok) return gate
  return assembleUri('open', [['vault', gate.vault]])
}

/**
 * Opens an existing note by vault-relative path.
 *
 * The path is normalised, never made absolute. An empty path after
 * normalisation is refused (`invalid_path`) instead of silently degrading to
 * "open the vault" — a control labelled "open this note" that opens something
 * else is a lie, even a harmless-looking one.
 */
export function buildOpenNoteUri(config: ObsidianConfig, notePath: string): ObsidianUriResult {
  const gate = requireVault(config)
  if (!gate.ok) return gate
  const path = normalizeVaultPath(notePath)
  if (!path) {
    return unavailable('invalid_path', 'Note path is empty after normalisation; nothing to open.')
  }
  return assembleUri('open', [
    ['vault', gate.vault],
    ['file', path],
  ])
}

/** Input for a pre-filled note. `content` is screened before it is encoded. */
export interface CreateNoteInput {
  /**
   * Vault-relative path. When it carries no `/`, it is placed under
   * `config.notesFolder` so generated notes never land in the vault root.
   */
  path: string
  /** Note body. Bounded and screened — see `screenContent`. */
  content: string
}

/**
 * Creates a pre-filled note via `obsidian://new`.
 *
 * Two safety choices worth stating:
 *
 *   1. **`append=true`, never `overwrite`.** If a note already exists at the
 *      path, appending adds to the operator's own file; overwriting destroys
 *      work Aigent did not author. Aigent has no business deleting an
 *      operator's note, and a supervision link is not a place to risk it.
 *   2. **Content screened BEFORE encoding.** Screening the encoded form would
 *      miss everything, since `sk-abc` percent-encodes to a string the patterns
 *      no longer match. Order matters and is load-bearing.
 *
 * Refusal is explicit on both the sensitive-content and length paths, because
 * silently dropping the body would produce an empty note that looks like a bug
 * rather than a deliberate block.
 */
export function buildCreateNoteUri(config: ObsidianConfig, input: CreateNoteInput): ObsidianUriResult {
  const gate = requireVault(config)
  if (!gate.ok) return gate

  const rawPath = normalizeVaultPath(input.path)
  if (!rawPath) {
    return unavailable('invalid_path', 'Note path is empty after normalisation; refusing to create an unnamed note.')
  }
  const path = rawPath.includes('/') ? rawPath : `${config.notesFolder}/${rawPath}`

  if (input.content.length > MAX_CONTENT_LENGTH) {
    return unavailable(
      'uri_too_long',
      `Note body is ${input.content.length} characters, over the ${MAX_CONTENT_LENGTH} limit. Summaries are bounded by design — link to the Aigent route for the full record.`,
    )
  }

  const screen = screenContent(input.content)
  if (!screen.safe) {
    return unavailable(
      'sensitive_content',
      `Refused: note body matched ${screen.matches.join(', ')}. Secrets, prompts and raw payloads never enter a URI.`,
    )
  }

  return assembleUri('new', [
    ['vault', gate.vault],
    ['file', path],
    ['content', input.content],
    ['append', 'true'],
  ])
}

/**
 * Opens Obsidian's search pane pre-filled with `query`.
 *
 * The query is screened too. It is a smaller surface than a note body, but it
 * is the one most likely to be built by interpolating something a caller did
 * not inspect, so it gets the same gate rather than a weaker one.
 */
export function buildSearchUri(config: ObsidianConfig, query: string): ObsidianUriResult {
  const gate = requireVault(config)
  if (!gate.ok) return gate

  const trimmed = query.trim()
  if (!trimmed) {
    return unavailable('empty_query', 'Search query is empty; refusing to open a blank search.')
  }

  const screen = screenContent(trimmed)
  if (!screen.safe) {
    return unavailable(
      'sensitive_content',
      `Refused: search query matched ${screen.matches.join(', ')}.`,
    )
  }

  return assembleUri('search', [
    ['vault', gate.vault],
    ['query', trimmed],
  ])
}

/**
 * Opens the supervision Canvas, when one is configured.
 *
 * A Canvas is a `.canvas` file in the vault, so this is `obsidian://open` with
 * a file path — there is no dedicated canvas action in the URI scheme (module
 * header cites the source). The distinct `canvas_not_configured` reason exists
 * so the UI can tell apart "Obsidian is not set up at all" from "Obsidian works
 * but no Canvas path was declared" — two different fixes for the operator.
 */
export function buildCanvasUri(config: ObsidianConfig): ObsidianUriResult {
  const gate = requireVault(config)
  if (!gate.ok) return gate
  if (!config.canvasPath) {
    return unavailable(
      'canvas_not_configured',
      'AIGENT_OBSIDIAN_CANVAS_PATH is not set. The Canvas control should not render.',
    )
  }
  return assembleUri('open', [
    ['vault', gate.vault],
    ['file', config.canvasPath],
  ])
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

/**
 * Versioned templates under `docs/templates/obsidian/`. The identifiers are the
 * filenames without extension; callers load the file content themselves (this
 * module does no filesystem access, per the header) and pass it to
 * `renderTemplate`.
 */
export type ObsidianTemplateId =
  | 'agent-review'
  | 'run-incident'
  | 'evaluation-decision'
  | 'improvement-proposal'

export const OBSIDIAN_TEMPLATE_IDS: readonly ObsidianTemplateId[] = [
  'agent-review',
  'run-incident',
  'evaluation-decision',
  'improvement-proposal',
]

/** Substitution map. Values are stringified; `null`/`undefined` render as the
 *  literal `unknown` rather than the string "null" — an absent value is stated
 *  as absent, never dressed up as data (AGENTS.md, "Vérité des données"). */
export type TemplateVariables = Readonly<Record<string, string | number | boolean | null | undefined>>

export type RenderTemplateResult =
  | { ok: true; content: string; missing: readonly string[] }
  | { ok: false; reason: 'sensitive_content'; matches: readonly string[] }

/**
 * Placeholder syntax: `{{variableName}}`.
 *
 * Names are `[A-Za-z0-9_]+`. Whitespace inside the braces is tolerated
 * (`{{ agentId }}`) so a template stays readable, and the captured name is
 * trimmed before lookup.
 */
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

/** Rendered in place of a variable the caller did not supply. */
export const UNRESOLVED_PLACEHOLDER = 'unknown'

/**
 * Substitutes `{{variables}}` in a template body.
 *
 * Screens the RESULT, not the inputs: a value that is harmless alone can still
 * carry a secret once interpolated, and the rendered note is what would reach a
 * URI. Unresolved placeholders are reported in `missing` rather than left in
 * the output as raw `{{...}}`, so a half-filled note is visible to the caller
 * instead of shipping template syntax into an operator's vault.
 */
export function renderTemplate(template: string, variables: TemplateVariables): RenderTemplateResult {
  const missing: string[] = []
  const content = template.replace(PLACEHOLDER, (_match, rawName: string) => {
    const name = rawName.trim()
    const value = variables[name]
    if (value === undefined || value === null) {
      missing.push(name)
      return UNRESOLVED_PLACEHOLDER
    }
    return String(value)
  })

  const screen = screenContent(content)
  if (!screen.safe) {
    return { ok: false, reason: 'sensitive_content', matches: screen.matches }
  }
  return { ok: true, content, missing }
}
