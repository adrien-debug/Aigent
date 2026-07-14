'use client'

import * as Headless from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ProjectAgentBuilderWorkbench } from '@/components/agent-ops/project-agent-builder-workbench'

/**
 * Full-screen modal shell for the Agent Builder. Built directly on
 * `Headless.Dialog` (rather than the Catalyst `Dialog` primitive) because
 * that primitive tops out at `max-w-5xl` — too narrow for the builder's
 * two-column chat+preview layout. Same underlying Headless UI mechanics as
 * Catalyst (Escape, focus-trap, backdrop), same DS surfaces/tokens.
 *
 * Closing (Escape or the corner cross) routes back to the project overview
 * that sits behind the backdrop, rather than unmounting into a blank state.
 */
export function ProjectBuilderModal({
  projectId,
  projectName,
  repoFullName,
  seedInput,
}: {
  projectId: string
  projectName: string
  repoFullName: string | null
  seedInput?: string
}) {
  const router = useRouter()
  // Local open state lets the leave transition play before the route change
  // unmounts this component — Headless.Dialog's `transition` prop animates
  // out on `open=false`, then we navigate once that's underway.
  const [open, setOpen] = useState(true)

  function close() {
    setOpen(false)
    router.push(`/admin/projects/${projectId}`)
  }

  return (
    <Headless.Dialog open={open} onClose={close} className="relative z-50">
      <Headless.DialogBackdrop
        transition
        className="fixed inset-0 bg-zinc-950/70 backdrop-blur-sm transition duration-150 data-closed:opacity-0"
      />

      <div className="fixed inset-0 flex w-screen items-center justify-center p-4">
        <Headless.DialogPanel
          transition
          className="flex h-[90vh] w-full max-w-[1600px] min-h-0 flex-col overflow-hidden rounded-2xl bg-[var(--color-surface-primary)] ring-1 ring-white/10 transition duration-150 data-closed:scale-95 data-closed:opacity-0"
        >
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/5 bg-black/20 px-6 py-4">
            <Headless.DialogTitle className="min-w-0 truncate text-sm font-medium text-white">
              Agent Builder — {projectName}
            </Headless.DialogTitle>
            <Headless.Button
              onClick={close}
              aria-label="Close Agent Builder"
              className="flex shrink-0 items-center justify-center rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-500"
            >
              <XMarkIcon aria-hidden="true" className="size-5" />
            </Headless.Button>
          </div>

          <div className="min-h-0 flex-1 p-3 lg:p-4">
            <ProjectAgentBuilderWorkbench
              projectId={projectId}
              projectName={projectName}
              repoFullName={repoFullName}
              seedInput={seedInput}
            />
          </div>
        </Headless.DialogPanel>
      </div>
    </Headless.Dialog>
  )
}
