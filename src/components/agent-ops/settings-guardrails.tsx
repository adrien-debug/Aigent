'use client'

import clsx from 'clsx'
import { LockClosedIcon } from '@heroicons/react/24/outline'

import { NotMeasuredDash } from '@/components/agent-ops/empty-state'
import { surfaceInsetClass } from '@/components/agent-ops/surface-card'
import { PolicyStateIndicator } from '@/components/agent-ops/widgets/policy-state-indicator'
import { Badge } from '@/components/catalyst/badge'
import { Field, Fieldset, Label } from '@/components/catalyst/fieldset'
import { Select } from '@/components/catalyst/select'
import { Switch } from '@/components/catalyst/switch'
import type { ConfirmationPolicy } from '@/lib/agent-mission-control/types'

const POLICY_CAPTIONS: Record<ConfirmationPolicy, string> = {
  never: 'No confirmation gate — copilots act autonomously.',
  'risky-only': 'Copilots pause for confirmation on risky tool calls only.',
  always: 'Every tool call pauses for a human confirmation.',
}

/**
 * The baseline a copilot created from the authoring form actually inherits —
 * `defaultManifest()` in create-agent-form.tsx writes `confirmationPolicy:
 * 'risky-only'` into every manually authored manifest. This card REPORTS that
 * fact; it does not decide it.
 */
const APPLIED_CONFIRMATION_POLICY: ConfirmationPolicy = 'risky-only'

const labelClass =
  'text-[10px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400'

/**
 * Guardrail defaults — READ-ONLY (AIGENT-UI-TRUTH-026).
 *
 * This card previously drove `useState` on a live Select and a live number
 * Input with no fetch, no form and no Save button: every edit was discarded on
 * navigation while looking like a saved platform setting. The only disclosure
 * was a 10px zinc-500 line at the bottom of the card (contrast 3.59, below AA).
 *
 * Aigent has NO settings API — there is no route under /api that reads or
 * writes a platform-wide guardrail, and no `platform_settings`-shaped table.
 * So the controls are locked and the card states that up front, at body size,
 * rather than whispering it in a footnote.
 *
 * Two different truths, deliberately rendered differently:
 *  - the confirmation policy IS applied by code (see APPLIED_CONFIRMATION_POLICY),
 *    so it shows its real value in a disabled control;
 *  - the shadow agreement threshold is NOT a platform setting at all. It exists
 *    only per-experiment (`ShadowExperiment.agreementThreshold`, types.ts), and
 *    the 95% previously shown here came from seed fixtures. An invented number
 *    presented as configuration is worse than an honest dash, so it renders as
 *    unavailable — never a value, never a 0, never a meter drawn from nothing.
 *
 * Restoring editability means shipping the settings API first, then wiring a
 * real <form> with a Save action — not re-enabling these controls.
 */
export function SettingsGuardrails() {
  return (
    <Fieldset>
      {/* Said once, up front, at body size — an operator must not have to find a
          footnote to learn that nothing here can be changed. */}
      <div
        role="note"
        className={clsx(
          'flex items-start gap-3 rounded-xl px-4 py-3',
          'bg-[var(--accent-surface)] ring-1 ring-[var(--accent-line)] ring-inset'
        )}
      >
        <LockClosedIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent-500" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-950 dark:text-white">
            Read-only — Aigent has no settings API
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            No platform-wide guardrail configuration is stored. This card reports the baseline the
            code applies today; changing it is a code change, not a form.
          </p>
        </div>
      </div>

      {/* Locked confirmation gate — one dense row. `locked` (not `disabled`)
          keeps the switch coloured ON with a lock affordance; a plain disabled
          switch fades to grey and reads as "off and unavailable". */}
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4 pb-6">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight text-zinc-950 dark:text-white">
            Require confirmation for high &amp; critical risk tools
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Every copilot inherits this gate — it cannot be turned off.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Badge color="accentStrong">Locked platform-wide</Badge>
          <Switch
            checked
            locked
            name="require_confirmation_high_critical"
            aria-label="Require confirmation for high and critical risk tools (locked platform-wide)"
          />
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-6">
        {/* Twin columns share ONE skeleton: label → state → caption. */}
        <Field className={clsx(surfaceInsetClass, 'p-4 sm:p-6')}>
          <Label className={labelClass}>Default confirmation policy</Label>
          {/* `defaultValue`, not `value`: a disabled select never changes, and a
              controlled value with no onChange is a React warning for nothing. */}
          <Select
            name="default_confirmation_policy"
            defaultValue={APPLIED_CONFIRMATION_POLICY}
            disabled
            className="mt-3"
          >
            <option value="never">Never</option>
            <option value="risky-only">Risky only</option>
            <option value="always">Always</option>
          </Select>
          <div className="mt-5">
            <PolicyStateIndicator policy={APPLIED_CONFIRMATION_POLICY} />
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              {POLICY_CAPTIONS[APPLIED_CONFIRMATION_POLICY]}
            </p>
          </div>
        </Field>

        <Field className={clsx(surfaceInsetClass, 'p-4 sm:p-6')}>
          <Label className={labelClass}>Shadow agreement threshold</Label>
          {/* No control at all: an input implies a value can be set, and there
              is no platform-wide value to set OR to read. Threshold lives on
              each shadow experiment, not on the platform. */}
          <p className="mt-3 font-mono text-sm tabular-nums">
            <NotMeasuredDash />
          </p>
          <p className="mt-5 text-sm text-zinc-600 dark:text-zinc-400">
            Not a platform setting. Each shadow experiment carries its own promotion threshold, read
            from that experiment — there is no default to configure here.
          </p>
        </Field>
      </div>
    </Fieldset>
  )
}
