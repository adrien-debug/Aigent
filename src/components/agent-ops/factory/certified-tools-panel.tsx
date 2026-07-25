import { Badge } from '@/components/ui/badge'
import { Text } from '@/components/ui/text'
import { surfaceItemClass } from '@/components/agent-ops/surface-card'
import { EmptyState } from '@/components/agent-ops/empty-state'

export interface FactoryToolRow {
  id: string
  version: string
  label: string
  summary: string
  kind: string
  mutates: boolean
  risk: 'low' | 'medium' | 'high'
  requiresConfirmation: boolean
  provenance: string
  certification: 'certified' | 'draft' | 'deprecated'
}

/**
 * Risk is shown as TEXT, never a rainbow badge — the DS bans multicolor
 * warning badges. Only certification escalates through the accent ladder
 * (soft → strong), since that is the one axis that matters for "can I use
 * this in the Factory today".
 */
const CERT_BADGE: Record<FactoryToolRow['certification'], 'accent' | 'zinc'> = {
  certified: 'accent',
  draft: 'zinc',
  deprecated: 'zinc',
}

export function CertifiedToolsPanel({ tools }: { tools: FactoryToolRow[] }) {
  if (tools.length === 0) {
    return (
      <EmptyState
        title="No certified tools"
        description="The registry has no certified tools yet."
      />
    )
  }

  return (
    <div className="max-h-96 overflow-y-auto px-6 py-4">
      <ul className="flex flex-col gap-2">
        {tools.map((tool) => (
          <li key={tool.id} className={`flex flex-col gap-2 p-4 ${surfaceItemClass}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-white">{tool.label}</span>
                  <Badge color={CERT_BADGE[tool.certification]}>{tool.certification}</Badge>
                </div>
                <Text className="mt-0.5 font-mono text-xs text-zinc-500">
                  {tool.id} · v{tool.version}
                </Text>
              </div>
              <div className="flex shrink-0 items-center gap-4 text-xs text-zinc-400">
                <span>{tool.kind}</span>
                <span>risk: {tool.risk}</span>
                <span>{tool.mutates ? 'mutates' : 'read-only'}</span>
              </div>
            </div>
            <Text className="text-zinc-400">{tool.summary}</Text>
            <Text className="font-mono text-[11px] text-zinc-500">provenance: {tool.provenance}</Text>
          </li>
        ))}
      </ul>
    </div>
  )
}
