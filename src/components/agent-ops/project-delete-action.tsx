'use client'

import { TrashIcon } from '@heroicons/react/16/solid'
import { useState } from 'react'

import { DeleteProjectDialog } from '@/components/agent-ops/delete-project-dialog'
import { Button } from '@/components/ui/button'

/**
 * Client trigger for deleting a project from its (server-rendered) detail page.
 * Holds the dialog open-state and renders a plain header control + the confirm
 * dialog. Kept tiny so the page stays a server component.
 *
 * The entry point to the destructive path must not look like every other plain
 * header control. The button stays `plain` — a solid red in a page header would
 * shout louder than the act deserves before anything is confirmed — but the
 * trash icon takes the danger role via `dangerIcon`.
 */
export function ProjectDeleteAction({ project }: { project: { id: string; name: string } }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <>
      <Button plain dangerIcon onClick={() => setIsOpen(true)}>
        <TrashIcon />
        Delete…<span className="sr-only"> {project.name}</span>
      </Button>
      <DeleteProjectDialog project={project} isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}
