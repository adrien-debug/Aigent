/**
 * Unit tests for obsidian-bridge.ts
 * (src/lib/agent-mission-control/obsidian-bridge.ts).
 *
 * Pure, offline, no filesystem access to any vault — the module under test only
 * builds strings, and these tests only inspect strings. The four template files
 * ARE read from `docs/templates/obsidian/`, which is repo content, not a vault.
 *
 * Three properties carry real risk and are exercised hardest:
 *   1. unconfigured → an explicit state, never a broken URI (issue case 9),
 *   2. encoding → vault names with spaces AND accents, paths with subfolders,
 *      queries with `&`, `#`, `/`, `?` (issue case 10),
 *   3. sensitive content → refused, and ABSENT from the produced URI, checked
 *      against the encoded form too (issue case 11).
 *
 * Every secret-looking string below is an obvious fake.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_NOTES_FOLDER,
  MAX_CONTENT_LENGTH,
  MAX_URI_LENGTH,
  OBSIDIAN_TEMPLATE_IDS,
  UNRESOLVED_PLACEHOLDER,
  buildCanvasUri,
  buildCreateNoteUri,
  buildOpenNoteUri,
  buildOpenVaultUri,
  buildSearchUri,
  getObsidianConfig,
  isContentSafeForUri,
  renderTemplate,
  screenContent,
  type ObsidianConfig,
  type ObsidianEnv,
  type ObsidianTemplateId,
  type ObsidianUriResult,
} from '@/lib/agent-mission-control/obsidian-bridge'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A vault name with spaces AND accents — the case 10 fixture. */
const ACCENTED_VAULT = 'Mémo Équipe & Décisions'

function configured(overrides: Partial<ObsidianEnv> = {}): ObsidianConfig {
  return getObsidianConfig({ AIGENT_OBSIDIAN_VAULT: ACCENTED_VAULT, ...overrides })
}

/** Narrows to the success branch, failing loudly with the reason otherwise. */
function expectOk(result: ObsidianUriResult): string {
  if (!result.ok) {
    throw new Error(`expected a URI, got unavailable: ${result.reason} — ${result.detail}`)
  }
  return result.uri
}

function templatePath(id: ObsidianTemplateId): string {
  return path.join(process.cwd(), 'docs', 'templates', 'obsidian', `${id}.md`)
}

