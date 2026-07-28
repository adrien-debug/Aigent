import { Strong, Text } from '@/components/ui/text'
import { surfaceItemClass } from '@/components/agent-ops/surface-card'

export interface FactoryRuntimeRow {
  id: string
  label: string
  engine: string
  executable: boolean
  creatable: boolean
  capabilities: {
    tools: boolean
    streaming: boolean
    hitl: boolean
    checkpoints: boolean
    telemetry: boolean
  }
  note: string
}

const CAPABILITY_LABELS: Record<keyof FactoryRuntimeRow['capabilities'], string> = {
  tools: 'tools',
  streaming: 'streaming',
  hitl: 'HITL',
  checkpoints: 'checkpoints',
  telemetry: 'telemetry',
}

export function RuntimesPanel({ runtimes }: { runtimes: FactoryRuntimeRow[] }) {
  return (
    <div className="max-h-96 overflow-y-auto px-6 py-4">
      <ul className="flex flex-col gap-2">
        {runtimes.map((runtime) => {
          const activeCaps = (Object.keys(runtime.capabilities) as Array<keyof FactoryRuntimeRow['capabilities']>).filter(
            (key) => runtime.capabilities[key]
          )
          return (
            <li key={runtime.id} className={`flex flex-col gap-2 p-4 ${surfaceItemClass}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <Strong className="text-sm">{runtime.label}</Strong>
                  <Text size="xs" className="mt-0.5 font-mono">
                    {runtime.id} · engine: {runtime.engine}
                  </Text>
                </div>
                <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                  {runtime.executable ? 'executable' : 'not executable'}
                  {runtime.creatable ? ' · creatable' : ' · not creatable'}
                </span>
              </div>
              <Text>{runtime.note}</Text>
              <Text size="xs">
                {activeCaps.length > 0
                  ? `capabilities: ${activeCaps.map((c) => CAPABILITY_LABELS[c]).join(', ')}`
                  : 'no capabilities'}
              </Text>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
