'use client'

import { XMarkIcon } from '@heroicons/react/16/solid'

import { Button } from '@/components/ui/button'
import { Field, Label } from '@/components/ui/fieldset'
import { Select } from '@/components/ui/select'
import {
  PERIOD_LABEL,
  RUNS_PERIODS,
  RUN_STATUSES,
  type RunsFilterState,
  type RunsPeriod,
} from '@/lib/runs-console/runs-filters'

export interface FilterOption {
  value: string
  label: string
}

const STATUS_LABEL: Record<(typeof RUN_STATUSES)[number], string> = {
  completed: 'Completed',
  running: 'Running',
  failed: 'Failed',
  blocked: 'Blocked',
  'needs-confirmation': 'Needs confirmation',
}

function FilterField({
  label,
  value,
  onChange,
  options,
  includeAll = true,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: FilterOption[]
  includeAll?: boolean
}) {
  return (
    <Field className="min-w-36">
      <Label>{label}</Label>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {includeAll ? <option value="">All</option> : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
    </Field>
  )
}

export function RunsFilters({
  state,
  agentOptions,
  projectOptions,
  onChange,
  onReset,
  showReset,
}: {
  state: RunsFilterState
  agentOptions: FilterOption[]
  projectOptions: FilterOption[]
  onChange: (patch: Partial<RunsFilterState>) => void
  onReset: () => void
  showReset: boolean
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <FilterField
        label="Status"
        value={state.status}
        onChange={(status) => onChange({ status })}
        options={RUN_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
      />
      <FilterField
        label="Agent"
        value={state.agent}
        onChange={(agent) => onChange({ agent })}
        options={agentOptions}
      />
      <FilterField
        label="Project"
        value={state.project}
        onChange={(project) => onChange({ project })}
        options={projectOptions}
      />
      <FilterField
        label="Period"
        value={state.period}
        onChange={(period) => onChange({ period: period as RunsPeriod })}
        options={RUNS_PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
        includeAll={false}
      />

      {showReset ? (
        <Button plain onClick={onReset} className="mb-0.5">
          <XMarkIcon />
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}
