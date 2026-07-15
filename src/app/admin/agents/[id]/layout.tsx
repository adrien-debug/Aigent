import { ChevronLeftIcon } from '@heroicons/react/16/solid'
import { notFound } from 'next/navigation'
import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { CopilotTabs } from '@/components/agent-ops/copilot-tabs'
import { Badge } from '@/components/catalyst/badge'
import { Heading } from '@/components/catalyst/heading'
import { Link } from '@/components/catalyst/link'
import { Text } from '@/components/catalyst/text'
import { getCopilot } from '@/lib/agent-mission-control/data'
import { COPILOT_STATUS_LABELS } from '@/lib/agent-mission-control/labels'
import type { CopilotStatus } from '@/lib/agent-mission-control/types'

/**
 * Status → Catalyst badge intensity on the mono-accent ladder. Mirrors
 * copilot-registry-table.tsx's local mapping (not exported there) — kept in
 * sync by convention, not by import, since the table owns its own file.
 */
function statusBadgeColor(status: CopilotStatus): 'zinc' | 'accent' | 'accentStrong' {
  switch (status) {
    case 'degraded':
      return 'accentStrong'
    case 'paused':
      return 'accent'
    default:
      // active, draft, archived — quiet neutral
      return 'zinc'
  }
}

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

      {/* Copilot identity header — nom + statut + model, visible sur TOUS les onglets du subtree.
          Volontairement concis (pas de description/santé/tags ici, c'est le rôle de l'Overview). */}
      <div className="mt-4 flex items-center gap-4">
        <CopilotAvatar copilot={copilot} className="size-10 rounded-xl" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Heading level={1} className="truncate">
              {copilot.name}
            </Heading>
            <Badge color={statusBadgeColor(copilot.status)}>{COPILOT_STATUS_LABELS[copilot.status]}</Badge>
          </div>
          <Text className="mt-1 truncate font-mono !text-xs">
            {copilot.model} · {copilot.modelProvider}
          </Text>
        </div>
      </div>

      {/* Menus — sections du copilot (Builder retiré de la barre) */}
      <div className="mt-4">
        <CopilotTabs copilotId={id} />
      </div>

      <div className="mt-6 lg:mt-8">{children}</div>
    </div>
  )
}
