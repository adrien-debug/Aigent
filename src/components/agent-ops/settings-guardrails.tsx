'use client'

import { useState } from 'react'

import { Description, Field, FieldGroup, Fieldset, Label } from '@/components/catalyst/fieldset'
import { Input } from '@/components/catalyst/input'
import { Select } from '@/components/catalyst/select'
import { Switch, SwitchField } from '@/components/catalyst/switch'

/**
 * Guardrail defaults — UI-only in V1: values live in local state, nothing is
 * persisted. The high/critical confirmation switch is locked platform-wide,
 * so it renders checked + disabled (the affordance says the state).
 */
export function SettingsGuardrails() {
  const [confirmationPolicy, setConfirmationPolicy] = useState('risky-only')
  const [agreementThreshold, setAgreementThreshold] = useState('95')

  return (
    <Fieldset>
      <FieldGroup>
        <SwitchField title="Locked platform-wide — high & critical risk tools always require a human confirmation.">
          <Label>Require confirmation for high &amp; critical risk tools</Label>
          <Description>Locked platform-wide for every copilot.</Description>
          <Switch checked disabled name="require_confirmation_high_critical" />
        </SwitchField>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
          <Field>
            <Label>Default confirmation policy</Label>
            <Select
              name="default_confirmation_policy"
              value={confirmationPolicy}
              onChange={(event) => setConfirmationPolicy(event.target.value)}
            >
              <option value="never">Never</option>
              <option value="risky-only">Risky only</option>
              <option value="always">Always</option>
            </Select>
          </Field>
          <Field>
            <Label>Shadow agreement threshold (%)</Label>
            <Input
              type="number"
              name="shadow_agreement_threshold"
              min={50}
              max={100}
              value={agreementThreshold}
              onChange={(event) => setAgreementThreshold(event.target.value)}
            />
          </Field>
        </div>
      </FieldGroup>

      <p className="mt-6 text-xs text-zinc-500">UI preview — persistence ships with the settings API.</p>
    </Fieldset>
  )
}
