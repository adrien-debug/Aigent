import { ArrowRightIcon, CheckCircleIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'
import { notFound } from 'next/navigation'

import { AgentBentoCard } from '@/components/agent-ops/agent-bento-card'
import { AgentSkillsCard } from '@/components/agent-ops/agent-skills-card'
import { DeliveryScorecardCard } from '@/components/agent-ops/delivery-scorecard-card'
import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { ArchitectureStrip } from '@/components/agent-ops/architecture-strip'
import { CopilotProjectActions } from '@/components/agent-ops/copilot-project-actions'
import { OnboardingSteps } from '@/components/agent-ops/onboarding-steps'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { RadialMeter } from '@/components/agent-ops/widgets/radial-meter'
import { Sparkline } from '@/components/agent-ops/widgets/sparkline'
import { SplitBar } from '@/components/agent-ops/widgets/split-bar'
import {
  AGENT_RUNTIME_LABELS,
  AGENT_RUN_STATUS_LABELS,
  COPILOT_STATUS_LABELS,
  MODEL_PROVIDER_LABELS,
} from '@/lib/agent-mission-control/labels'
import { Button } from '@/components/catalyst/button'
import { Link } from '@/components/catalyst/link'
import { formatDurationMs, formatPercent, formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
import {
  getBenchmarkResultsForRuns,
  getBenchmarkRunsForSuites,
  getBenchmarkSuitesForCopilot,
  getCopilot,
  getManifestForCopilot,
  getProject,
  getProjects,
  getPromotionGateForCopilot,
  getRunsForCopilot,
  getShadowExperimentsForCopilot,
  getTestResultsForRun,
  getTestRunsForCopilot,
  getTestSuitesForCopilot,
  getToolsForCopilot,
  getVersion,
} from '@/lib/agent-mission-control/data'
import { versionStageLabels } from '@/components/agent-ops/version-stage-text'
import type {
  AgentRunStatus,
  BenchmarkResult,
  BenchmarkRun,
  BenchmarkSuite,
  Project,
} from '@/lib/agent-mission-control/types'

// ---------------------------------------------------------------------------
// Semantic maps — plain text labels, no colored badges
// ---------------------------------------------------------------------------

const runStatusConfig: Record<AgentRunStatus, { label: string; text: string }> = {
  completed: { label: AGENT_RUN_STATUS_LABELS.completed, text: 'text-zinc-500 dark:text-zinc-400' },
  running: { label: AGENT_RUN_STATUS_LABELS.running, text: 'text-zinc-500 dark:text-zinc-400' },
  'needs-confirmation': { label: AGENT_RUN_STATUS_LABELS['needs-confirmation'], text: 'text-zinc-500 dark:text-zinc-400' },
  blocked: { label: AGENT_RUN_STATUS_LABELS.blocked, text: 'text-zinc-500 dark:text-zinc-400' },
  failed: { label: AGENT_RUN_STATUS_LABELS.failed, text: 'text-zinc-500 dark:text-zinc-400' },
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/** One label/value cell in the dense Identity grid. */
function IdentityField({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  )
}

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-accent-700 hover:text-accent-600 dark:text-accent-400 dark:hover:text-accent-300"
    >
      {children}
      <ArrowRightIcon aria-hidden="true" className="size-3.5" />
    </Link>
  )
}

/** Naked stat cell (no box) — AgentMetricCard rhythm: uppercase label + mono value. */
function RuntimeStat({
  label,
  value,
  accent = false,
  children,
}: {
  label: string
  value: React.ReactNode
  accent?: boolean
  children?: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd
        className={clsx(
          'mt-1 font-mono text-lg tabular-nums',
          accent ? 'text-accent-600 dark:text-accent-400' : 'text-zinc-950 dark:text-white'
        )}
      >
        {value}
      </dd>
      {children}
    </div>
  )
}

/**
 * Priority labels for the Next actions feed — plain text, no colored badges.
 */
const nextActionPriority: Record<string, { label: string }> = {
  gate: { label: 'Gate' },
  errors: { label: 'Errors' },
  shadow: { label: 'Shadow' },
  tests: { label: 'Tests' },
  tools: { label: 'Tools' },
  'untested-draft': { label: 'Draft' },
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CopilotOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  const base = `/admin/agents/${copilot.id}`
  const [
    project,
    allProjects,
    manifest,
    tools,
    productionVersion,
    latestVersion,
    allTestRuns,
    testSuites,
    allRuns,
    benchmarkSuites,
    shadowExperiments,
    gate,
  ] = await Promise.all([
    copilot.projectId ? getProject(copilot.projectId) : undefined,
    getProjects(),
    getManifestForCopilot(copilot.id),
    getToolsForCopilot(copilot.id),
    copilot.productionVersionId ? getVersion(copilot.productionVersionId) : undefined,
    getVersion(copilot.latestVersionId),
    getTestRunsForCopilot(copilot.id),
    getTestSuitesForCopilot(copilot.id),
    getRunsForCopilot(copilot.id),
    getBenchmarkSuitesForCopilot(copilot.id),
    getShadowExperimentsForCopilot(copilot.id),
    getPromotionGateForCopilot(copilot.id),
  ])
  const enabledTools = tools.filter((tool) => tool.enabled)

  // Validation bench — projectId null means not yet validated; targetProjectIds are the
  // intended dev destination(s) once the copilot graduates.
  const onBench = copilot.projectId === null
  const targetProjects: Project[] =
    onBench && copilot.targetProjectIds.length > 0
      ? (await Promise.all(copilot.targetProjectIds.map((projectId) => getProject(projectId)))).filter(
          (candidate): candidate is Project => candidate !== undefined
        )
      : []

  // Tests — latest run + result breakdown
  const testRuns = [...allTestRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const latestTestRun = testRuns[0]
  const latestTestResults = latestTestRun ? await getTestResultsForRun(latestTestRun.id) : []
  const passCount = latestTestResults.filter((r) => r.status === 'pass').length
  const failCount = latestTestResults.filter((r) => r.status === 'fail').length
  const errorCount = latestTestResults.filter((r) => r.status === 'error').length
  // The gauge shows the SAME latest run as the pass/fail bar beside it, so it's
  // derived from that run's own results (intra-screen coherence). `health` is
  // now run-backed too (data.ts derives it from real runs) and is the fallback
  // when this screen has no per-result breakdown to count.
  const latestTestTotal = passCount + failCount + errorCount
  const displayTestPassRate =
    latestTestTotal > 0 ? passCount / latestTestTotal : copilot.health.testPassRate

  // Runs — last 5, newest first
  const runs = [...allRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const lastRuns = runs.slice(0, 5)
  // Latency in chronological order (oldest → newest) for sparklines, and the
  // window max so per-row meters read relative to the busiest run.
  const latencySeries = [...lastRuns].reverse().map((run) => run.latencyMs)
  const maxRunLatency = Math.max(...lastRuns.map((run) => run.latencyMs), 1)

  // Benchmarks — best candidate across all suites. Two grouped PostgREST calls
  // (all runs for all suites, then all results for all runs) instead of a
  // suite × run cascade.
  const suiteIds = benchmarkSuites.map((suite) => suite.id)
  const allBenchmarkRuns = await getBenchmarkRunsForSuites(suiteIds)
  const benchmarkResults = await getBenchmarkResultsForRuns(allBenchmarkRuns.map((run) => run.id))
  const resultByRunId = new Map(benchmarkResults.map((result) => [result.runId, result]))
  const suiteById = new Map(benchmarkSuites.map((suite) => [suite.id, suite]))
  const benchmarkCandidates: { suite: BenchmarkSuite; run: BenchmarkRun; result: BenchmarkResult }[] =
    allBenchmarkRuns.flatMap((run) => {
      const result = resultByRunId.get(run.id)
      const suite = suiteById.get(run.suiteId)
      return result && suite ? [{ suite, run, result }] : []
    })
  const bestCandidate = benchmarkCandidates.reduce<(typeof benchmarkCandidates)[number] | null>(
    (best, candidate) => (best === null || candidate.result.score > best.result.score ? candidate : best),
    null
  )

  // Shadow + gate → next actions
  const runningShadow = shadowExperiments.find((experiment) => experiment.status === 'running')

  const isSparseDraft = copilot.status === 'draft' && runs.length === 0 && testRuns.length === 0
  // Onboarding progress (mirrors OnboardingSteps): manifest → tools → tests → promote.
  const onboardingDone = [
    Boolean(manifest),
    enabledTools.length > 0,
    testSuites.length > 0,
    Boolean(productionVersion),
  ].filter(Boolean).length

  // -------------------------------------------------------------------------
  // Next actions — derived from data, capped at 4
  // -------------------------------------------------------------------------

  const nextActions: { key: string; title: string; reason: string; href: string }[] = []

  if (gate && gate.overallStatus !== 'ready') {
    const candidate = await getVersion(gate.candidateVersionId)
    const failing = gate.checks.filter((check) => check.status === 'fail').length
    const pending = gate.checks.filter((check) => check.status === 'pending').length
    nextActions.push({
      key: 'gate',
      title: 'Open the promotion gate',
      reason: `${candidate?.label ?? gate.candidateVersionId} → ${versionStageLabels[gate.targetStage]}: ${failing} failing and ${pending} pending of ${gate.checks.length} checks.`,
      href: `${base}/versions#publish`,
    })
  }

  if (runningShadow && runningShadow.agreementRate < runningShadow.agreementThreshold) {
    nextActions.push({
      key: 'shadow',
      title: 'Review shadow mismatches',
      reason: `Agreement at ${formatPercent(runningShadow.agreementRate)}, below the ${formatPercent(runningShadow.agreementThreshold)} threshold, with ${runningShadow.unsafeProposalCount} unsafe proposal${runningShadow.unsafeProposalCount === 1 ? '' : 's'}.`,
      href: `${base}/tests#shadow`,
    })
  }

  if (latestTestRun && failCount + errorCount > 0) {
    nextActions.push({
      key: 'tests',
      title: 'Inspect failing test cases',
      reason: `${failCount + errorCount} of ${latestTestResults.length} cases failing in the latest run (${formatTimestamp(latestTestRun.startedAt)}).`,
      href: `${base}/tests`,
    })
  }

  if (copilot.health.errorRateLast24h > 0.05) {
    nextActions.push({
      key: 'errors',
      title: 'Investigate the elevated error rate',
      reason: `${formatPercent(copilot.health.errorRateLast24h)} of runs errored in the last 24h, above the 5% alert threshold.`,
      href: `${base}/runs`,
    })
  }

  const failingTool = enabledTools.find((tool) => tool.errorRateLast7d >= 0.1)
  if (failingTool) {
    nextActions.push({
      key: 'tools',
      title: 'Check failing tools',
      reason: `${failingTool.name} is at ${formatPercent(failingTool.errorRateLast7d)} error rate over 7 days.`,
      href: `${base}/manifest#tools`,
    })
  }

  const latestVersionUntested = latestVersion
    ? latestVersion.scoresEvidence
      ? latestVersion.scoresEvidence === 'none'
      : latestVersion.scores.testPassRate === 0
    : false
  if (latestVersion && latestVersion.stage === 'draft' && latestVersionUntested && !isSparseDraft) {
    nextActions.push({
      key: 'untested-draft',
      title: `Run the test suites on ${latestVersion.label}`,
      reason: 'The latest draft version has no test results yet.',
      href: `${base}/tests`,
    })
  }

  const visibleActions = nextActions.slice(0, 4)

  // -------------------------------------------------------------------------
  // Architecture strip — statuses from data
  // -------------------------------------------------------------------------

  const architectureSteps: { name: string; detail?: string; status?: 'ok' | 'warn' | 'off' }[] = [
    {
      name: 'Input',
      detail: `${copilot.health.runsLast24h} runs / 24h`,
      status: copilot.health.runsLast24h > 0 ? 'ok' : 'off',
    },
    {
      name: 'Manifest gate',
      detail: manifest
        ? `${manifest.allowedRoutes.length} routes · ${manifest.forbiddenActions.length} forbidden`
        : 'no manifest',
      status: manifest ? 'ok' : 'off',
    },
    {
      name: 'LLM',
      detail: copilot.model,
      status: 'ok',
    },
    {
      name: 'Tools',
      detail: `${enabledTools.length} of ${tools.length} enabled`,
      status: enabledTools.length > 0 ? 'ok' : 'off',
    },
    {
      name: 'Guardrails',
      detail: manifest ? `confirm: ${manifest.confirmationPolicy}` : undefined,
      status: copilot.status === 'degraded' ? 'warn' : manifest ? 'ok' : 'off',
    },
    {
      name: 'Output contract',
      detail: manifest ? (manifest.outputContract.schemaName ?? manifest.outputContract.format) : undefined,
      status: manifest ? 'ok' : 'off',
    },
  ]

  return (
    <div className="space-y-8">
      {/* 2 — Bento grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Identity — 2 cols. No duplicated title/description: the page header already carries them. */}
        <AgentBentoCard title="Identity" className="lg:col-span-2" level={2}>
          {/* Two-column field grid — pairs fill the width instead of a wide
              empty right gutter. Tags span the full row. */}
          <dl className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2">
            <IdentityField label="Owner">
              <span className="font-mono text-sm text-zinc-950 dark:text-white">{copilot.owner}</span>
            </IdentityField>

            <IdentityField label="Project">
              <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                {onBench ? (
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-accent-600 dark:text-accent-400">
                      Validation bench
                      <span className="sr-only"> — not yet validated</span>
                    </span>
                    {targetProjects.length > 0 ? (
                      <span className="text-zinc-500 dark:text-zinc-400">
                        → {targetProjects.map((target) => target.name).join(', ')}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="min-w-0 truncate text-zinc-950 dark:text-white">{project?.name ?? '—'}</span>
                )}
                <CopilotProjectActions
                  copilot={copilot}
                  projects={allProjects}
                  projectName={project?.name ?? null}
                />
              </span>
            </IdentityField>

            <IdentityField label="Model">
              <span className="font-mono text-sm tabular-nums text-zinc-950 dark:text-white">{copilot.model}</span>
            </IdentityField>

            <IdentityField label="Provider">
              <span className="text-zinc-950 dark:text-white">{MODEL_PROVIDER_LABELS[copilot.modelProvider]}</span>
            </IdentityField>

            <IdentityField label="Created">
              <span className="tabular-nums text-zinc-950 dark:text-white">{formatTimestamp(copilot.createdAt)}</span>
            </IdentityField>

            <IdentityField label="Updated">
              <span className="tabular-nums text-zinc-950 dark:text-white">{formatTimestamp(copilot.updatedAt)}</span>
            </IdentityField>

            <IdentityField label="Tags" className="sm:col-span-2">
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {copilot.tags.map((tag) => (
                  <span key={tag} className="font-mono text-sm text-zinc-500 dark:text-zinc-400">
                    {tag}
                  </span>
                ))}
              </span>
            </IdentityField>
          </dl>
        </AgentBentoCard>

        {/* Runtime & status — 1 col. Gauge + mini-stats instead of a dash column. */}
        <AgentBentoCard title="Runtime & status" level={2}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {/* Derived displayStatus: "Production" when a version is serving prod,
                  even though the stored status column still reads draft. */}
              {(copilot.displayStatus ?? copilot.status) === 'production'
                ? 'Production'
                : (COPILOT_STATUS_LABELS[copilot.status] ?? copilot.status)}
            </span>
            <span className="text-zinc-500 dark:text-zinc-400">{AGENT_RUNTIME_LABELS[copilot.runtime]}</span>
          </div>

          {/* Version rows — two tight labelled rows (real labels, not dashes). */}
          <dl className="mt-6 space-y-2.5 border-t border-zinc-950/5 pt-5 text-sm dark:border-white/5">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-zinc-500">Production</dt>
              <dd className="flex items-center gap-2 text-right">
                {productionVersion ? (
                  <>
                    <span className="font-mono text-zinc-950 tabular-nums dark:text-white">{productionVersion.label}</span>
                    <span className="text-zinc-500 dark:text-zinc-400">{versionStageLabels[productionVersion.stage]}</span>
                  </>
                ) : (
                  <span className="text-zinc-500 dark:text-zinc-400">Not in production</span>
                )}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-zinc-500">Latest version</dt>
              <dd className="flex items-center gap-2 text-right">
                {latestVersion ? (
                  <>
                    <span className="font-mono text-zinc-950 tabular-nums dark:text-white">{latestVersion.label}</span>
                    <span className="text-zinc-500 dark:text-zinc-400">{versionStageLabels[latestVersion.stage]}</span>
                  </>
                ) : (
                  <span className="text-zinc-500 dark:text-zinc-400">Not created yet</span>
                )}
              </dd>
            </div>
            {/* Push receipt — the proof this copilot's runtime actually shipped to
                the repo. Only rendered once a real push landed (`pushed`); the
                timestamp comes straight from the stored lastPushedAt, the commit
                link (accent) is the destination. */}
            {copilot.lastPushStatus === 'pushed' ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-zinc-500">Deployed to repo</dt>
                <dd className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-1 text-right">
                  {copilot.lastPushedAt ? (
                    <span className="tabular-nums text-zinc-950 dark:text-white">
                      {formatTimestamp(copilot.lastPushedAt)}
                    </span>
                  ) : (
                    <span className="text-zinc-950 dark:text-white">Pushed</span>
                  )}
                  {copilot.lastPushCommitUrl ? (
                    <Link
                      href={copilot.lastPushCommitUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-accent-700 hover:text-accent-600 dark:text-accent-400 dark:hover:text-accent-300"
                    >
                      View commit
                      <ArrowRightIcon aria-hidden="true" className="size-3.5" />
                    </Link>
                  ) : null}
                </dd>
              </div>
            ) : null}
          </dl>

          {copilot.health.runsLast24h > 0 ? (
            /* Live: error ring on the left, 2×2 stat grid on the right — no empty gutter. */
            <div className="mt-6 flex items-center gap-6 border-t border-zinc-950/5 pt-6 dark:border-white/5">
              <RadialMeter
                value={copilot.health.errorRateLast24h}
                max={1}
                size={104}
                centerText={formatPercent(copilot.health.errorRateLast24h)}
                caption="errors · 24h"
                tone={copilot.health.errorRateLast24h > 0.05 ? 'accentSolid' : 'accent'}
                ariaLabel={`Error rate over the last 24 hours: ${formatPercent(copilot.health.errorRateLast24h)}`}
              />
              <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-5">
                <RuntimeStat label="Runs · 24h" value={copilot.health.runsLast24h} />
                <RuntimeStat
                  label="Avg latency"
                  value={copilot.health.avgLatencyMs > 0 ? formatDurationMs(copilot.health.avgLatencyMs) : '—'}
                >
                  {latencySeries.length > 1 ? (
                    <div className="mt-1.5">
                      <Sparkline
                        points={latencySeries}
                        kind="bar"
                        tone="accent"
                        width={72}
                        height={18}
                        ariaLabel="Latency across the last runs"
                      />
                    </div>
                  ) : null}
                </RuntimeStat>
                <RuntimeStat label="Cost · 24h" value={formatUsd(copilot.health.costLast24hUsd)} />
                <RuntimeStat
                  label="Open warnings"
                  value={copilot.health.openWarnings}
                  accent={copilot.health.openWarnings > 0}
                />
              </dl>
            </div>
          ) : (
            /* No traffic yet — compact draft state, zero dashes. */
            <div className="mt-6 border-t border-zinc-950/5 pt-6 dark:border-white/5">
              <p className="text-sm text-zinc-700 dark:text-zinc-300">No production traffic yet.</p>
              <p className="mt-1 text-xs text-zinc-500">
                Live error and latency meters appear once{' '}
                <span className="font-mono tabular-nums">{latestVersion?.label ?? 'the first version'}</span> ships to
                beta.
              </p>
            </div>
          )}
        </AgentBentoCard>

        {isSparseDraft ? (
          /* Onboarding empty state — two columns fill the width: a progress
             ring + narrative on the left, the actionable stepper on the right
             (hairline divider, not a nested box). No wasted center gutter. */
          <AgentSectionCard
            title="Ship your first version"
            className="lg:col-span-3"
            contentClassName="relative px-6 py-8 sm:px-8"
          >
            <div className="relative grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
              <div>
                <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Draft copilot</p>
                <div className="mt-5 flex items-center gap-4">
                  <RadialMeter
                    value={onboardingDone}
                    max={4}
                    segments={4}
                    size={104}
                    centerText={`${onboardingDone}/4`}
                    caption="steps done"
                    ariaLabel={`Onboarding progress: ${onboardingDone} of 4 steps complete`}
                  />
                  <p className="max-w-xs text-sm text-pretty text-zinc-500 dark:text-zinc-400">
                    {copilot.name} has a manifest and a skeleton graph, but no test runs, benchmark or production
                    traffic yet. Finish the checklist to get{' '}
                    <span className="font-mono tabular-nums">{latestVersion?.label ?? 'the first version'}</span> ready
                    for beta.
                  </p>
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button color="accent" href={`${base}/manifest`}>
                    Review the manifest
                  </Button>
                  <Button outline href={`${base}/tests`}>
                    Set up tests
                  </Button>
                </div>
              </div>

              {/* Actionable stepper — each step links to its real tab route. */}
              <div className="lg:border-l lg:border-zinc-950/5 lg:pl-10 lg:dark:border-white/5">
                <OnboardingSteps
                  copilotId={copilot.id}
                  hasManifest={Boolean(manifest)}
                  toolCount={enabledTools.length}
                  testSuiteCount={testSuites.length}
                  hasProductionVersion={Boolean(productionVersion)}
                />
              </div>
            </div>
          </AgentSectionCard>
        ) : (
          <>
            {/* Tests & benchmarks — ONE card, two gauge rows split by a hairline. */}
            <AgentBentoCard title="Tests & benchmarks" level={2}>
              {/* Tests row — pass-rate ring + pass/fail/error split bar. */}
              <div className="flex items-start gap-6">
                <RadialMeter
                  value={displayTestPassRate}
                  max={1}
                  size={92}
                  centerText={formatPercent(displayTestPassRate)}
                  caption="pass rate"
                  ariaLabel={`Test pass rate: ${formatPercent(displayTestPassRate)}`}
                />
                <div className="min-w-0 flex-1">
                  {latestTestRun ? (
                    <SplitBar
                      segments={[
                        { key: 'pass', label: 'Pass', value: passCount, tone: 'accent-500' },
                        { key: 'fail', label: 'Fail', value: failCount, tone: 'accent-700' },
                        ...(errorCount > 0
                          ? [{ key: 'error', label: 'Error', value: errorCount, tone: 'accent-600' as const }]
                          : []),
                      ]}
                      caption={`Latest run · ${formatTimestamp(latestTestRun.startedAt)}`}
                    />
                  ) : (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">No recorded test runs for this copilot.</p>
                  )}
                  <div className="mt-4">
                    <SectionLink href={`${base}/tests`}>View tests</SectionLink>
                  </div>
                </div>
              </div>

              {/* Benchmarks row — best-score ring + task-success meter + model. */}
              <div className="mt-6 border-t border-zinc-950/5 pt-6 dark:border-white/5">
                {bestCandidate ? (
                  <div className="flex items-start gap-6">
                    <RadialMeter
                      value={bestCandidate.result.score}
                      max={100}
                      size={92}
                      centerText={String(bestCandidate.result.score)}
                      caption={`best · ${bestCandidate.suite.name}`}
                      ariaLabel={`Best benchmark score: ${bestCandidate.result.score} of 100 on ${bestCandidate.suite.name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <LinearMeter
                        value={bestCandidate.result.taskSuccessRate}
                        max={1}
                        label="Task success"
                        valueText={formatPercent(bestCandidate.result.taskSuccessRate)}
                        ariaLabel={`Task success rate: ${formatPercent(bestCandidate.result.taskSuccessRate)}`}
                      />
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-xs text-zinc-500">Model</span>
                        <span className="font-mono text-sm text-zinc-500 dark:text-zinc-400">
                          {bestCandidate.run.model}
                        </span>
                      </div>
                      <div className="mt-4">
                        <SectionLink href={`${base}/tests#benchmarks`}>View benchmarks</SectionLink>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">No benchmark runs yet for this copilot.</p>
                )}
              </div>
            </AgentBentoCard>

            {/* Last runs — 2 cols */}
            <AgentSectionCard
              title="Last runs"
              description="Most recent production traffic"
              // The latency sparkline lives once, next to "Avg latency" in Runtime &
              // status; here each row already carries its own per-run latency meter,
              // so a second trend sparkline would only duplicate the same series.
              actions={<SectionLink href={`${base}/runs`}>View all runs</SectionLink>}
              className="lg:col-span-2"
              contentClassName="p-0"
            >
              {lastRuns.length > 0 ? (
                <ul className="divide-y divide-zinc-950/5 dark:divide-white/5">
                  {lastRuns.map((run) => {
                    const statusConfig = runStatusConfig[run.status]
                    return (
                      <li key={run.id}>
                        {/* Whole row is a real link — hover affordance only where a destination exists. */}
                        <Link
                          href={`${base}/runs?run=${run.id}`}
                          className="flex items-start gap-3 px-6 py-3 hover:bg-zinc-950/2.5 dark:hover:bg-white/2.5"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="truncate text-sm text-zinc-700 dark:text-zinc-300">
                                {run.inputSummary}
                              </span>
                              <time
                                dateTime={run.startedAt}
                                className="shrink-0 font-mono text-xs text-zinc-500 tabular-nums"
                              >
                                {formatTimestamp(run.startedAt)}
                              </time>
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                              <span className={clsx('font-medium', statusConfig.text)}>{statusConfig.label}</span>
                              <span className="inline-flex items-center gap-2">
                                <span className="w-16">
                                  <LinearMeter
                                    value={run.latencyMs}
                                    max={maxRunLatency}
                                    size="xs"
                                    tone="accent"
                                    ariaLabel={`Latency ${formatDurationMs(run.latencyMs)}`}
                                  />
                                </span>
                                <span className="font-mono text-zinc-500 tabular-nums">
                                  {formatDurationMs(run.latencyMs)}
                                </span>
                              </span>
                              <span className="font-mono text-zinc-500 tabular-nums">{formatUsd(run.costUsd)}</span>
                              <span className="truncate text-zinc-500">{run.userLabel}</span>
                            </span>
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="px-6 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No runs recorded for this copilot yet.
                </p>
              )}
            </AgentSectionCard>
          </>
        )}
      </div>

      {/* 3 — Architecture strip, on the canonical section card */}
      <AgentSectionCard title="Architecture" description="Execution path enforced on every run">
        <ArchitectureStrip steps={architectureSteps} />
      </AgentSectionCard>

      {/* 3a — Delivery scorecard (repo-fit + run-backed signals, non-blocking).
          Skipped on a sparse draft — nothing measured yet to aggregate. */}
      {!isSparseDraft ? <DeliveryScorecardCard copilotId={copilot.id} /> : null}

      {/* 3b — Skills, aggregating role + enabled tools + guardrails */}
      <AgentSkillsCard manifest={manifest} enabledTools={enabledTools} />

      {/* 4 — Next actions (the onboarding checklist covers the sparse draft) */}
      {!isSparseDraft ? (
        <AgentSectionCard
          title="Next actions"
          description="Derived from the promotion gate, tests, shadow traffic and live errors"
          actions={
            visibleActions.length > 0 ? (
              <span className="font-mono text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
                {visibleActions.length}
              </span>
            ) : undefined
          }
          contentClassName={visibleActions.length > 0 ? 'divide-y divide-zinc-950/5 dark:divide-white/5' : 'px-6 py-5'}
        >
          {visibleActions.length > 0 ? (
            visibleActions.map((action) => {
              const priority = nextActionPriority[action.key] ?? { label: 'Action' }
              return (
                <Link
                  key={action.key}
                  href={action.href}
                  className="group flex items-start gap-4 px-6 py-4 hover:bg-zinc-950/2.5 dark:hover:bg-white/2.5"
                >
                  <span className="mt-0.5 shrink-0 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                    {priority.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-zinc-950 dark:text-white">{action.title}</span>
                    <span className="mt-1 block truncate text-sm text-zinc-500 dark:text-zinc-400">{action.reason}</span>
                  </span>
                  <ArrowRightIcon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-zinc-500 transition-colors duration-150 group-hover:text-zinc-300"
                  />
                </Link>
              )
            })
          ) : (
            <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <CheckCircleIcon aria-hidden="true" className="size-4 shrink-0 text-accent-600 dark:text-accent-400" />
              No pending actions — the gate, tests and live traffic look healthy.
            </p>
          )}
        </AgentSectionCard>
      ) : null}
    </div>
  )
}
