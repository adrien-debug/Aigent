import type { Metadata } from 'next'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { SettingsGuardrails } from '@/components/agent-ops/settings-guardrails'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@/components/catalyst/description-list'
import { Description, Field, FieldGroup, Fieldset, Label } from '@/components/catalyst/fieldset'
import { Input } from '@/components/catalyst/input'

export const metadata: Metadata = {
  title: 'Settings — Agent Mission Control',
}

export default function SettingsPage() {
  // Server component: env is read server-side only, nothing leaks to the client.
  const isGpu1 = process.env.AMC_DATA_SOURCE === 'gpu1'
  const endpoint = process.env.AMC_SUPABASE_URL ?? '— (mock)'

  return (
    <div className="mt-2 space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AgentSectionCard title="Workspace" description="Identity of this control plane.">
          <Fieldset>
            <FieldGroup>
              <Field disabled>
                <Label>Workspace name</Label>
                <Input name="workspace_name" defaultValue="Hearst — Agent Mission Control" />
                <Description>Managed by the platform</Description>
              </Field>
              <Field disabled>
                <Label>Owner</Label>
                <Input name="owner" defaultValue="adrien@hearstcorporation.io" />
              </Field>
            </FieldGroup>
          </Fieldset>
        </AgentSectionCard>

        <AgentSectionCard title="Data source" description="Where this console reads its data from.">
          <DescriptionList>
            <DescriptionTerm>Source</DescriptionTerm>
            <DescriptionDetails>
              {isGpu1 ? <Badge color="green">GPU1 · PostgREST</Badge> : <Badge color="zinc">Mock dataset</Badge>}
            </DescriptionDetails>
            <DescriptionTerm>Endpoint</DescriptionTerm>
            <DescriptionDetails>
              <span className="font-mono text-xs">{endpoint}</span>
            </DescriptionDetails>
          </DescriptionList>
          <p className="mt-3 text-xs text-zinc-500">Configured via .env.local — never committed.</p>
        </AgentSectionCard>
      </div>

      <AgentSectionCard
        title="Guardrail defaults"
        description="Baseline applied to new copilots — each copilot can override per tool."
      >
        <SettingsGuardrails />
      </AgentSectionCard>

      <AgentSectionCard title="Danger zone">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm/6 font-medium text-zinc-950 dark:text-white">Archive this workspace</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Stops all copilots and freezes the registry. Reversible by a platform admin.
            </p>
          </div>
          <Button outline disabled title="Ships in V2">
            <span className="text-rose-600 dark:text-rose-400">Archive workspace</span>
          </Button>
        </div>
      </AgentSectionCard>
    </div>
  )
}
