'use client'

import { useState } from 'react'

import { ArchitectChat } from '@/components/agent-ops/architect-chat'
import { CreateAgentForm } from '@/components/agent-ops/create-agent-form'
import type { GeneratedManifest } from '@/lib/agent-mission-control/authoring-types'
import type { Project } from '@/lib/agent-mission-control/types'

/**
 * Client orchestrator for the "new copilot" screen. Wires the architect chat
 * (right column) to the manual creation form (left column) via shared state:
 * when the assistant proposes a manifest, it flows straight into the form.
 *
 * The form is remounted (via `key`) when a manifest arrives so its internal
 * state picks up the new defaults instead of merging with stale state.
 */
export function NewCopilotWorkbench({ projects }: { projects: Project[] }) {
  const [manifest, setManifest] = useState<GeneratedManifest | null>(null)

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        {manifest ? (
          <div className="rounded-lg border border-accent-500/20 bg-accent-50 px-4 py-3 text-sm text-accent-700 dark:border-accent-400/20 dark:bg-accent-950/30 dark:text-accent-300">
            Manifest applied from the assistant — review and create.
          </div>
        ) : null}
        <CreateAgentForm
          projects={projects}
          initialManifest={manifest ?? undefined}
          key={manifest ? 'with-manifest' : 'empty'}
        />
      </div>
      <div>
        <ArchitectChat onManifest={setManifest} />
      </div>
    </div>
  )
}
