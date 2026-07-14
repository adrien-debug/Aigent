'use client'

import { useState } from 'react'

import { PolicyStateIndicator } from '@/components/agent-ops/widgets/policy-state-indicator'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { Badge } from '@/components/catalyst/badge'
import { Field, Fieldset, Label } from '@/components/catalyst/fieldset'
import { Input } from '@/components/catalyst/input'
import { Select } from '@/components/catalyst/select'
import { Switch } from '@/components/catalyst/switch'
import type { ConfirmationPolicy } from '@/lib/agent-mission-control/types'

const POLICY_CAPTIONS: Record<ConfirmationPolicy, string> = {
  never: 'No confirmation gate — copilots act autonomously.',
  'risky-only': 'Copilots pause for confirmation on risky tool calls only.',
  always: 'Every tool call pauses for a human confirmation.',
}

/**
 * Guardrail defaults — UI-only in V1: values live in local state, nothing is
 * persisted. The high/critical confirmation switch is locked platform-wide, so
 * it renders checked + disabled (the affordance says the state). The policy and
 * threshold controls each drive a live visual widget so the posture is legible
 * at a glance, not just as a dropdown value or a bare number.
 */
export function SettingsGuardrails() {
  const [confirmationPolicy, setConfirmationPolicy] = useState<ConfirmationPolicy>('risky-only')
  const [agreementThreshold, setAgreementThreshold] = useState('95')
  const thresholdNum = Number(agreementThreshold)

  return (
    <Fieldset>
      {/* Locked confirmation gate — one dense row; the checked+disabled switch encodes locked-ON. */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-6">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight text-zinc-950 dark:text-white">
            Require confirmation for high &amp; critical risk tools
          </p>
          <p className="mt-1 text-xs text-zinc-500">Every copilot inherits this gate — it cannot be turned off.</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Badge color="accentStrong">Locked platform-wide</Badge>
          <Switch
            checked
            disabled
            name="require_confirmation_high_critical"
            aria-label="Require confirmation for high and critical risk tools (locked platform-wide)"
          />
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6">
        {/* Twin columns share ONE skeleton: label → control → meter row (bar +
            right-hand value) → caption. Rows align across the grid. */}
        <Field className="rounded-2xl bg-zinc-50/50 p-6 ring-1 ring-zinc-950/5 dark:bg-white/[0.01] dark:ring-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          <Label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Default confirmation policy</Label>
          <Select
            name="default_confirmation_policy"
            value={confirmationPolicy}
            onChange={(event) => setConfirmationPolicy(event.target.value as ConfirmationPolicy)}
            className="mt-3"
          >
            <option value="never">Never</option>
            <option value="risky-only">Risky only</option>
            <option value="always">Always</option>
          </Select>
          <div className="mt-5">
            <PolicyStateIndicator policy={confirmationPolicy} />
            <p className="mt-3 text-xs text-zinc-500">{POLICY_CAPTIONS[confirmationPolicy]}</p>
          </div>
        </Field>

        <Field className="rounded-2xl bg-zinc-50/50 p-6 ring-1 ring-zinc-950/5 dark:bg-white/[0.01] dark:ring-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          <Label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Shadow agreement threshold (%)</Label>
          <Input
            type="number"
            name="shadow_agreement_threshold"
            min={50}
            max={100}
            value={agreementThreshold}
            onChange={(event) => setAgreementThreshold(event.target.value)}
            className="mt-3"
          />
          <div className="mt-5">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <LinearMeter
                  value={Number.isFinite(thresholdNum) ? thresholdNum : 0}
                  max={100}
                  tone={thresholdNum >= 90 ? 'accentSolid' : 'accentStrong'}
                  ariaLabel="Shadow agreement threshold"
                />
              </div>
              <span className="font-mono text-xs font-medium text-accent-600 tabular-nums dark:text-accent-400">
                {agreementThreshold}%
              </span>
            </div>
            <p className="mt-3 text-xs text-zinc-500">Floor 50% — stricter promotes fewer shadow runs.</p>
          </div>
        </Field>
      </div>

      <p className="mt-6 text-xs text-zinc-500">UI preview — persistence ships with the settings API.</p>
    </Fieldset>
  )
}
