import { ChevronLeftIcon } from '@heroicons/react/16/solid'
import { notFound } from 'next/navigation'
import { CopilotTabs } from '@/components/agent-ops/copilot-tabs'
import { Link } from '@/components/catalyst/link'
import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'
import { getCopilot } from '@/lib/agent-mission-control/data'

export default async function CopilotLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  return (
    <div>
      {/* Ligne d'orientation compacte — juste un back-link vers la liste. */}
      <nav aria-label="Breadcrumb" className="mt-2 flex min-w-0 items-center gap-2 text-xs">
        <Link
          href="/admin/agents"
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
        >
          <ChevronLeftIcon aria-hidden="true" className="size-3.5 shrink-0" />
          Copilots
        </Link>
      </nav>

      {/* Menus — l'onglet Builder n'apparaît que sur l'Agent Builder Copilot */}
      <div className="mt-4">
        <CopilotTabs copilotId={id} showBuilder={copilot.slug === AGENT_BUILDER_SLUG} />
      </div>

      <div className="mt-6 lg:mt-8">{children}</div>
    </div>
  )
}
