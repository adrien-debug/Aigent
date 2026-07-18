/**
 * AIG-STABILIZATION-003 · C8 — the finance-local rebrand CONTRACT.
 *
 * The C4 script (`scripts/rebrand-finance-local.ts`, owned by another worker,
 * absent from this worktree) rebrands the 7 `copilot-fin-*` agents onto the
 * direct model-router → local path. This file pins the pure, deterministic
 * TRANSFORM that script must apply, self-contained (no import of the script,
 * no DB, no network, no secret) so the contract is testable independently and
 * the script has an executable spec to satisfy.
 *
 * The frozen contract (stab-correctifs.md · C4):
 *   - a `copilot-fin-*` row is rebranded to model_provider='local',
 *     model='local-llama-70b', and its inert assistant_id is cleared to NULL
 *     (dead metadata on the direct path);
 *   - the `runtime` column is LEFT AS-IS (execution goes through the model
 *     router, not by mutating runtime here);
 *   - a NON-fin copilot is left completely untouched (scoped to the 7);
 *   - the transform is IDEMPOTENT: re-applying it to an already-rebranded row
 *     is a byte-for-byte no-op.
 * Amounts are irrelevant here (no money), but the "no invented value" rule
 * still holds: nothing is fabricated — assistant_id becomes an explicit NULL,
 * never a placeholder string.
 */
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// The contract under test — the pure rebrand transform. This is the exact
// shape the C4 script's PATCH bodies must produce. Kept here as the frozen
// executable spec (the script owns the DB round-trip; this owns the logic).
// ---------------------------------------------------------------------------

/** The two DB row kinds the rebrand touches, reduced to the relevant columns. */
interface CopilotRow {
  id: string
  model_provider: string
  model: string
  runtime: string
  assistant_id: string | null
  [k: string]: unknown
}

const LOCAL_PROVIDER = 'local'
const LOCAL_MODEL = 'local-llama-70b'
const FIN_PREFIX = 'copilot-fin-'

/** True for exactly the 7 AP finance copilots (scope guard). */
function isFinanceCopilot(id: string): boolean {
  return id.startsWith(FIN_PREFIX)
}

/**
 * Pure, deterministic rebrand of ONE row. A non-finance row is returned
 * unchanged (identity). A finance row is returned with provider/model set to
 * the local pair and its inert assistant_id cleared; `runtime` is untouched.
 * Idempotent: applying it twice equals applying it once.
 */
function rebrandRow(row: CopilotRow): CopilotRow {
  if (!isFinanceCopilot(row.id)) return row
  return {
    ...row,
    model_provider: LOCAL_PROVIDER,
    model: LOCAL_MODEL,
    assistant_id: null,
  }
}

function rebrandAll(rows: CopilotRow[]): CopilotRow[] {
  return rows.map(rebrandRow)
}

// ---------------------------------------------------------------------------
// Fixtures — the 7 fin-* agents in their pre-rebrand (drafted, openai) state.
// ---------------------------------------------------------------------------

const FIN_SLUGS = [
  'copilot-fin-documents',
  'copilot-fin-fournisseurs',
  'copilot-fin-controle-factures',
  'copilot-fin-securite-fournisseurs',
  'copilot-fin-ecritures',
  'copilot-fin-controleur-general',
  'copilot-fin-paiements',
] as const

function preRebrandFinRow(id: string): CopilotRow {
  return {
    id,
    model_provider: 'openai',
    model: 'gpt-5.4',
    runtime: 'openai-assistants',
    assistant_id: `asst_${id.replace(/[^a-z0-9]/g, '')}`,
    status: 'draft',
  }
}

// ---------------------------------------------------------------------------
// (1) Every fin-* row is rebranded to the local pair with a null assistant_id.
// ---------------------------------------------------------------------------

