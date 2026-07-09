import { ArrowRightIcon, CheckCircleIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'
import { notFound } from 'next/navigation'

import { AgentBentoCard } from '@/components/agent-ops/agent-bento-card'
import { AgentMetricCard } from '@/components/agent-ops/agent-metric-card'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ArchitectureStrip } from '@/components/agent-ops/architecture-strip'
import { RuntimeBadge } from '@/components/agent-ops/runtime-badge'
import { StatusBadge } from '@/components/agent-ops/status-badge'
import { TestResultBadge } from '@/components/agent-ops/test-result-badge'
import { VersionStageBadge, versionStageLabels } from '@/components/agent-ops/version-stage-badge'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import {
  DescriptionDetails,
  DescriptionList,
  DescriptionTerm,
} from '@/components/catalyst/description-list'
import { Subheading } from '@/components/catalyst/heading'
import { Link } from '@/components/catalyst/link'
import { formatDurationMs, formatPercent, formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
import {
  getBenchmarkResultForRun,
  getBenchmarkRunsForSuite,
  getBenchmarkSuitesForCopilot,
  getCopilot,
  getManifestForCopilot,
  getProject,
  getPromotionGateForCopilot,
  getRunsForCopilot,
  getShadowExperimentsForCopilot,
  getTestResultsForRun,
  getTestRunsForCopilot,
  getTestSuitesForCopilot,
  getToolsForCopilot,
  getVersion,
  MODEL_PROVIDER_LABELS,
} from '@/lib/agent-mission-control/mock-data'
import type {
  AgentRunStatus,
  BenchmarkResult,
  BenchmarkRun,
  BenchmarkSuite,
} from '@/lib/agent-mission-control/types'

// ---------------------------------------------------------------------------
// Deterministic formatters (no Date.now, no locale)
// ---------------------------------------------------------------------------

function formatPoints(points: number): string {
  const rounded = Math.round(points * 10) / 10
  const abs = Math.abs(rounded)
  const label = Number.isInteger(abs) ? abs.toFixed(0) : abs.toFixed(1)
  return `${rounded > 0 ? '+' : rounded < 0 ? '-' : '±'}${label} pts`
}

// ---------------------------------------------------------------------------
// Semantic maps (doctrine: color never alone, always a text label)
// ---------------------------------------------------------------------------

const runStatusConfig: Record<AgentRunStatus, { label: string; dot: string; text: string }> = {
  completed: {
    label: 'Completed',
    dot: 'bg-green-500 dark:bg-green-400',
    text: 'text-green-700 dark:text-green-400',
  },
  running: { label: 'Running', dot: 'bg-blue-500 dark:bg-blue-400', text: 'text-blue-600 dark:text-blue-400' },
  'needs-confirmation': {
    label: 'Needs confirmation',
    dot: 'bg-amber-500 dark:bg-amber-400',
    text: 'text-amber-600 dark:text-amber-400',
  },
  blocked: { label: 'Blocked', dot: 'bg-rose-500 dark:bg-rose-400', text: 'text-rose-600 dark:text-rose-400' },
  failed: { label: 'Failed', dot: 'bg-rose-500 dark:bg-rose-400', text: 'text-rose-600 dark:text-rose-400' },
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-green-700 hover:text-green-600 dark:text-green-400 dark:hover:text-green-300"
    >
      {children}
      <ArrowRightIcon aria-hidden="true" className="size-3.5" />
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CopilotOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = getCopilot(id)
  if (!copilot) notFound()

  const base = `/admin/agents/${copilot.id}`
  const project = getProject(copilot.projectId)
  const manifest = getManifestForCopilot(copilot.id)
  const tools = getToolsForCopilot(copilot.id)
  const enabledTools = tools.filter((tool) => tool.enabled)

  const productionVersion = copilot.productionVersionId ? getVersion(copilot.productionVersionId) : undefined
  const latestVersion = getVersion(copilot.latestVersionId)

  // Tests — latest run + result breakdown
  const testSuites = getTestSuitesForCopilot(copilot.id)
  const testRuns = [...getTestRunsForCopilot(copilot.id)].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const latestTestRun = testRuns[0]
  const previousTestRun = testRuns[1]
  const latestTestResults = latestTestRun ? getTestResultsForRun(latestTestRun.id) : []
  const passCount = latestTestResults.filter((r) => r.status === 'pass').length
  const failCount = latestTestResults.filter((r) => r.status === 'fail').length
  const errorCount = latestTestResults.filter((r) => r.status === 'error').length

  const passRateDelta =
    latestTestRun && previousTestRun ? (latestTestRun.passRate - previousTestRun.passRate) * 100 : null
  const passRateTrend: 'up' | 'down' | 'flat' =
    passRateDelta === null || Math.abs(passRateDelta) < 0.5 ? 'flat' : passRateDelta > 0 ? 'up' : 'down'

  // Runs — last 5, newest first
  const runs = [...getRunsForCopilot(copilot.id)].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const lastRuns = runs.slice(0, 5)

  // Benchmarks — best candidate across all suites
  const benchmarkCandidates: { suite: BenchmarkSuite; run: BenchmarkRun; result: BenchmarkResult }[] =
    getBenchmarkSuitesForCopilot(copilot.id).flatMap((suite) =>
      getBenchmarkRunsForSuite(suite.id).flatMap((run) => {
        const result = getBenchmarkResultForRun(run.id)
        return result ? [{ suite, run, result }] : []
      })
    )
  const bestCandidate = benchmarkCandidates.reduce<(typeof benchmarkCandidates)[number] | null>(
    (best, candidate) => (best === null || candidate.result.score > best.result.score ? candidate : best),
    null
  )

  // Shadow + gate → next actions
  const shadowExperiments = getShadowExperimentsForCopilot(copilot.id)
  const runningShadow = shadowExperiments.find((experiment) => experiment.status === 'running')
  const gate = getPromotionGateForCopilot(copilot.id)

  const isSparseDraft = copilot.status === 'draft' && runs.length === 0 && testRuns.length === 0

  // -------------------------------------------------------------------------
  // Next actions — derived from data, capped at 4
  // -------------------------------------------------------------------------

  const nextActions: { key: string; title: string; reason: string; href: string }[] = []

  if (gate && gate.overallStatus !== 'ready') {
    const candidate = getVersion(gate.candidateVersionId)
    const failing = gate.checks.filter((check) => check.status === 'fail').length
    const pending = gate.checks.filter((check) => check.status === 'pending').length
    nextActions.push({
      key: 'gate',
      title: 'Open the promotion gate',
      reason: `${candidate?.label ?? gate.candidateVersionId} → ${versionStageLabels[gate.targetStage]}: ${failing} failing and ${pending} pending of ${gate.checks.length} checks.`,
      href: `${base}/publish`,
    })
  }

  if (runningShadow && runningShadow.agreementRate < runningShadow.agreementThreshold) {
    nextActions.push({
      key: 'shadow',
      title: 'Review shadow mismatches',
      reason: `Agreement at ${formatPercent(runningShadow.agreementRate)}, below the ${formatPercent(runningShadow.agreementThreshold)} threshold, with ${runningShadow.unsafeProposalCount} unsafe proposal${runningShadow.unsafeProposalCount === 1 ? '' : 's'}.`,
      href: `${base}/shadow`,
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
      href: `${base}/tools`,
    })
  }

  if (latestVersion && latestVersion.stage === 'draft' && latestVersion.scores.testPassRate === 0 && !isSparseDraft) {
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

  // -------------------------------------------------------------------------
  // Onboarding checklist for the sparse draft copilot
  // -------------------------------------------------------------------------

  const onboardingSteps: { title: string; detail: string; done: boolean }[] = [
    {
      title: 'Define the manifest',
      detail: 'Scope allowed routes, forbidden actions and the output contract.',
      done: Boolean(manifest),
    },
    {
      title: 'Wire the tools',
      detail: 'Connect the read and write tools the copilot needs, with risk levels.',
      done: enabledTools.length > 0,
    },
    {
      title: 'Write a test suite',
      detail: 'Cover the core behaviors and safety cases before any traffic.',
      done: false,
    },
    {
      title: 'Run a benchmark',
      detail: 'Compare candidate models on representative tasks.',
      done: false,
    },
    {
      title: 'Promote to beta',
      detail: 'Open the promotion gate once every check passes.',
      done: false,
    },
  ]

  return (
    <div className="space-y-8">
      {/* 1 — KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AgentMetricCard
          label="Test pass rate"
          value={testRuns.length > 0 || copilot.health.testPassRate > 0 ? formatPercent(copilot.health.testPassRate) : '—'}
          delta={passRateDelta !== null ? formatPoints(passRateDelta) : undefined}
          trend={passRateTrend}
          hint={
            testRuns.length > 0
              ? `Across ${testSuites.length} suite${testSuites.length === 1 ? '' : 's'}`
              : 'No test runs yet'
          }
        />
        <AgentMetricCard
          label="Benchmark score"
          value={bestCandidate ? String(bestCandidate.result.score) : '—'}
          hint={bestCandidate ? 'Best composite, out of 100' : 'No benchmark runs yet'}
        />
        <AgentMetricCard
          label="Runs (24h)"
          value={String(copilot.health.runsLast24h)}
          hint={
            copilot.health.runsLast24h > 0
              ? `${formatPercent(copilot.health.errorRateLast24h)} error rate`
              : 'No traffic yet'
          }
        />
        <AgentMetricCard
          label="Cost (24h)"
          value={formatUsd(copilot.health.costLast24hUsd)}
          hint={
            copilot.health.runsLast24h > 0
              ? `≈ ${formatUsd(copilot.health.costLast24hUsd / copilot.health.runsLast24h)} per run`
              : 'No spend yet'
          }
        />
      </div>

      {/* 2 — Bento grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Identity — 2 cols */}
        <AgentBentoCard
          eyebrow="Identity"
          title={copilot.name}
          description={copilot.description}
          className="lg:col-span-2"
          level={2}
        >
          <DescriptionList>
            <DescriptionTerm>Owner</DescriptionTerm>
            <DescriptionDetails className="font-mono text-sm">{copilot.owner}</DescriptionDetails>

            <DescriptionTerm>Project</DescriptionTerm>
            <DescriptionDetails>{project ? project.name : 'Unassigned'}</DescriptionDetails>

            <DescriptionTerm>Model</DescriptionTerm>
            <DescriptionDetails className="font-mono text-sm tabular-nums">{copilot.model}</DescriptionDetails>

            <DescriptionTerm>Provider</DescriptionTerm>
            <DescriptionDetails>{MODEL_PROVIDER_LABELS[copilot.modelProvider]}</DescriptionDetails>

            <DescriptionTerm>Created</DescriptionTerm>
            <DescriptionDetails className="tabular-nums">{formatTimestamp(copilot.createdAt)}</DescriptionDetails>

            <DescriptionTerm>Updated</DescriptionTerm>
            <DescriptionDetails className="tabular-nums">{formatTimestamp(copilot.updatedAt)}</DescriptionDetails>

            <DescriptionTerm>Tags</DescriptionTerm>
            <DescriptionDetails>
              <span className="flex flex-wrap gap-2">
                {copilot.tags.map((tag) => (
                  <Badge key={tag} color="zinc" className="font-mono">
                    {tag}
                  </Badge>
                ))}
              </span>
            </DescriptionDetails>
          </DescriptionList>
        </AgentBentoCard>

        {/* Runtime & status — 1 col */}
        <AgentBentoCard title="Runtime & status" level={2}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={copilot.status} />
            <RuntimeBadge runtime={copilot.runtime} />
          </div>
          <dl className="mt-6 space-y-3 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-zinc-500">Production</dt>
              <dd className="flex items-center gap-2 text-right">
                {productionVersion ? (
                  <>
                    <span className="font-mono text-zinc-950 tabular-nums dark:text-white">{productionVersion.label}</span>
                    <VersionStageBadge stage={productionVersion.stage} />
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
                    <VersionStageBadge stage={latestVersion.stage} />
                  </>
                ) : (
                  <span className="text-zinc-500 dark:text-zinc-400">—</span>
                )}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-zinc-500">Error rate (24h)</dt>
              <dd
                className={clsx(
                  'font-mono tabular-nums',
                  copilot.health.errorRateLast24h > 0.05 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-700 dark:text-zinc-300'
                )}
              >
                {formatPercent(copilot.health.errorRateLast24h)}
                {copilot.health.errorRateLast24h > 0.05 ? ' · elevated' : ''}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-zinc-500">Avg latency</dt>
              <dd className="font-mono text-zinc-700 tabular-nums dark:text-zinc-300">
                {copilot.health.avgLatencyMs > 0 ? formatDurationMs(copilot.health.avgLatencyMs) : '—'}
              </dd>
            </div>
          </dl>
        </AgentBentoCard>

        {isSparseDraft ? (
          /* Onboarding empty state — replaces test / benchmark / runs cards */
          <div className="relative isolate overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 lg:col-span-3 dark:bg-zinc-900 dark:ring-white/10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-radial-[at_top] from-green-500/[0.04] dark:from-green-500/[0.06] via-transparent to-transparent"
            />
            <div className="relative mx-auto max-w-2xl px-6 py-12 text-center sm:px-8">
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Draft copilot</p>
              <Subheading level={2} className="mt-2 text-balance">
                Ship your first version
              </Subheading>
              <p className="mt-2 text-sm text-pretty text-zinc-500 dark:text-zinc-400">
                {copilot.name} has a manifest and a skeleton graph, but no test runs, no benchmark and no
                production traffic yet. Work through the checklist to get{' '}
                <span className="font-mono tabular-nums">{latestVersion?.label ?? 'the first version'}</span> ready
                for beta.
              </p>

              <ol className="mx-auto mt-8 max-w-md space-y-3 text-left">
                {onboardingSteps.map((step, index) => (
                  <li
                    key={step.title}
                    className="flex items-start gap-3 rounded-lg bg-zinc-50 px-4 py-3 ring-1 ring-zinc-950/5 dark:bg-zinc-950/50 dark:ring-white/5"
                  >
                    {step.done ? (
                      <CheckCircleIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-green-600 dark:text-green-400" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-950/5 font-mono text-xs text-zinc-500 tabular-nums ring-1 ring-zinc-950/10 dark:bg-white/5 dark:text-zinc-400 dark:ring-white/10"
                      >
                        {index + 1}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-zinc-950 dark:text-white">
                        {step.title}
                        {step.done ? <span className="ml-2 text-xs font-normal text-green-700 dark:text-green-400">Done</span> : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-zinc-500">{step.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <Button color="green" href={`${base}/manifest`}>
                  Review the manifest
                </Button>
                <Button outline href={`${base}/tests`}>
                  Set up tests
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Test score + benchmark — stacked, 1 col */}
            <div className="flex flex-col gap-4">
              <AgentBentoCard title="Tests" className="flex-1" level={2}>
                <p className="text-3xl font-semibold tracking-tight text-zinc-950 tabular-nums dark:text-white">
                  {formatPercent(copilot.health.testPassRate)}
                </p>
                <p className="mt-1 text-xs text-zinc-500">Pass rate across all suites</p>

                {latestTestRun ? (
                  <div className="mt-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-sm text-zinc-950 tabular-nums dark:text-white">{passCount}</span>
                        <TestResultBadge result="pass" />
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-sm text-zinc-950 tabular-nums dark:text-white">{failCount}</span>
                        <TestResultBadge result="fail" />
                      </span>
                      {errorCount > 0 ? (
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-sm text-zinc-950 tabular-nums dark:text-white">{errorCount}</span>
                          <TestResultBadge result="error" />
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-zinc-500 tabular-nums">
                      Latest run · {formatTimestamp(latestTestRun.startedAt)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">No recorded test runs for this copilot.</p>
                )}

                <div className="mt-6">
                  <SectionLink href={`${base}/tests`}>View tests</SectionLink>
                </div>
              </AgentBentoCard>

              <AgentBentoCard title="Benchmarks" className="flex-1" level={2}>
                {bestCandidate ? (
                  <>
                    <div className="flex items-baseline gap-2">
                      <p className="text-3xl font-semibold tracking-tight text-zinc-950 tabular-nums dark:text-white">
                        {bestCandidate.result.score}
                      </p>
                      <p className="text-xs text-zinc-500">/ 100</p>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">Best candidate · {bestCandidate.suite.name}</p>
                    <dl className="mt-4 space-y-2 text-sm">
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="text-zinc-500">Model</dt>
                        <dd className="font-mono text-zinc-700 tabular-nums dark:text-zinc-300">{bestCandidate.run.model}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="text-zinc-500">Task success</dt>
                        <dd className="font-mono text-zinc-700 tabular-nums dark:text-zinc-300">
                          {formatPercent(bestCandidate.result.taskSuccessRate)}
                        </dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">No benchmark runs yet for this copilot.</p>
                )}
                <div className="mt-6">
                  <SectionLink href={`${base}/benchmarks`}>View benchmarks</SectionLink>
                </div>
              </AgentBentoCard>
            </div>

            {/* Last runs — 2 cols */}
            <AgentSectionCard
              title="Last runs"
              description="Most recent production traffic"
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
                          <span
                            aria-hidden="true"
                            className={clsx('mt-1.5 size-1.5 shrink-0 rounded-full', statusConfig.dot)}
                          />
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
                            <span className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                              <span className={clsx('font-medium', statusConfig.text)}>{statusConfig.label}</span>
                              <span className="font-mono text-zinc-500 tabular-nums">
                                {formatDurationMs(run.latencyMs)}
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

      {/* 3 — Architecture strip */}
      <AgentSectionCard title="Architecture" description="Execution path enforced on every run">
        <ArchitectureStrip steps={architectureSteps} />
      </AgentSectionCard>

      {/* 4 — Next actions (the onboarding checklist covers the sparse draft) */}
      {!isSparseDraft ? (
        <AgentSectionCard
          title="Next actions"
          description="Derived from the promotion gate, tests, shadow traffic and live errors"
          contentClassName={visibleActions.length > 0 ? 'divide-y divide-zinc-950/5 dark:divide-white/5' : 'px-6 py-5'}
        >
          {visibleActions.length > 0 ? (
            visibleActions.map((action) => (
              <Link
                key={action.key}
                href={action.href}
                className="group flex items-center justify-between gap-4 px-6 py-4 hover:bg-zinc-950/2.5 dark:hover:bg-white/2.5"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-zinc-950 dark:text-white">{action.title}</span>
                  <span className="mt-1 block max-w-xl truncate text-sm text-zinc-500 dark:text-zinc-400">{action.reason}</span>
                </span>
                <ArrowRightIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-zinc-500 transition-colors duration-150 group-hover:text-zinc-300"
                />
              </Link>
            ))
          ) : (
            <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <CheckCircleIcon aria-hidden="true" className="size-4 shrink-0 text-green-600 dark:text-green-400" />
              No pending actions — the gate, tests and live traffic look healthy.
            </p>
          )}
        </AgentSectionCard>
      ) : null}
    </div>
  )
}
