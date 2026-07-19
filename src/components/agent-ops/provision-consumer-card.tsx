'use client'

import { ServerStackIcon } from '@heroicons/react/24/outline'
import { useState } from 'react'

import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import {
  GitHubDeliveryModeToggle,
  GitHubDeliveryReceipt,
  type GitHubDeliveryMode,
  type GitHubDeliveryResult,
} from '@/components/agent-ops/github-delivery-primitives'
import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Text } from '@/components/catalyst/text'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'
import type { ConsumerProvisionStatus } from '@/lib/agent-mission-control/github'

export function ProvisionConsumerCard({
  projectId,
  repoFullName,
  initialStatus,
}: {
  projectId: string
  repoFullName: string
  initialStatus: ConsumerProvisionStatus | null
}) {
  const [status, setStatus] = useState<ConsumerProvisionStatus | null>(initialStatus)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GitHubDeliveryResult | null>(null)
  const [deliveryMode, setDeliveryMode] = useState<GitHubDeliveryMode>('pull_request')

  async function refreshStatus() {
    try {
      const res = await fetch(`/api/agent-ops/projects/${encodeURIComponent(projectId)}/provision-consumer`)
      if (!res.ok) return
      setStatus((await res.json()) as ConsumerProvisionStatus)
    } catch {
      // keep prior status
    }
  }

  async function runProvision(confirm: boolean) {
    setSaving(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/agent-ops/projects/${encodeURIComponent(projectId)}/provision-consumer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm, deliveryMode }),
      })
      if (!res.ok) {
        setError(await messageForResponse(res, 'Provision failed.'))
        return
      }
      const payload = (await res.json()) as GitHubDeliveryResult
      setResult(payload)
      if (payload.pushed) await refreshStatus()
    } catch {
      setError('Network error — provision request failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AgentSectionCard
      title="Consumer workspace"
      description="Provision the intake page, registry, bindings and AGENTS-WANTED in the linked repo — once, then only push agents."
      contentClassName="px-6 py-5 space-y-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ServerStackIcon className="size-5 text-zinc-500" aria-hidden="true" />
        <Text className="!mt-0 font-mono text-xs text-zinc-500">{repoFullName}</Text>
        {status?.provisioned ? (
          <Badge color="accent">Intake provisioned {status.version ?? ''}</Badge>
        ) : (
          <Badge color="zinc">Not provisioned</Badge>
        )}
      </div>

      {status?.provisioned && status.provisionedAt ? (
        <Text className="!mt-0 text-xs text-zinc-500">
          Last marker: {new Date(status.provisionedAt).toLocaleString()} · project key{' '}
          <span className="font-mono">{status.projectKey ?? '—'}</span>
        </Text>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button outline disabled={saving} onClick={() => runProvision(false)}>
          Preview pack
        </Button>
        <Button color="accent" disabled={saving} onClick={() => runProvision(true)}>
          {saving ? (
            <>
              <Spinner />
              Provisioning…
            </>
          ) : (
            'Provision intake'
          )}
        </Button>
      </div>

      <GitHubDeliveryModeToggle value={deliveryMode} onChange={setDeliveryMode} />

      <Text className="!mt-0 text-xs text-zinc-500">
        Real GitHub writes require <span className="font-mono">GITHUB_PUSH_ENABLED=1</span> server-side.
        Preview always works (dry-run).
      </Text>

      {error ? <ErrorBanner message={error} /> : null}
      {result ? <GitHubDeliveryReceipt result={result} /> : null}
    </AgentSectionCard>
  )
}