describe('finance-local rebrand — the 7 fin-* agents go local', () => {
  it('sets provider=local, model=local-llama-70b, assistant_id=null on each', () => {
    for (const id of FIN_SLUGS) {
      const out = rebrandRow(preRebrandFinRow(id))
      expect(out.model_provider).toBe('local')
      expect(out.model).toBe('local-llama-70b')
      expect(out.assistant_id).toBeNull()
    }
  })

  it('leaves runtime untouched (execution routes via the model-router, not here)', () => {
    const before = preRebrandFinRow('copilot-fin-ecritures')
    const after = rebrandRow(before)
    expect(after.runtime).toBe(before.runtime) // 'openai-assistants' preserved
    expect(after.runtime).toBe('openai-assistants')
  })

  it('clears assistant_id to an EXPLICIT null, never a placeholder string', () => {
    const out = rebrandRow(preRebrandFinRow('copilot-fin-documents'))
    expect(out.assistant_id).toBeNull()
    expect(typeof out.assistant_id).not.toBe('string')
  })

  it('rebrands the WHOLE set — all 7 end at provider=local', () => {
    const out = rebrandAll(FIN_SLUGS.map(preRebrandFinRow))
    expect(out).toHaveLength(7)
    expect(out.every((r) => r.model_provider === 'local')).toBe(true)
    expect(out.every((r) => r.model === 'local-llama-70b')).toBe(true)
    expect(out.every((r) => r.assistant_id === null)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (2) Scope guard — a non-finance copilot is never touched.
// ---------------------------------------------------------------------------

describe('finance-local rebrand — scoped strictly to copilot-fin-*', () => {
  it('leaves a non-finance copilot completely unchanged (identity)', () => {
    const other: CopilotRow = {
      id: 'copilot-atlas',
      model_provider: 'openai',
      model: 'gpt-5.4',
      runtime: 'langgraph',
      assistant_id: 'asst_atlas_live',
      status: 'ready',
    }
    const out = rebrandRow(other)
    expect(out).toBe(other) // same reference — provably untouched
    expect(out.model_provider).toBe('openai')
    expect(out.assistant_id).toBe('asst_atlas_live')
  })

  it('a mixed batch rebrands only the fin-* rows', () => {
    const rows: CopilotRow[] = [
      preRebrandFinRow('copilot-fin-paiements'),
      {
        id: 'copilot-vector',
        model_provider: 'openai',
        model: 'gpt-5.4',
        runtime: 'langgraph',
        assistant_id: 'asst_vector',
        status: 'ready',
      },
    ]
    const out = rebrandAll(rows)
    expect(out[0]?.model_provider).toBe('local')
    expect(out[0]?.assistant_id).toBeNull()
    // untouched neighbour
    expect(out[1]?.model_provider).toBe('openai')
    expect(out[1]?.assistant_id).toBe('asst_vector')
  })

  it('an id that merely CONTAINS "fin" but is not a prefix is not rebranded', () => {
    const notFin: CopilotRow = {
      id: 'copilot-refine-loop',
      model_provider: 'openai',
      model: 'gpt-5.4',
      runtime: 'langgraph',
      assistant_id: 'asst_refine',
      status: 'ready',
    }
    expect(rebrandRow(notFin)).toBe(notFin)
  })
})

// ---------------------------------------------------------------------------
// (3) Idempotence — re-running the rebrand is a byte-for-byte no-op.
// ---------------------------------------------------------------------------

describe('finance-local rebrand — idempotent', () => {
  it('applying the transform twice equals applying it once (per row)', () => {
    for (const id of FIN_SLUGS) {
      const once = rebrandRow(preRebrandFinRow(id))
      const twice = rebrandRow(once)
      expect(twice).toEqual(once)
    }
  })

  it('an already-rebranded row is returned byte-identical', () => {
    const already: CopilotRow = {
      id: 'copilot-fin-tva',
      model_provider: 'local',
      model: 'local-llama-70b',
      runtime: 'openai-assistants',
      assistant_id: null,
      status: 'draft',
    }
    const out = rebrandRow(already)
    expect(out).toEqual(already)
  })

  it('the whole set is stable under a second full pass', () => {
    const first = rebrandAll(FIN_SLUGS.map(preRebrandFinRow))
    const second = rebrandAll(first)
    expect(second).toEqual(first)
  })
})
