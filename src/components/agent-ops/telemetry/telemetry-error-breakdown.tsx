import { ExclamationTriangleIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { SplitBar, type SplitTone } from '@/components/agent-ops/widgets/split-bar'
import type {
  RuntimeTelemetryErrorCategory,
  TelemetryMeasurementState,
} from '@/lib/agent-mission-control/runtime-telemetry-store'

/** Intensity ramp for the top-5 categories — one accent hue, darkest = most frequent. */
const TONE_RAMP: SplitTone[] = ['accent-700', 'accent-600', 'accent-500', 'accent-400', 'accent-300']

/**
 * TelemetryErrorBreakdown — top failure categories across the fleet, one
 * stacked SplitBar (severity by intensity, never a second hue).
 *
 * `categoriesState` distinguishes two states that both render an empty
 * `categories` array but mean opposite things: NOT_APPLICABLE = zero failures
 * happened (a genuinely healthy fleet); UNAVAILABLE = failures happened but
 * the reference emitter never sent `error.category` for any of them (the
 * categorization signal itself is missing, not the failures). Collapsing
 * both into "No failures reported" would misrepresent an unmeasured fleet as
 * a healthy one.
 */
export function TelemetryErrorBreakdown({
  categories,
  categoriesState,
}: {
  categories: RuntimeTelemetryErrorCategory[]
  categoriesState: TelemetryMeasurementState
}) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Top Error Categories" />
      <div className="px-6 py-5">
        {categories.length > 0 ? (
          <SplitBar
            segments={categories.map((c, i) => ({
              key: c.category,
              label: c.category,
              value: c.count,
              tone: TONE_RAMP[i] ?? 'zinc',
            }))}
          />
        ) : categoriesState === 'UNAVAILABLE' ? (
          <EmptyState
            icon={QuestionMarkCircleIcon}
            title="Failure categorization not reported"
            description="Runs failed in this window, but the reporting emitter never sent an error.category — the failure count above is real, its breakdown by cause is not measured."
          />
        ) : (
          <EmptyState
            icon={ExclamationTriangleIcon}
            title="No failures reported"
            description="Every telemetry event received so far completed successfully."
          />
        )}
      </div>
    </SurfaceCard>
  )
}