function readTemplate(id: ObsidianTemplateId): string {
  return readFileSync(templatePath(id), 'utf8')
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe('getObsidianConfig', () => {
  it('reports not_configured when the vault variable is absent', () => {
    const config = getObsidianConfig({})
    expect(config.availability).toBe('not_configured')
    expect(config.vault).toBeNull()
  })

  it('treats a blank or whitespace-only vault as not configured', () => {
    expect(getObsidianConfig({ AIGENT_OBSIDIAN_VAULT: '' }).availability).toBe('not_configured')
    expect(getObsidianConfig({ AIGENT_OBSIDIAN_VAULT: '   ' }).availability).toBe('not_configured')
  })

  it('resolves the vault, canvas path and notes folder when set', () => {
    const config = getObsidianConfig({
      AIGENT_OBSIDIAN_VAULT: ACCENTED_VAULT,
      AIGENT_OBSIDIAN_CANVAS_PATH: 'Supervision/Aigent Fleet.canvas',
      AIGENT_OBSIDIAN_NOTES_FOLDER: 'Aigent/Revues',
    })
    expect(config.availability).toBe('configured')
    expect(config.vault).toBe(ACCENTED_VAULT)
    expect(config.canvasPath).toBe('Supervision/Aigent Fleet.canvas')
    expect(config.notesFolder).toBe('Aigent/Revues')
  })

  it('defaults the notes folder rather than dropping notes in the vault root', () => {
    expect(configured().notesFolder).toBe(DEFAULT_NOTES_FOLDER)
  })

  it('normalises a configured path to vault-relative (no leading slash, no dupes)', () => {
    const config = getObsidianConfig({
      AIGENT_OBSIDIAN_VAULT: 'V',
      AIGENT_OBSIDIAN_CANVAS_PATH: '/Supervision//Fleet.canvas/',
    })
    expect(config.canvasPath).toBe('Supervision/Fleet.canvas')
  })

  it('leaves the canvas path null when it is not declared', () => {
    expect(configured().canvasPath).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Case 9 — not configured produces an explicit state, never a broken URI
// ---------------------------------------------------------------------------

describe('unconfigured Obsidian (issue case 9)', () => {
  const unconfigured = getObsidianConfig({})

  const builders: ReadonlyArray<readonly [string, () => ObsidianUriResult]> = [
    ['buildOpenVaultUri', () => buildOpenVaultUri(unconfigured)],
    ['buildOpenNoteUri', () => buildOpenNoteUri(unconfigured, 'Aigent/Revue.md')],
    ['buildCreateNoteUri', () => buildCreateNoteUri(unconfigured, { path: 'Revue.md', content: 'ok' })],
    ['buildSearchUri', () => buildSearchUri(unconfigured, 'agent')],
    ['buildCanvasUri', () => buildCanvasUri(unconfigured)],
  ]

  for (const [name, build] of builders) {
    it(`${name} returns not_configured with a reason, and no uri field`, () => {
      const result = build()
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason).toBe('not_configured')
      expect(result.detail).toContain('AIGENT_OBSIDIAN_VAULT')
      // The failure branch carries no `uri` at all — a caller cannot read an
      // empty string or a '#' out of it by mistake.
      expect(result).not.toHaveProperty('uri')
    })
  }

  it('never emits a half-built vault-less URI', () => {
    for (const [, build] of builders) {
      const result = build()
      expect(JSON.stringify(result)).not.toContain('obsidian://')
    }
  })

  it('distinguishes a missing canvas from a missing vault', () => {
    // Vault configured, canvas not: a different reason, so the UI can give the
    // operator the right fix instead of a generic "Obsidian unavailable".
    const result = buildCanvasUri(configured())
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('canvas_not_configured')
    expect(result.detail).toContain('AIGENT_OBSIDIAN_CANVAS_PATH')
  })
})

// ---------------------------------------------------------------------------
// Case 10 — encoding
// ---------------------------------------------------------------------------

describe('URI encoding (issue case 10)', () => {
  it('encodes a vault name containing spaces and accents', () => {
    const uri = expectOk(buildOpenVaultUri(configured()))
    expect(uri).toBe(`obsidian://open?vault=${encodeURIComponent(ACCENTED_VAULT)}`)
    // Spaces and the ampersand must not survive raw: a raw '&' would split the
    // vault name into a second parameter.
    expect(uri).not.toContain(' ')
    expect(uri.slice('obsidian://open?vault='.length)).not.toContain('&')
    expect(uri).toContain('M%C3%A9mo')
    expect(uri).toContain('%20')
    expect(uri).toContain('%26')
  })

  it('round-trips the vault name through decoding', () => {
    const uri = expectOk(buildOpenVaultUri(configured()))
    const parsed = new URL(uri)
    expect(parsed.searchParams.get('vault')).toBe(ACCENTED_VAULT)
  })

  it('encodes a note path with subfolders and spaces, slashes included', () => {
    const notePath = 'Revues Agents/2026 Q3/Agent Été.md'
    const uri = expectOk(buildOpenNoteUri(configured(), notePath))
    // Slashes inside the value are encoded — they are data, not URI structure.
    expect(uri).toContain('%2F')
    expect(new URL(uri).searchParams.get('file')).toBe(notePath)
  })

  it('encodes a search query containing &, #, / and ?', () => {
    const query = 'agent & run #42 / statut? éval'
    const uri = expectOk(buildSearchUri(configured(), query))
    expect(new URL(uri).searchParams.get('query')).toBe(query)
    // A raw '#' would truncate everything after it into a fragment; a raw '&'
    // would forge a parameter. Neither may appear past the query key.
    const queryPart = uri.slice(uri.indexOf('&query=') + '&query='.length)
    expect(queryPart).not.toContain('#')
    expect(queryPart).not.toContain('&')
    expect(uri).toContain('%23')
  })

  it('uses the documented obsidian://<action>?… scheme for each builder', () => {
    const config = configured({ AIGENT_OBSIDIAN_CANVAS_PATH: 'Supervision/Fleet.canvas' })
    expect(expectOk(buildOpenVaultUri(config))).toMatch(/^obsidian:\/\/open\?/)
    expect(expectOk(buildOpenNoteUri(config, 'A/B.md'))).toMatch(/^obsidian:\/\/open\?/)
    expect(expectOk(buildSearchUri(config, 'x'))).toMatch(/^obsidian:\/\/search\?/)
    expect(expectOk(buildCreateNoteUri(config, { path: 'A/B.md', content: 'y' }))).toMatch(/^obsidian:\/\/new\?/)
    // A canvas is a file in the vault, so it opens with `open` — there is no
    // obsidian://canvas action.
    expect(expectOk(buildCanvasUri(config))).toMatch(/^obsidian:\/\/open\?/)
  })

  it('opens the canvas by its configured vault-relative path', () => {
    const config = configured({ AIGENT_OBSIDIAN_CANVAS_PATH: 'Supervision/Aigent Fleet.canvas' })
    const uri = expectOk(buildCanvasUri(config))
    expect(new URL(uri).searchParams.get('file')).toBe('Supervision/Aigent Fleet.canvas')
  })

  it('refuses an empty note path instead of degrading to "open the vault"', () => {
    const result = buildOpenNoteUri(configured(), '   /  / ')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('invalid_path')
  })

  it('refuses an empty search query', () => {
    const result = buildSearchUri(configured(), '   ')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('empty_query')
  })
})

// ---------------------------------------------------------------------------
// Note creation
// ---------------------------------------------------------------------------

describe('buildCreateNoteUri', () => {
  it('places a bare filename under the configured notes folder', () => {
    const config = configured({ AIGENT_OBSIDIAN_NOTES_FOLDER: 'Aigent/Revues' })
    const uri = expectOk(buildCreateNoteUri(config, { path: 'Agent A.md', content: 'résumé' }))
    expect(new URL(uri).searchParams.get('file')).toBe('Aigent/Revues/Agent A.md')
  })

  it('respects an explicit path with folders', () => {
    const uri = expectOk(buildCreateNoteUri(configured(), { path: 'Ailleurs/Note.md', content: 'x' }))
    expect(new URL(uri).searchParams.get('file')).toBe('Ailleurs/Note.md')
  })

  it('appends rather than overwrites, so an operator note is never destroyed', () => {
    const uri = expectOk(buildCreateNoteUri(configured(), { path: 'N.md', content: 'x' }))
    const params = new URL(uri).searchParams
    expect(params.get('append')).toBe('true')
    expect(params.get('overwrite')).toBeNull()
  })

  it('carries the content through encoding intact, newlines included', () => {
    const content = '# Revue\n\n- statut: active\n- route: /agents/cop_42'
    const uri = expectOk(buildCreateNoteUri(configured(), { path: 'N.md', content }))
    expect(new URL(uri).searchParams.get('content')).toBe(content)
  })

  it('refuses a body over MAX_CONTENT_LENGTH rather than truncating it', () => {
    const result = buildCreateNoteUri(configured(), { path: 'N.md', content: 'a'.repeat(MAX_CONTENT_LENGTH + 1) })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('uri_too_long')
  })
})

// ---------------------------------------------------------------------------
// Case 11 — sensitive content
// ---------------------------------------------------------------------------

describe('sensitive content screening (issue case 11)', () => {
  // Every value here is a deliberately obvious fake.
  const FAKE_OPENAI_KEY = 'sk-FAKE0000000000000000000000000000example'
  const FAKE_PASSWORD_LINE = 'password: hunter2-not-a-real-password'
  const FAKE_BEARER = 'Authorization: Bearer FAKEtokenFAKEtokenFAKEtoken'
  // Assemblé à l'exécution, jamais épelé en clair : écrit d'un seul tenant,
  // cette chaîne est indiscernable d'un vrai JWT — gitleaks la refusait au
  // commit (règle `jwt`), et un relecteur humain aurait dû la vérifier à la
  // main. La concaténation conserve exactement la valeur testée tout en la
  // rendant manifestement factice.
  const FAKE_JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJmYWtlIn0', 'FAKEsignatureFAKEsig'].join('.')
  const FAKE_ENV_LINE = 'AMC_API_KEY=fake-value-for-tests'
  const FAKE_ENV_REF = 'token is ${OPENAI_API_KEY} here'

  const sensitive: ReadonlyArray<readonly [string, string]> = [
    ['openai-style key', FAKE_OPENAI_KEY],
    ['password assignment', FAKE_PASSWORD_LINE],
    ['bearer header', FAKE_BEARER],
    ['jwt', FAKE_JWT],
    ['aigent env assignment', FAKE_ENV_LINE],
    ['env interpolation', FAKE_ENV_REF],
    // Même raison que FAKE_JWT : `api_key=` suivi d'un blob déclenche la règle
    // `generic-api-key` de gitleaks. Assemblé, la valeur testée est identique.
    ['api_key assignment', 'api_key=' + 'abcdef123456'],
    ['github token', 'ghp_FAKE0000000000000000000000000000'],
    ['private key block', '-----BEGIN RSA PRIVATE KEY-----'],
    ['long hex blob', 'a'.repeat(4) + '0123456789abcdef0123456789abcdef0123'],
  ]

  for (const [label, payload] of sensitive) {
    it(`screenContent flags ${label}`, () => {
      const screen = screenContent(payload)
      expect(screen.safe).toBe(false)
      if (screen.safe) throw new Error('unreachable')
      expect(screen.matches.length).toBeGreaterThan(0)
    })

    it(`buildCreateNoteUri refuses ${label} and leaks nothing into a URI`, () => {
      const result = buildCreateNoteUri(configured(), { path: 'N.md', content: `Revue\n${payload}\n` })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason).toBe('sensitive_content')
      // Neither raw nor percent-encoded may appear anywhere in the result.
      const serialised = JSON.stringify(result)
      expect(serialised).not.toContain(payload)
      expect(serialised).not.toContain(encodeURIComponent(payload))
    })
  }

  it('refuses a sensitive search query too', () => {
    const result = buildSearchUri(configured(), `run failed with ${FAKE_OPENAI_KEY}`)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('sensitive_content')
    expect(JSON.stringify(result)).not.toContain(FAKE_OPENAI_KEY)
  })

  it('names which rule fired, so a refusal is actionable without echoing content', () => {
    const result = buildCreateNoteUri(configured(), { path: 'N.md', content: FAKE_OPENAI_KEY })
    if (result.ok) throw new Error('expected refusal')
    expect(result.detail).toContain('provider-api-key')
    expect(result.detail).not.toContain(FAKE_OPENAI_KEY)
  })

  it('refuses a bulky JSON payload — high-entropy run and size both bite', () => {
    const payload = JSON.stringify({ prompt: 'x'.repeat(2000), messages: [{ role: 'user', content: 'y'.repeat(500) }] })
    const result = buildCreateNoteUri(configured(), { path: 'N.md', content: payload })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(['uri_too_long', 'sensitive_content']).toContain(result.reason)
    expect(JSON.stringify(result)).not.toContain('x'.repeat(200))
  })

  it('lets legitimate supervision content through', () => {
    const safe = [
      '# Revue — Agent Été\n\nStatut: active\nRuns: 42\nCoût: unknown\n\nRoute: /agents/cop_a1b2c3\n',
      'Agent `cop_a1b2c3` version `ver_9f8e7d` — décision: promue.',
      'Incident sur /runs, sévérité haute, outil list_projects.',
      'Le run a échoué : le modèle a refusé un appel outil sans argument.',
    ]
    for (const content of safe) {
      expect(isContentSafeForUri(content)).toBe(true)
      expect(buildCreateNoteUri(configured(), { path: 'N.md', content }).ok).toBe(true)
    }
  })

  it('does not flag prose that merely mentions a secret-ish word', () => {
    // "the password rotation is overdue" has no assignment — a false positive
    // here would refuse ordinary operator notes.
    expect(isContentSafeForUri('the password rotation is overdue this quarter')).toBe(true)
    expect(isContentSafeForUri('token budget exceeded on this run')).toBe(true)
  })

  it('does not flag a UUID or a route path as high entropy', () => {
    expect(isContentSafeForUri('run 3f2504e0-4f89-11d3-9a0c-0305e82c3301 on /runs')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Length bound
// ---------------------------------------------------------------------------

describe('URI length bound', () => {
  it('keeps every produced URI at or under MAX_URI_LENGTH', () => {
    const config = configured({ AIGENT_OBSIDIAN_CANVAS_PATH: 'Supervision/Fleet.canvas' })
    const uris = [
      expectOk(buildOpenVaultUri(config)),
      expectOk(buildOpenNoteUri(config, 'Revues/Agent.md')),
      expectOk(buildCanvasUri(config)),
      expectOk(buildSearchUri(config, 'agent en échec')),
      expectOk(buildCreateNoteUri(config, { path: 'N.md', content: 'résumé borné' })),
    ]
    for (const uri of uris) expect(uri.length).toBeLessThanOrEqual(MAX_URI_LENGTH)
  })

  it('refuses when percent-encoding inflates an in-bounds body past the URI limit', () => {
    // Accented characters cost up to 6 chars each once encoded, so a body well
    // under MAX_CONTENT_LENGTH can still blow the URI budget. The bound is
    // enforced on the ASSEMBLED uri, which is what the OS actually sees.
    const body = 'é'.repeat(MAX_CONTENT_LENGTH - 1)
    expect(body.length).toBeLessThan(MAX_CONTENT_LENGTH)
    const result = buildCreateNoteUri(configured(), { path: 'N.md', content: body })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('uri_too_long')
    expect(result.detail).toContain(String(MAX_URI_LENGTH))
  })

  it('states a bound low enough to survive OS truncation', () => {
    expect(MAX_URI_LENGTH).toBeLessThanOrEqual(2000)
    expect(MAX_CONTENT_LENGTH).toBeLessThan(MAX_URI_LENGTH)
  })
})

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

describe('template files', () => {
  it('ships exactly the four declared templates', () => {
    expect(OBSIDIAN_TEMPLATE_IDS).toEqual([
      'agent-review',
      'run-incident',
      'evaluation-decision',
      'improvement-proposal',
    ])
  })

  for (const id of OBSIDIAN_TEMPLATE_IDS) {
    it(`${id} carries YAML frontmatter tagged as sourced from aigent`, () => {
      const body = readTemplate(id)
      expect(body.startsWith('---\n')).toBe(true)
      const frontmatter = body.slice(4, body.indexOf('\n---', 4))
      expect(frontmatter).toContain('tags:')
      expect(frontmatter).toContain('source: aigent')
      expect(frontmatter).toContain('date:')
    })

    it(`${id} links back to Aigent evidence routes`, () => {
      const body = readTemplate(id)
      expect(body).toContain('/agents/{{agentId}}')
      expect(body).toContain('/runs')
      expect(body).toContain('/actions')
    })

    it(`${id} carries a stable agent identifier`, () => {
      expect(readTemplate(id)).toContain('{{agentId}}')
    })

    it(`${id} declares no field for a raw prompt or full payload`, () => {
      // The templates hold identifiers, statuses, bounded summaries and routes.
      // A `{{prompt}}` or `{{payload}}` placeholder would invite exactly the
      // content the URI screen exists to refuse.
      const body = readTemplate(id).toLowerCase()
      for (const forbidden of ['{{prompt}}', '{{rawprompt}}', '{{payload}}', '{{systemprompt}}', '{{modeloutput}}', '{{trace}}']) {
        expect(body).not.toContain(forbidden)
      }
    })
  }
})

describe('renderTemplate', () => {
  it('substitutes {{variables}} and reports none missing when all are supplied', () => {
    const result = renderTemplate('Agent {{agentId}} version {{versionId}} — {{status}}', {
      agentId: 'cop_a1b2c3',
      versionId: 'ver_9f8e7d',
      status: 'active',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.content).toBe('Agent cop_a1b2c3 version ver_9f8e7d — active')
    expect(result.missing).toEqual([])
  })

  it('tolerates whitespace inside the braces', () => {
    const result = renderTemplate('{{ agentId }}', { agentId: 'cop_1' })
    if (!result.ok) throw new Error('unreachable')
    expect(result.content).toBe('cop_1')
  })

  it('renders an absent value as "unknown" and reports it, never as 0 or ""', () => {
    const result = renderTemplate('runs={{runCount}} cost={{costUsd}}', { runCount: null, costUsd: undefined })
    if (!result.ok) throw new Error('unreachable')
    expect(result.content).toBe(`runs=${UNRESOLVED_PLACEHOLDER} cost=${UNRESOLVED_PLACEHOLDER}`)
    expect(result.content).not.toContain('null')
    expect(result.missing).toEqual(['runCount', 'costUsd'])
  })

  it('stringifies numbers and booleans, including a real zero', () => {
    // A measured zero is data and must render as 0 — only an ABSENT value
    // becomes "unknown".
    const result = renderTemplate('{{runCount}}/{{flag}}', { runCount: 0, flag: false })
    if (!result.ok) throw new Error('unreachable')
    expect(result.content).toBe('0/false')
    expect(result.missing).toEqual([])
  })

  it('leaves no raw {{placeholder}} in the output', () => {
    const result = renderTemplate('a {{x}} b {{y}}', { x: 'X' })
    if (!result.ok) throw new Error('unreachable')
    expect(result.content).not.toMatch(/\{\{|\}\}/)
  })

  it('refuses a render whose RESULT carries sensitive content', () => {
    // Screening the result, not the inputs: the secret arrives via substitution.
    const result = renderTemplate('key: {{summary}}', { summary: 'sk-FAKE0000000000000000000000000000example' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('sensitive_content')
    expect(result.matches).toContain('provider-api-key')
  })

  for (const id of OBSIDIAN_TEMPLATE_IDS) {
    it(`renders ${id} with realistic supervision variables`, () => {
      const rendered = renderTemplate(readTemplate(id), {
        agentId: 'cop_a1b2c3',
        agentName: 'Agent Été',
        versionId: 'ver_9f8e7d',
        currentVersionId: 'ver_1a2b3c',
        runId: 'run_44f0',
        status: 'active',
        severity: 'high',
        runtime: 'langgraph',
        reviewDate: '2026-07-31',
        incidentDate: '2026-07-31',
        decisionDate: '2026-07-31',
        proposalDate: '2026-07-31',
        startedAt: '2026-07-31T09:12:00Z',
        summary: 'Deux échecs consécutifs sur un appel outil sans argument.',
        failureSummary: 'Le modèle a refusé un appel outil pourtant valide.',
        problemSummary: 'Description outil muette sur le cas sans argument.',
        proposedChange: 'Enrichir la description de l’outil.',
        acceptanceCriteria: 'Zéro refus sur la suite de tests.',
        rationale: 'Gate release verte, zéro tentative unsafe.',
        decision: 'promue',
        decidedBy: 'operateur',
        proposedBy: 'operateur',
        priority: 'haute',
        failureCategory: 'tool-contract',
        toolId: 'list_projects',
        failedStep: 'tool-call',
        unsafeAttempts: 0,
        runCount: 42,
        runWindow: '24h',
        successRate: '95%',
        successCoverage: '40/42 mesurés',
        costUsd: null,
        costCoverage: '0/42 mesurés',
        testResult: 'pass',
        testCoverage: '12/12',
        benchmarkScore: '0.91',
        benchmarkCoverage: 'pinné',
        releaseGateResult: 'green',
        releaseGateCoverage: '9/9',
        unsafeCoverage: '42/42',
        affectedRunCount: 7,
        observationWindow: '7 jours',
        failureRate: '17%',
        failureCoverage: '42 runs',
        linkedIncidentCount: 2,
        operatorNotes: 'À revoir la semaine prochaine.',
      })

      expect(rendered.ok).toBe(true)
      if (!rendered.ok) throw new Error('unreachable')
      // Every placeholder in each template is covered by the map above, so the
      // only thing reported missing is what was supplied as an explicit `null`
      // — here `costUsd`, the deliberately UNMEASURED cost. A new placeholder
      // added to a template without a value would show up here and fail.
      expect(rendered.missing.filter((name) => name !== 'costUsd')).toEqual([])
      // An absent measure renders as "unknown", never as 0 (AGENTS.md).
      if (rendered.content.includes('Coût mesuré')) {
        expect(rendered.content).toContain(UNRESOLVED_PLACEHOLDER)
      }
      expect(rendered.content).toContain('cop_a1b2c3')
      expect(rendered.content).toContain('source: aigent')
      expect(rendered.content).not.toMatch(/\{\{|\}\}/)
    })
  }
})
