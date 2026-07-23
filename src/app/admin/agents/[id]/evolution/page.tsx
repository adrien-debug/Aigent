import { notFound } from 'next/navigation'

import { EvolutionWorkbench, type EvolutionSuiteRef } from '@/components/agent-ops/agent-detail/evolution-workbench'
import { eyebrowClass, surfaceSectionClass } from '@/components/agent-ops/surface-card'
import { versionStageLabels } from '@/components/agent-ops/version-stage-text'
import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'
import { getAgentLifecycle } from '@/lib/agent-mission-control/agent-lifecycle'
import { getBenchmarkSuitesForCopilot, getTestSuitesForCopilot } from '@/lib/agent-mission-control/data'
import { compareImprovementVersions, type VersionComparison } from '@/lib/agent-mission-control/improvement-loop'

/**
 * Evolution — how an operator makes this agent better
 * (AIGENT-OPERATOR-RESTORE-028).
 *
 * Observability answers "what did this agent do"; Release answers "may this
 * version ship". This page answers the third question, which had no home after
 * the Improve surface was removed at eff7b22: generate a suite, run it,
 * benchmark, drive the improvement loop, read the proposal, compare V1 to V2,
 * approve or reject.
 *
 * What the page does NOT do is decide anything. `getAgentLifecycle` derives
 * every capability once, server-side, from THIS copilot's own `runtime`
 * field, and each control renders that capability verbatim — including the
 * ones that are unavailable, WITH their reason. There is no fixed roster
 * verdict here: a `langgraph` copilot gets "Run tests" enabled and a
 * full-fidelity benchmark; only a copilot actually running a runtime with no
 * execution engine (or none set) sees it disabled or degraded. That is the
 * correct rendering of whatever this agent's real runtime is, not a claim
 * about the roster as a whole.
 */
export default async function AgentEvolutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const lifecycle = await getAgentLifecycle(id)
  if (!lifecycle) notFound()

  const { capabilities, candidateVersion, productionVersion, latestProposal, latestBenchmark, suiteCount } = lifecycle

  // Suite lists come from the same getters Observability reads. They are the
  // targets of the run buttons — a suite that is not persisted cannot be run,
  // and the capability above already says so in words.
  const [testSuites, benchmarkSuites] = await Promise.all([
    getTestSuitesForCopilot(id),
    getBenchmarkSuitesForCopilot(id),
  ])

  // The V1/V2 table is recomputed live (never persisted), and only exists once
  // a V2 does. A failed read must not take the whole page down: the surface
  // renders "nothing to compare" rather than a 500 over a secondary panel.
  let comparison: VersionComparison | null = null
  if (latestProposal?.v2VersionId) {
    comparison = await compareImprovementVersions(id, latestProposal.baseVersionId, latestProposal.v2VersionId).catch(
      () => null
    )
  }

  const toRef = (s: { id: string; name: string }): EvolutionSuiteRef => ({ id: s.id, name: s.name || s.id })

  return (
    <div className="flex flex-col gap-6">
      <section className={surfaceSectionClass}>
        <div className="px-5 pt-4 pb-3">
          <Subheading level={2}>Current state</Subheading>
          <Text className="mt-1 !text-xs">
            What is serving today, what is queued behind it, and what has actually been measured.
          </Text>
        </div>
        <div className="px-5 pb-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
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
        </div>
      </section>

      <section className={surfaceSectionClass}>
        <div className="px-5 pt-4 pb-3">
          <Subheading level={2}>Evolution</Subheading>
          <Text className="mt-1 !text-xs">
            Each control states what it can do on this agent before you click it. A disabled control carries its
            reason; a control that runs but proves less than its label says so too.
          </Text>
        </div>
        <div className="px-5 pb-5">
          <EvolutionWorkbench
            copilotId={id}
            capabilities={capabilities}
            testSuites={testSuites.map(toRef)}
            benchmarkSuites={benchmarkSuites.map(toRef)}
            latestProposal={latestProposal}
            comparison={comparison}
            candidateLabel={candidateVersion?.label ?? null}
          />
        </div>
      </section>
    </div>
  )
}
