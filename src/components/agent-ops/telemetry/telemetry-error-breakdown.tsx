import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { SplitBar, type SplitTone } from '@/components/agent-ops/widgets/split-bar'
import type { RuntimeTelemetryErrorCategory } from '@/lib/agent-mission-control/runtime-telemetry-store'

/** Intensity ramp for the top-5 categories — one accent hue, darkest = most frequent. */
const TONE_RAMP: SplitTone[] = ['accent-700', 'accent-600', 'accent-500', 'accent-400', 'accent-300']

/**
 * TelemetryErrorBreakdown — top failure categories across the fleet, one
 * stacked SplitBar (severity by intensity, never a second hue). Empty when
 * no failed event has ever been reported — a healthy fleet, not a bug.
 */
export function TelemetryErrorBreakdown({ categories }: { categories: RuntimeTelemetryErrorCategory[] }) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Top Error Categories" />
      <div className="px-6 py-5">
        {categories.length === 0 ? (
          <EmptyState
            icon={ExclamationTriangleIcon}
            title="No failures reported"
            description="Every telemetry event received so far completed successfully."
          />
        ) : (
          <SplitBar
            segments={categories.map((c, i) => ({
              key: c.category,
              label: c.category,
              value: c.count,
              tone: TONE_RAMP[i] ?? 'zinc',
            }))}
          />
        )}
      </div>
    </SurfaceCard>
  )
}
