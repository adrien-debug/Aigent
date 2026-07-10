import { ArrowRightIcon, CheckCircleIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'
import { notFound } from 'next/navigation'

import { AgentBentoCard } from '@/components/agent-ops/agent-bento-card'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ArchitectureStrip } from '@/components/agent-ops/architecture-strip'
import { OnboardingSteps } from '@/components/agent-ops/onboarding-steps'
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
} from '@/lib/agent-mission-control/data'
import type {
  AgentRunStatus,
  BenchmarkResult,
  BenchmarkRun,
  BenchmarkSuite,
  Project,
} from '@/lib/agent-mission-control/types'

// ---------------------------------------------------------------------------
// Semantic maps (doctrine: color never alone, always a text label)
// ---------------------------------------------------------------------------

const runStatusConfig: Record<AgentRunStatus, { label: string; dot: string; text: string }> = {
  completed: {
    label: 'Completed',
    dot: 'bg-accent-500 dark:bg-accent-400',
    text: 'text-accent-700 dark:text-accent-400',
  },
  running: { label: 'Running', dot: 'bg-accent-500 dark:bg-accent-400', text: 'text-accent-600 dark:text-accent-400' },
  'needs-confirmation': {
    label: 'Needs confirmation',
    dot: 'bg-accent-500 dark:bg-accent-400',
    text: 'text-accent-600 dark:text-accent-400',
  },
  blocked: { label: 'Blocked', dot: 'bg-accent-500 dark:bg-accent-400', text: 'text-accent-600 dark:text-accent-400' },
  failed: { label: 'Failed', dot: 'bg-accent-500 dark:bg-accent-400', text: 'text-accent-600 dark:text-accent-400' },
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

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

  // Runs — last 5, newest first
  const runs = [...allRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const lastRuns = runs.slice(0, 5)

  // Benchmarks — best candidate across all suites
  const benchmarkCandidates: { suite: BenchmarkSuite; run: BenchmarkRun; result: BenchmarkResult }[] = (
    await Promise.all(
      benchmarkSuites.map(async (suite) => {
        const suiteRuns = await getBenchmarkRunsForSuite(suite.id)
        const candidates = await Promise.all(
          suiteRuns.map(async (run) => ({ suite, run, result: await getBenchmarkResultForRun(run.id) }))
        )
        return candidates.filter(
          (candidate): candidate is { suite: BenchmarkSuite; run: BenchmarkRun; result: BenchmarkResult } =>
            candidate.result !== undefined
        )
      })
    )
  ).flat()
  const bestCandidate = benchmarkCandidates.reduce<(typeof benchmarkCandidates)[number] | null>(
    (best, candidate) => (best === null || candidate.result.score > best.result.score ? candidate : best),
    null
  )

  // Shadow + gate → next actions
  const runningShadow = shadowExperiments.find((experiment) => experiment.status === 'running')

  const isSparseDraft = copilot.status === 'draft' && runs.length === 0 && testRuns.length === 0

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

  return (
    <div className="space-y-8">
      {/* 2 — Bento grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Identity — 2 cols. No duplicated title/description: the page header already carries them. */}
        <AgentBentoCard title="Identity" className="lg:col-span-2" level={2}>
          <DescriptionList>
            <DescriptionTerm>Owner</DescriptionTerm>
            <DescriptionDetails className="font-mono text-sm">{copilot.owner}</DescriptionDetails>

            <DescriptionTerm>Project</DescriptionTerm>
            <DescriptionDetails>
              {onBench ? (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
                (project?.name ?? '—')
              )}
            </DescriptionDetails>

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
                  copilot.health.errorRateLast24h > 0.05 ? 'text-accent-600 dark:text-accent-400' : 'text-zinc-700 dark:text-zinc-300'
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
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-zinc-500">Runs (24h)</dt>
              <dd className="font-mono text-zinc-700 tabular-nums dark:text-zinc-300">
                {copilot.health.runsLast24h > 0 ? copilot.health.runsLast24h : '—'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-zinc-500">Cost (24h)</dt>
              <dd className="font-mono text-zinc-700 tabular-nums dark:text-zinc-300">
                {copilot.health.runsLast24h > 0 ? formatUsd(copilot.health.costLast24hUsd) : '—'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-zinc-500">Open warnings</dt>
              <dd
                className={clsx(
                  'font-mono tabular-nums',
                  copilot.health.openWarnings > 0 ? 'text-accent-600 dark:text-accent-400' : 'text-zinc-700 dark:text-zinc-300'
                )}
              >
                {copilot.health.openWarnings}
                {copilot.health.openWarnings > 0 ? ' · needs review' : ''}
              </dd>
            </div>
          </dl>
        </AgentBentoCard>

        {isSparseDraft ? (
          /* Onboarding empty state — replaces test / benchmark / runs cards */
          <div className="relative isolate overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 lg:col-span-3 dark:bg-zinc-950 dark:ring-white/10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-radial-[at_top] from-accent-500/[0.04] dark:from-accent-500/[0.06] via-transparent to-transparent"
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

              {/* Vertical stepper — each step links to its real tab route. */}
              <div className="mx-auto mt-8 max-w-md text-left">
                <OnboardingSteps
                  copilotId={copilot.id}
                  hasManifest={Boolean(manifest)}
                  toolCount={enabledTools.length}
                  testSuiteCount={testSuites.length}
                  hasProductionVersion={Boolean(productionVersion)}
                />
              </div>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <Button color="accent" href={`${base}/manifest`}>
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
                  <SectionLink href={`${base}/tests#benchmarks`}>View benchmarks</SectionLink>
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

      {/* 3 — Architecture strip (no box: flows directly on the body surface) */}
      <section>
        <Subheading>Architecture</Subheading>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Execution path enforced on every run</p>
        <div className="mt-5">
          <ArchitectureStrip steps={architectureSteps} />
        </div>
      </section>

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
              <CheckCircleIcon aria-hidden="true" className="size-4 shrink-0 text-accent-600 dark:text-accent-400" />
              No pending actions — the gate, tests and live traffic look healthy.
            </p>
          )}
        </AgentSectionCard>
      ) : null}
    </div>
  )
}
