'use client'

import { type CSSProperties, useState } from 'react'

import { Button } from '@/components/catalyst/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/catalyst/dialog'
import { Field, Fieldset, Label } from '@/components/catalyst/fieldset'
import { Input } from '@/components/catalyst/input'
import { Select } from '@/components/catalyst/select'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'
import { EXPLICIT_RELATION_TYPES } from '@/lib/agent-mission-control/project-team/relations'
import type { TeamAgentView } from './project-team-panel'

const MAX_LABEL_LENGTH = 200

/**
 * Destructive fill, same convention as `delete-project-dialog.tsx` — see the
 * comment there for why this is an inline style rather than a className.
 * Deleting a relation used the very same `<Button color="accent">` as the
 * dialog's own confirm and as every constructive primary in the dashboard, so
 * nothing but the label distinguished building from destroying.
 */
type ButtonVars = CSSProperties & Record<'--btn-bg' | '--btn-border' | '--btn-hover-overlay', string>

const dangerSolidStyle: ButtonVars = {
  '--btn-bg': 'var(--state-danger-solid)',
  '--btn-border': 'var(--state-danger-solid-line)',
  '--btn-hover-overlay': 'rgb(255 255 255 / 12%)',
}

/**
 * Ceiling on ONE relation write, client-side.
 *
 * Neither dialog is dismissable while its request is in flight (that veto is
 * what guarantees the outcome is always reported — see `closeUnlessSaving`),
 * so a request that never settles is a modal with no exit at all: the operator
 * reloads the page or waits forever. The server's own waits are additive and
 * far longer than any single one of them suggests — a POST chains `getProject`,
 * the endpoint verification and the insert, each with its own 30s PostgREST
 * ceiling — and a dropped connection (VPN off, laptop asleep) never settles at
 * all. This bounds "no outcome" so it can never mean "no exit".
 */
const REQUEST_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_SECONDS = REQUEST_TIMEOUT_MS / 1000

/**
 * `AbortSignal.timeout` rejects with a `TimeoutError` `DOMException`; an
 * explicit `AbortController.abort()` rejects with `AbortError`. Both mean the
 * same thing to an operator — we stopped waiting, and we do NOT know what the
 * server did — so both must map to the honest "timed out" copy rather than
 * being swallowed into the generic failure string.
 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

/**
 * The exactly-5 relation types that persist a `project_agent_relations` row,
 * in DATA-ENTRY order (most commonly created relation first — deliberately
 * not relations.ts's read-time ranking, which puts `orchestrates` first).
 * `project-membership`, `team-membership` and `shares-tool` are DERIVED edge
 * kinds — they carry no DB row and must never appear in this form. The VALUES
 * here must stay a subset of `EXPLICIT_RELATION_TYPES` (relations.ts, the one
 * place that enumerates the storable kinds) — `isStorableRelationType` below
 * checks against that import directly rather than against this list, so a
 * type this form doesn't yet know about is rejected client-side too, not
 * silently offered.
 */
const STORABLE_RELATION_TYPES = [
  { value: 'depends-on', label: 'Depends on' },
  { value: 'sends-output-to', label: 'Sends output to' },
  { value: 'reviews', label: 'Reviews' },
  { value: 'triggers', label: 'Triggers' },
  { value: 'orchestrates', label: 'Orchestrates' },
] as const

type StorableRelationType = (typeof STORABLE_RELATION_TYPES)[number]['value']

function isStorableRelationType(value: string): value is StorableRelationType {
  return EXPLICIT_RELATION_TYPES.some((type) => type === value)
}

