'use client'

import { useState } from 'react'

import { ArchitectChat } from '@/components/agent-ops/architect-chat'
import { CreateAgentForm } from '@/components/agent-ops/create-agent-form'
import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import type { GeneratedManifest } from '@/lib/agent-mission-control/authoring-types'
import type { Project } from '@/lib/agent-mission-control/types'

/**
 * Client orchestrator for the "new copilot" screen. Wires the architect chat
 * (right column) to the manual creation form (left column) via shared state:
 * when the assistant proposes a manifest, it flows straight into the form.
 *
 * The form stays MOUNTED when a manifest arrives (no `key` remount): it merges
 * the manifest into its existing state, so anything already typed is kept.
 */
export function NewCopilotWorkbench({ projects }: { projects: Project[] }) {
  const [manifest, setManifest] = useState<GeneratedManifest | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <AgentSectionCard
        title="Copilot details"
        description="Identity, runtime and guardrails for the new copilot."
      >
        <div className="space-y-6">
          {manifest ? (
            <div className="rounded-lg bg-(--accent-surface) px-4 py-3 text-sm text-accent-300 ring-1 ring-(--accent-line)">
              Manifest applied from the assistant — review and create.
            </div>
          ) : null}
          <CreateAgentForm projects={projects} manifest={manifest ?? undefined} draftId={draftId} />
        </div>
      </AgentSectionCard>

      <ArchitectChat onManifest={setManifest} onDraftId={setDraftId} />
    </div>
  )
}
