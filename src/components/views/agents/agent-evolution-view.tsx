import { EvolutionWorkbench, type EvolutionSuiteRef } from '@/components/agent-ops/agent-detail/evolution-workbench'
import { eyebrowClass } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import { Section } from '@/components/ui/section'
import { versionStageLabels } from '@/components/agent-ops/version-stage-text'
import type { AgentLifecycle } from '@/lib/agent-mission-control/agent-lifecycle'
import type { VersionComparison } from '@/lib/agent-mission-control/improvement-loop'

/**
 * /admin/agents/[id]/evolution — how an operator makes this agent better
 * (AIGENT-OPERATOR-RESTORE-028).
 *
 * Observability answers "what did this agent do"; Release answers "may this
 * version ship". This view answers the third question: generate a suite, run
 * it, benchmark, drive the improvement loop, read the proposal, compare V1 to
 * V2, approve or reject.
 *
 * What the view does NOT do is decide anything. `getAgentLifecycle` (called
 * by `page.tsx`) derives every capability once, server-side, from THIS
 * copilot's own `runtime` field, and each control renders that capability
 * verbatim — including the ones that are unavailable, WITH their reason.
 */
export function AgentEvolutionView({
  copilotId,
  lifecycle,
  testSuites,
  benchmarkSuites,
  comparison,
}: {
  copilotId: string
  lifecycle: AgentLifecycle
  testSuites: EvolutionSuiteRef[]
  benchmarkSuites: EvolutionSuiteRef[]
  comparison: VersionComparison | null
}) {
  const { capabilities, candidateVersion, productionVersion, latestProposal, latestBenchmark, suiteCount } = lifecycle

  return (
    <PageLayout>
      <Section title="Current state" description="What is serving today, what is queued behind it, and what has actually been measured.">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 lg:grid-cols-4">
          <div>
            <dt className={eyebrowClass}>Production version</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-zinc-200">
              {productionVersion ? productionVersion.label : '—'}
            </dd>
            <p className="mt-1 text-xs text-zinc-400">
              {productionVersion ? versionStageLabels[productionVersion.stage] : 'Nothing is in production'}
            </p>
          </div>
          <div>
            <dt className={eyebrowClass}>Candidate version</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-zinc-200">
              {candidateVersion ? candidateVersion.label : '—'}
            </dd>
            <p className="mt-1 text-xs text-zinc-400">
              {candidateVersion ? versionStageLabels[candidateVersion.stage] : 'No candidate version'}
            </p>
          </div>
          <div>
            <dt className={eyebrowClass}>Test suites</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-zinc-200">{suiteCount}</dd>
            <p className="mt-1 text-xs text-zinc-400">
              {/* `suiteCount` is measured; a failed read is carried by the
                  run-tests capability, which says so in words. */}
              {suiteCount === 0 ? 'None persisted' : 'Persisted for this agent'}
            </p>
          </div>
          <div>
            <dt className={eyebrowClass}>Latest benchmark</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-zinc-200">
              {/* A benchmark run that recorded no score is not a score of 0 —
                  the two claims stay distinct all the way to the pixels. */}
              {latestBenchmark && latestBenchmark.score !== null ? latestBenchmark.score.toFixed(1) : '—'}
            </dd>
            <p className="mt-1 text-xs text-zinc-400">
              {latestBenchmark === null
                ? 'No completed benchmark'
                : latestBenchmark.score === null
                  ? 'A run exists but recorded no score'
                  : 'Latest completed run, any version'}
            </p>
          </div>
        </dl>
      </Section>

      <Section
        title="Evolution"
        description="Each control states what it can do on this agent before you click it. A disabled control carries its reason; a control that runs but proves less than its label says so too."
      >
        <div className="px-5">
          <EvolutionWorkbench
            copilotId={copilotId}
            capabilities={capabilities}
            testSuites={testSuites}
            benchmarkSuites={benchmarkSuites}
            latestProposal={latestProposal}
            comparison={comparison}
            candidateLabel={candidateVersion?.label ?? null}
          />
        </div>
      </Section>
    </PageLayout>
  )
}
