import clsx from 'clsx'

import { Subheading } from '@/components/ui/heading'
import { surfaceRaised, surfaceSunken } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'
import type { TelemetryHealthDiagnostic } from '@/lib/agent-mission-control/telemetry-health'
import { eyebrowClass } from '@/components/agent-ops/surface-card'
import { CheckCircleIcon, SignalIcon } from '@heroicons/react/20/solid'

/**
 * TelemetryUnconfiguredState — the assumed, premium "nothing here yet" surface
 * for /admin/telemetry.
 *
 * The page used to fall back to a bare dashed box reading "No runtime telemetry
 * yet", which read as a BROKEN page rather than a deliberate state: it gave no
 * reason, no remedy, and no way to tell an unconfigured loop apart from a
 * genuinely idle fleet. That ambiguity is precisely what `diagnoseTelemetryHealth`
 * exists to resolve, so this surface renders the diagnostic instead of hiding it.
 *
 * DOCTRINE (inherited from telemetry-health.ts, must not be weakened here):
 * absence of events is NEVER presented as agent inactivity. Every string below
 * talks about the LOOP and its configuration, never about whether delivered
 * agents are running. No metric is invented — the only numbers shown are the
 * ones the diagnostic actually measured.
 *
 * The three steps mirror the three real opt-in levels of the loop. Each step's
 * `done` flag is DERIVED from the diagnostic, never assumed: a step is only
 * ticked when the diagnostic proves it, and stays untouched when the underlying
 * lookup failed (`unavailable`), where nothing is known and nothing is claimed.
 */
export function TelemetryUnconfiguredState({
  diagnostic,
}: {
  diagnostic: TelemetryHealthDiagnostic
}) {
  const steps = activationSteps(diagnostic)

  return (
    <div className={clsx(surfaceRaised, 'overflow-hidden')}>
      <div className="flex flex-col items-center gap-3 px-6 pt-10 pb-8 text-center">
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-2xl bg-[var(--accent-surface)] ring-1 ring-[var(--accent-line)]"
        >
          <SignalIcon className="size-6 text-accent-500" />
        </span>
        <div className="mx-auto max-w-xl">
          <Subheading tone="neutral" className="text-zinc-900 dark:text-white">
            {headline(diagnostic)}
          </Subheading>
          {/* Rendered verbatim: the diagnostic module already words this to avoid
              implying agents are inactive. Do not paraphrase it in the view. */}
          <Text className="mt-2 text-zinc-400">{diagnostic.summary}</Text>
        </div>
      </div>

      {/* The activation ladder — the "what to do to turn it on" half of the state.
          Sunken so it reads as an inset reference panel inside the card, not a
          second stacked card. */}
      <div className={clsx(surfaceSunken, 'rounded-none border-t border-zinc-950/10 px-6 py-6 dark:border-[var(--surface-border)]')}>
        <p className={clsx(eyebrowClass, 'mb-4')}>Activation — three independent opt-ins</p>
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                {step.done ? (
                  <CheckCircleIcon aria-hidden="true" className="size-4 shrink-0 text-accent-500" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px] text-zinc-500 ring-1 ring-white/15"
                  >
                    {index + 1}
                  </span>
                )}
                <span className="text-sm font-medium text-zinc-200">{step.title}</span>
                <span className="sr-only">{step.done ? '— done' : '— pending'}</span>
              </div>
              <p className="text-xs/5 text-zinc-500">{step.detail}</p>
              {step.env ? (
                <code className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">{step.env}</code>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function headline(diagnostic: TelemetryHealthDiagnostic): string {
  switch (diagnostic.status) {
    case 'not_configured':
      return 'Telemetry ingestion is not configured'
    case 'incomplete_configuration':
      return 'Ingestion is live — no agent declares telemetry yet'
    case 'loop_muted':
      return 'The telemetry loop is silent'
    case 'unavailable':
      return 'Telemetry health is unknown right now'
    default:
      return 'No runtime telemetry yet'
  }
}

interface ActivationStep {
  title: string
  detail: string
  env?: string
  /** Only true when the diagnostic PROVES the step is satisfied. */
  done: boolean
}

/**
 * Derives the three activation steps from the diagnostic.
 *
 * `unavailable` means the lookups themselves failed, so nothing is proven and
 * every step stays unticked — the copy says "unknown", it never guesses.
 */
function activationSteps(diagnostic: TelemetryHealthDiagnostic): ActivationStep[] {
  const known = diagnostic.status !== 'unavailable'
  // Level 3 is the only gate whose state is implied by the status itself:
  // `not_configured` is returned precisely when the ingestion token is unset,
  // so every other known status proves the token IS set.
  const ingestionConfigured = known && diagnostic.status !== 'not_configured'
  const declaredCount = diagnostic.agentsWithTelemetryDeclared
  const declaredKnown = known && declaredCount !== null

  return [
    {
      title: 'Aigent ingestion',
      detail: ingestionConfigured
        ? 'Configured — POST /api/runtime-telemetry accepts events.'
        : 'Set the ingestion token on Aigent. Until then the endpoint answers 503 to every agent.',
      env: 'AIGENT_RUNTIME_TELEMETRY_TOKEN',
      done: ingestionConfigured,
    },
    {
      title: 'Agent manifest',
      detail: declaredKnown
        ? declaredCount === 0
          ? 'No delivered agent declares telemetry in its manifest yet.'
          : `${declaredCount} agent${declaredCount === 1 ? '' : 's'} ${declaredCount === 1 ? 'declares' : 'declare'} telemetry in ${declaredCount === 1 ? 'its' : 'their'} manifest.`
        : 'Declared-agent count is unavailable right now.',
      done: declaredKnown && (declaredCount as number) > 0,
    },
    {
      title: 'Consumer runtime',
      detail:
        'Each delivered agent must switch telemetry on in its OWN repo and point it back at Aigent.',
      env: 'AIGENT_TELEMETRY_ENABLED · _ENDPOINT · _TOKEN',
      // Proven only by events actually arriving, which is `healthy` — a state
      // where this component is not rendered. Never inferred from the others.
      done: false,
    },
  ]
}
