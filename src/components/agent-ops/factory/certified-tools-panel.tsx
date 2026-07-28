import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import { surfaceSunken } from '@/components/ui/panel'
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
    <div className="max-h-[min(48rem,70vh)] overflow-y-auto px-6 py-4">
      <ul className="flex flex-col gap-2">
        {tools.map((tool) => (
          <li key={tool.id} className={`flex flex-col gap-2 p-4 ${surfaceSunken}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Strong className="truncate text-sm">{tool.label}</Strong>
                  <Badge color={CERT_BADGE[tool.certification]}>{tool.certification}</Badge>
                </div>
                <Text size="xs" className="mt-0.5 font-mono">
                  {tool.id} · v{tool.version}
                </Text>
              </div>
              <div className="flex shrink-0 items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                <span>{tool.kind}</span>
                <span>risk: {tool.risk}</span>
                <span>{tool.mutates ? 'mutates' : 'read-only'}</span>
              </div>
            </div>
            <Text>{tool.summary}</Text>
            <Text size="2xs" className="font-mono">provenance: {tool.provenance}</Text>
          </li>
        ))}
      </ul>
    </div>
  )
}