function createRelation(
  projectId: string,
  body: { sourceCopilotId: string; targetCopilotId: string; relationType: StorableRelationType; label?: string }
) {
  return fetch(`/api/agent-ops/projects/${encodeURIComponent(projectId)}/relations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/**
 * Honest, specific copy per status — never one generic "failed" string for
 * every code. 409/422/404 are named explicitly because they are the ones an
 * operator can act on (pick a different target, a different type, or notice
 * the project is gone); everything else falls back to the server's own
 * message via `messageForResponse` (which already special-cases 503).
 */
async function messageForCreateResponse(res: Response): Promise<string> {
  if (res.status === 409) return 'This relation already exists.'
  if (res.status === 422) return 'One of these agents is not a member of this project.'
  if (res.status === 404) return 'This project could not be found.'
  if (res.status === 400) return await messageForResponse(res, 'Invalid relation — check the fields and try again.')
  return await messageForResponse(res, 'Could not create the relation — try again.')
}

/**
 * Create a `project_agent_relations` row between two agents of the SAME
 * project. Target picker and relation-type picker are both closed sets: the
 * target list is `candidates` (agents of this project, source excluded by the
 * caller — self-edges are rejected server-side and never offered here), and
 * the relation type is restricted to the 5 storable kinds.
 *
 * AC-8: success does not draw an edge locally. It calls `onDone`, which the
 * view wires to `refreshNow()` — the canvas only ever shows what the server
 * confirms.
 *
 * MOUNTING: like `DeleteRelationDialog`, this is mounted on the payload it acts
 * on (`sourceAgent`, captured at open time) and NOT on the live selection. It
 * was previously mounted on the selection, so pressing browser Back mid-submit
 * dropped the `agent` search param, unmounted this component, and the pending
 * `setError`/`onDone` landed on a dead tree — on a 5xx the operator was told
 * nothing at all, which is exactly the outcome the dismissal veto below exists
 * to make unreachable. `candidates` stays LIVE (re-derived from the polled
 * graph) because the target reconciliation below depends on seeing an agent
 * leave the project; only the source identity is snapshotted.
 */
export function AddRelationDialog({
  projectId,
  sourceAgent,
  candidates,
  open,
  onClose,
  onDone,
}: {
  projectId: string
  sourceAgent: TeamAgentView
  /** Agents of this project, excluding the source. */
  candidates: TeamAgentView[]
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  // The first candidate is the opening default and ONLY the opening default —
  // see the reconciliation below for why it must never be re-applied later.
  // The parent mounts one instance per source agent (keyed), so every open
  // starts from these initializers; there is no reset-on-`open` pass to do.
  const [targetId, setTargetId] = useState<string>(() => candidates[0]?.id ?? '')
  const [relationType, setRelationType] = useState<StorableRelationType>('depends-on')
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set when a poll took the selected target away — drives the notice below. */
  const [targetLost, setTargetLost] = useState(false)

  // The 10s canvas poll can add or remove agents from `candidates` while this
  // dialog stays open. Reconcile `targetId` against the live roster at render
  // time (the "adjust state during render" pattern, per React's "you might not
  // need an effect").
  //
  // It resets to '' — NOT to `candidates[0]`. Substituting the first remaining
  // agent silently rewrites the operator's answer: pick Vector, move to the
  // Label field, a poll drops Vector, and the button they press now posts
  // Atlas → Meridian. That returns 201, so nothing warns them and the graph
  // grows a relation nobody asked for. Empty is the only safe landing: it is
  // not a different agent, `canSubmit` refuses it, and the notice below says
  // why the field went blank. The blank must never be mistaken for a glitch,
  // hence the disabled placeholder option — and it must never submit, hence
  // BOTH the `canSubmit` guard and `submit`'s own early return.
  const targetStillValid = targetId !== '' && candidates.some((candidate) => candidate.id === targetId)
  if (targetId !== '' && !targetStillValid) {
    setTargetId('')
    setTargetLost(true)
  }

  const canSubmit = targetId !== '' && candidates.length > 0 && !saving

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      const trimmedLabel = label.trim()
      const res = await createRelation(projectId, {
        sourceCopilotId: sourceAgent.id,
        targetCopilotId: targetId,
        relationType,
        ...(trimmedLabel ? { label: trimmedLabel } : {}),
      })
      if (!res.ok) {
        setError(await messageForCreateResponse(res))
        return
      }
      // Server confirmed the row exists — NOW it is safe to ask the view to
      // re-fetch the graph. Nothing is drawn before this point.
      onDone()
      onClose()
    } catch (caught) {
      // A timeout is NOT "it failed" — we stopped waiting, and the insert may
      // or may not have committed. Say that, rather than asserting an outcome
      // we do not have. Clearing `saving` in `finally` re-enables Cancel,
      // Escape and backdrop-click all at once, so this is also the exit.
      setError(
        isAbortError(caught)
          ? `The request timed out after ${REQUEST_TIMEOUT_SECONDS} seconds — it is not known whether the relation was created. Close this and check the graph.`
          : 'Could not create the relation — try again.'
      )
    } finally {
      setSaving(false)
    }
  }

  // Escape and backdrop-click both route through `onClose` on Headless's
  // `Dialog`, independently of the Cancel button's `disabled={saving}` — so a
  // request in flight must veto them here too, or the operator dismisses the
  // dialog before the outcome is known and a failure reports nothing (F5).
  // Dismissable again as soon as `saving` clears, and the error (if any)
  // stays visible because nothing else touches `error` on close.
  function closeUnlessSaving() {
    if (!saving) onClose()
  }

  return (
    <Dialog open={open} onClose={closeUnlessSaving} size="md">
      <DialogTitle>Add relation from {sourceAgent.name}</DialogTitle>
      <DialogDescription>
        Records a relation this project actually has — a dependency, an output handoff, a review, a
        trigger, or an orchestration.
      </DialogDescription>
      <DialogBody>
        {candidates.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No other agent is in this project yet — add one first.
          </p>
        ) : (
          <Fieldset>
            <Field>
              <Label>Target agent</Label>
              <Select
                name="target-agent"
                value={targetId}
                onChange={(event) => {
                  setTargetId(event.target.value)
                  // The operator has answered the notice — retire it.
                  setTargetLost(false)
                }}
              >
                {/* Disabled, so the empty value reads as a prompt and can never
                    be chosen back. It is the rendered state of "no target yet",
                    which `canSubmit` refuses. */}
                <option value="" disabled>
                  Select an agent…
                </option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
              {targetLost ? (
                <p role="status" className="mt-2 text-sm text-accent-600 dark:text-accent-400">
                  The agent you selected is no longer in this project — choose another.
                </p>
              ) : null}
            </Field>
            <Field>
              <Label>Relation type</Label>
              <Select
                name="relation-type"
                value={relationType}
                onChange={(event) => {
                  const { value } = event.target
                  if (isStorableRelationType(value)) setRelationType(value)
                }}
              >
                {STORABLE_RELATION_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>Label (optional)</Label>
              <Input
                name="relation-label"
                value={label}
                maxLength={MAX_LABEL_LENGTH}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="e.g. Weekly reconciliation handoff"
              />
            </Field>
          </Fieldset>
        )}
        {error ? (
          <p role="alert" className="mt-4 text-sm text-[var(--state-danger-text)]">
            {error}
          </p>
        ) : null}
      </DialogBody>
      <DialogActions>
        <Button plain disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <Button color="accent" disabled={!canSubmit} onClick={submit}>
          {saving ? 'Adding…' : 'Add relation'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * Destructive confirm for ONE `project_agent_relations` row. `relationId` is
 * only ever non-null on an `explicit`, non-derived edge — the panel enforces
 * that upstream, so this dialog is never reachable for a derived relation.
 *
 * AC-8: success does not remove the edge locally. It calls `onDone`, which the
 * view wires to `refreshNow()` — a failed delete leaves the graph exactly as
 * it was, because nothing was ever mutated client-side to begin with.
 */
export function DeleteRelationDialog({
  projectId,
  relationId,
  description,
  open,
  onClose,
  onDone,
}: {
  projectId: string
  relationId: string
  /** Human-readable statement of what this relation IS, e.g. "Depends on: Atlas → Vector". */
  description: string
  open: boolean
  onClose: () => void
  /**
   * Carries WHICH truth the server told us, because the two are not the same
   * event and must not be announced with the same words.
   *
   * `'deleted'` — this request removed the row. `'already-gone'` — it removed
   * nothing; the row had already been deleted (another tab, another operator).
   * Both refresh the graph, because in both cases the server has just told us
   * the current truth and the canvas is behind it. Only the first is a delete
   * the operator performed: announcing "Relation deleted" on a 404 tells a
   * screen-reader user their action succeeded while the visible `role="alert"`
   * says the opposite, and moves focus as though a row had disappeared.
   */
  onDone: (outcome: 'deleted' | 'already-gone') => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/agent-ops/projects/${encodeURIComponent(projectId)}/relations/${encodeURIComponent(relationId)}`,
        { method: 'DELETE', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
      )
      if (!res.ok) {
        if (res.status === 404) {
          setError('This relation no longer exists — it may already have been removed.')
          // The server just confirmed the row is gone (a concurrent poll or a
          // second tab beat us to it). The graph must catch up to that truth
          // or the stale row — and its delete control — sits there inviting a
          // second identical 404 on the next click. The dialog itself stays
          // open (no `onClose()`): the confirmation message is the point.
          onDone('already-gone')
        } else {
          setError(await messageForResponse(res, 'Delete failed — the relation was not removed.'))
        }
        return
      }
      onDone('deleted')
      onClose()
    } catch (caught) {
      // Same honesty as the create path: a timeout is an unknown outcome, not
      // a known failure, and clearing `pending` is what gives the operator a
      // way out of an otherwise undismissable modal.
      setError(
        isAbortError(caught)
          ? `The request timed out after ${REQUEST_TIMEOUT_SECONDS} seconds — it is not known whether the relation was removed. Close this and check the graph.`
          : 'Delete failed — the relation was not removed.'
      )
    } finally {
      setPending(false)
    }
  }

  // Same rationale as `AddRelationDialog`: Escape/backdrop-click bypass the
  // Cancel button's `disabled={pending}` entirely, and this dialog is
  // unmounted outright on close (the parent drops `pendingDelete`) — so a
  // dismissed-mid-flight failed delete would report nothing at all. Vetoing
  // `onClose` while pending is what makes that outcome unreachable.
  function closeUnlessPending() {
    if (!pending) onClose()
  }

  return (
    <Dialog open={open} onClose={closeUnlessPending} size="md">
      <DialogTitle>Delete relation</DialogTitle>
      <DialogDescription>
        This permanently removes the relation{' '}
        <span className="font-medium text-zinc-950 dark:text-white">{description}</span>. This cannot be
        undone.
      </DialogDescription>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-[var(--state-danger-text)]">
          {error}
        </p>
      ) : null}
      <DialogActions>
        <Button plain disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button color="zinc" style={dangerSolidStyle} disabled={pending} onClick={remove}>
          {pending ? 'Deleting…' : 'Delete relation'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
