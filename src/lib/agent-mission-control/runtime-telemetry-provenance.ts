import type {
  PromotionLifecycleEvent,
  RuntimeTelemetryEvent,
} from './runtime-telemetry-store'

/** Presentation provenance for one row in the runtime-telemetry feed. */
export type RuntimeTelemetryProvenance = 'internal' | 'lifecycle' | 'consumer' | 'unknown'

const LIFECYCLE_EVENT_TYPES = new Set<PromotionLifecycleEvent>([
  'shadow_started',
  'shadow_completed',
  'shadow_blocked_mutation',
  'replay_started',
  'replay_completed',
  'promotion_evaluated',
  'promotion_blocked',
  'promotion_completed',
])

const LIFECYCLE_SOURCES = new Set(['aigent-promotion', 'aigent-shadow', 'aigent-replay'])

function environmentSource(event: RuntimeTelemetryEvent): string | null {
  const source = event.environment?.source
  return typeof source === 'string' && source.trim().length > 0 ? source.trim() : null
}

/**
 * Classify a persisted telemetry event for display.
 *
 * Rules use only fields written by known emitters — never infer "consumer" from
 * the absence of an internal marker (doctrine: unknown until positively proven).
 */
export function classifyRuntimeTelemetryProvenance(
  event: RuntimeTelemetryEvent
): RuntimeTelemetryProvenance {
  const source = environmentSource(event)

  if (source === 'aigent-internal-runner') return 'internal'

  if (event.eventType !== undefined && LIFECYCLE_EVENT_TYPES.has(event.eventType)) {
    return 'lifecycle'
  }

  if (source !== null && LIFECYCLE_SOURCES.has(source)) return 'lifecycle'

  if (source === 'consumer' || source === 'aigent-consumer') return 'consumer'

  return 'unknown'
}
