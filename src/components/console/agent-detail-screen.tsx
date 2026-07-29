import { ArrowRightIcon } from '@heroicons/react/20/solid'

import { AgentActionsPanel } from '@/components/console/agent-actions'
import { Button } from '@/components/ui/button'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import { formatDuration } from '@/lib/runs-console/runs-metrics'
import type { AgentDetail } from '@/lib/agent-mission-control/agent-detail'
import type { DeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'
import type { AgentRun, CopilotVersion } from '@/lib/agent-mission-control/types'

// Alias paths, not `./charts/…` — see the note in `agents-screen.tsx`.
import { ArcGauge } from '@/components/console/charts/arc-gauge'
import { RingGauge } from '@/components/console/charts/ring-gauge'
import { agentStatusTone, formatUtcTimestamp } from './agents-screen'
import { QualificationPanel } from './qualification-panel'
import { ImprovePanel } from './improve-panel'
import { DeliveryControls } from './delivery-controls'
import {
  EmptyState,
  KpiCard,
  PanelRow,
  ScreenHeader,
  Section,
  TABLE_BODY,
  TABLE_HEAD,
  TABLE_NUM,
  TABLE_ROW,
  TABLE_SHELL,
  Unavailable,
} from './screen-primitives'

/**
 * One agent, in full: the run gate's verdict, the windowed metrics, the persisted
 * identity, the mounted tools, the manifest that governs it and its version
 * history.
 *
 * SERVER COMPONENT — markup over the single `AgentDetail` the route resolved.
 * `getAgentDetail` is the ONE resolver for every section here (AIGENT-AGENT-PAGES-021);
 * nothing on this page re-derives executability, a status or a metric.
 *
 * TRUTH. Every `null` in `AgentMetrics` means NOT MEASURED and renders the word
 * `Indisponible` (`<Unavailable />`). A measured `0` renders `0` — `runs24h = 0`
 * is a real answer (the window was read and held nothing) and must not collapse
 * into "no data". A version whose `scoresEvidence` is `none` carries the stored
 * baseline, not a measurement, so its scores render `Indisponible` rather than a
 * false `0.0%`. No `?? 0` on a measurement lives in this file.
 *
 * The blockers panel is the ONLY place a failure is coloured, and it uses the
 * `--state-danger-*` role — never the accent.
 */

/* ----------------------------------------------------------------- helpers */

/** `Indisponible` sized for the big KPI figure slot (a 12-glyph word does not
 *  survive `text-2xl`). */
const unavailableFigure = <Unavailable className="text-base/7" />

/**
 * A persisted string column, rendered against its OWN absence.
 *
 * `Copilot` and `CopilotVersion` spell these fields `string`, but both objects
 * come out of `camelRows<T>()` — a raw CAST over PostgREST rows whose `model`,
 * `model_provider`, `label` and `stage` columns are nullable (see the row types
 * in `available-agents.ts`). An unset column therefore reaches this file as
 * `null`, where a template literal printed the four letters "null".
 *
 * No size class on purpose: the word inherits the surrounding text, so the one
 * helper serves a 12px fact line and a 12px table cell alike.
 */
function orUnavailable(value: string | null | undefined): React.ReactNode {
  return typeof value === 'string' && value.length > 0 ? value : <Unavailable />
}

/**
 * `provider · model`. The dot is a SEPARATOR between two facts, never a
 * stand-in for a fact nobody recorded — each half answers for itself.
 */
function ModelPair({ provider, model }: { provider: string | null; model: string | null }) {
  return (
    <>
      {orUnavailable(provider)} · {orUnavailable(model)}
    </>
  )
}

/** Run status → dot role. A failure is never painted in the accent. */
function runStatusTone(status: AgentRun['status']): StatusDotTone {
  if (status === 'completed') return 'positive'
  if (status === 'failed' || status === 'blocked') return 'negative'
  if (status === 'running') return 'pending'
  return 'neutral'
}

/** Only a version actually serving production earns the accent. */
function versionStageTone(stage: CopilotVersion['stage']): StatusDotTone {
  return stage === 'production' ? 'positive' : 'neutral'
}

/** Tool risk → dot role. `high`/`critical` mutate by definition (see
 *  `available-agents.ts`), so they carry the danger role rather than a neutral. */
function riskTone(riskLevel: string): StatusDotTone {
  return riskLevel === 'high' || riskLevel === 'critical' ? 'negative' : 'neutral'
}

/**
 * Delivery status → dot role. `agent_delivery_events.status` is free-form text
 * written by several producers (`delivery-loop-server.ts`, the push route) —
 * there is no enum to switch on exhaustively, so only the one value that
 * unambiguously means "this delivery failed" earns the danger role. Everything
 * else (`ready_for_manual_test`, `delivered`, …) stays neutral rather than
 * guessing at a vocabulary this screen does not own.
 */
function deliveryStatusTone(status: string): StatusDotTone {
  return status === 'failed' ? 'negative' : 'neutral'
}

/**
 * The model a run actually PROVED. A run is presumed unverified until a writer
 * proves it (`modelUnverified` defaults to `true`), so an absent proof surfaces
 * as such instead of quietly reading like a verified model.
 */
function runModelLabel(run: AgentRun): React.ReactNode {
  if (typeof run.resolvedModel !== 'string' || run.resolvedModel.length === 0) {
    return <Unavailable />
  }
  return (
    <span className="text-zinc-400">
      {run.resolvedModel}
      {run.modelUnverified === false ? null : <span className="text-zinc-600"> · unverified</span>}
    </span>
  )
}

/** One `label / value` line of a facts panel. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-1.5 last:border-b-0">
      <dt className="min-w-0 shrink-0 truncate text-[11px]/5 text-zinc-500">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[12px]/5 tabular-nums text-white">{value}</dd>
    </div>
  )
}

/**
 * The delivery record laid out as facts: destination repo/branch, what
 * actually shipped (commit or PR — mutually exclusive per `mode`), and the
 * delivery's own outcome status. Every field here is a real persisted column
 * (`agent_delivery_events`, migration 0015) — nothing computed, nothing
 * inferred about whether the delivered code is currently "active" downstream,
 * because this table only records the push, not what the consumer repo did
 * with it afterwards.
 */
function DeliveryFacts({ delivery }: { delivery: DeliveryEvent }) {
  const createdAt = formatUtcTimestamp(delivery.createdAt)
  return (
    <dl>
      <Fact
        label="Status"
        value={<StatusDot tone={deliveryStatusTone(delivery.status)}>{delivery.status}</StatusDot>}
      />
      <Fact label="Mode" value={delivery.mode} />
      <Fact label="Target repo" value={<span className="font-mono text-[11px]">{delivery.targetRepo}</span>} />
      <Fact label="Target branch" value={orUnavailable(delivery.targetBranch)} />
      {delivery.mode === 'pull_request' ? (
        <Fact
          label="Pull request"
          value={
            delivery.prUrl === null ? (
              <Unavailable className="text-[11px]/5" />
            ) : (
              <a href={delivery.prUrl} className="text-accent-400 hover:underline">
                {delivery.prNumber === null ? delivery.prUrl : `#${delivery.prNumber}`}
              </a>
            )
          }
        />
      ) : (
        <Fact
          label="Commit"
          value={
            delivery.commitSha === null ? (
              <Unavailable className="text-[11px]/5" />
            ) : delivery.commitUrl === null ? (
              <span className="font-mono text-[11px]">{delivery.commitSha.slice(0, 12)}</span>
            ) : (
              <a href={delivery.commitUrl} className="font-mono text-[11px] text-accent-400 hover:underline">
                {delivery.commitSha.slice(0, 12)}
              </a>
            )
          }
        />
      )}
      <Fact
        label="Delivered"
        value={createdAt === null ? <Unavailable className="text-[11px]/5" /> : createdAt}
      />
    </dl>
  )
}

/* --------------------------------------------------------------- component */

export function AgentDetailScreen({ detail }: { detail: AgentDetail }) {
  const { copilot, agent, manifest, currentVersion, metrics, blockers } = detail

  // The PROMOTABLE candidate: the latest persisted version, when it differs
  // from the one already serving production. Equal ids (or no latest at all)
  // means there is nothing new to promote — the controls disable themselves
  // rather than offer to "promote" the version already live.
  //
  // Deliberately NOT the same thing as `candidateVersion` below: promotion
  // asks "is there something newer than production?", qualification asks "is
  // there a draft/beta to run evidence against?". A version can satisfy one
  // and not the other, so collapsing them into one variable would let the
  // promotion controls target a version qualification never examined.
  const promotionCandidate =
    copilot.latestVersionId !== copilot.productionVersionId
      ? detail.versions.find((v) => v.id === copilot.latestVersionId)
      : undefined

  // A ratio arrives as 0..1 and the gauges plot 0..100. Narrowed once here so
  // neither half is coalesced apart — `null` stays `null` all the way down.
  const successPercent = metrics.successRate === null ? null : metrics.successRate * 100
  const avgDuration = formatDuration(metrics.avgDurationMs)

  // `readOnly` is non-nullable in the contract, so `false` is ambiguous on its
  // own: the field is ALSO named in `unavailableFields` when the nature of the
  // mounted tools could not be established. That case is UNKNOWN, not "mutating".
  const readOnlyKnown = agent !== undefined && !agent.unavailableFields.includes('readOnly')

  // Qualification/Shadow/Replay all target a DRAFT/BETA candidate — never the
  // production version itself (release-gate.ts's own `is-draft` check would
  // refuse it anyway). `copilot.latestVersionId` can legitimately point at a
  // version that has already been promoted to production, so the actual
  // target is resolved from the loaded version list: prefer the copilot's own
  // `latestVersionId` row when it is still draft/beta, otherwise the most
  // recently created draft/beta version. `undefined` when none exists — the
  // panel then disables its actions with a stated reason instead of guessing.
  const candidateVersion =
    (copilot.latestVersionId
      ? detail.versions.find((v) => v.id === copilot.latestVersionId && (v.stage === 'draft' || v.stage === 'beta'))
      : undefined) ?? detail.versions.find((v) => v.stage === 'draft' || v.stage === 'beta')

  return (
    <div className="space-y-4">
      <ScreenHeader
        title={copilot.name}
        description={copilot.description}
        actions={
          <>
            <StatusDot tone={detail.executable ? 'positive' : 'negative'} className="max-w-40">
              {detail.executable ? 'Executable now' : 'Execution blocked'}
            </StatusDot>
            {/* `agent.projectId`, NOT the raw `copilot.projectId` column: the
                catalogue validates the id against the live `projects` table
                (`projectExists` in available-agents.ts) before trusting it. A
                copilot whose project was deleted still carries a non-null
                `project_id` column, and the raw guard rendered a button whose
                destination 404s. `agent` is undefined only when the copilot is
                absent from the catalogue read entirely — no project link then. */}
            {agent?.projectId == null ? null : (
              <Button href={`/admin/projects/${agent.projectId}/builder`} outline>
                Project builder <ArrowRightIcon />
              </Button>
            )}
            <Button href="/admin/agents" outline>
              Back to agents
            </Button>
          </>
        }
      />

      {/* ── ROW 0.5 · actions ─────────────────────────────────────────────
          `AgentActionsPanel` is a client island: the three write actions
          (run / test / benchmark) this copilot exposes. `detail.executable`
          and `blockers` are the SAME verdict the run route itself enforces
          (`getAgentDetail` → `computeBlockers`/`isExecutable`) — this panel
          never recomputes it, it only reads it. Suite ids are the first row
          of each suite list (`null` renders as "no suite yet" rather than a
          dead button). */}
      <Section title="Actions" description="Launch a real run against the live model — every call here is billed">
        <div className="px-4 py-3">
          <AgentActionsPanel
            copilotId={copilot.id}
            executable={detail.executable}
            blockers={blockers.map((b) => ({ code: b.code, label: b.label }))}
            testSuiteId={detail.testSuites[0]?.id ?? null}
            benchmarkSuiteId={detail.benchmarkSuites[0]?.id ?? null}
          />
        </div>
      </Section>

      {/* ── ROW 1 · KPI band ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Runs · 24h" value={metrics.runs24h} detail={`${metrics.totalRuns} loaded`} />

        <KpiCard
          label="Success"
          value={metrics.successRate === null ? unavailableFigure : formatPercent(metrics.successRate)}
          detail="Terminal runs only"
          aside={
            <ArcGauge
              value={successPercent}
              max={100}
              // 56, not the 72 default: this is a five-across band (like
              // runs-screen and projects-screen), and at 1280px a 72px gauge
              // squeezes the text column under the ~85px `Indisponible` rung
              // until it truncates. Measured, not guessed — same reasoning as
              // runs-screen.tsx:174-176 and projects-screen.tsx:201-203.
              size={56}
              ariaLabel={
                successPercent === null
                  ? 'Success rate: no terminal run, nothing measured.'
                  : `Success rate: ${Math.round(successPercent)} out of 100.`
              }
            />
          }
        />

        <KpiCard
          label="Tool calls"
          value={metrics.toolCallCount === null ? unavailableFigure : metrics.toolCallCount}
          detail={`Over ${metrics.completedRuns} completed run${metrics.completedRuns === 1 ? '' : 's'}`}
        />

        <KpiCard
          label="Avg duration"
          value={avgDuration === null ? unavailableFigure : avgDuration}
          detail="Across every loaded run"
        />

        <KpiCard
          label="Cost · 24h"
          value={metrics.cost24hUsd === null ? unavailableFigure : formatUsd(metrics.cost24hUsd, 4)}
          detail={`${metrics.runsWithoutCost} uncosted in the window`}
        />
      </div>

      {/* ── ROW 2 · execution gate · recent runs · success ring ───────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.8fr)_minmax(0,0.9fr)]">
        <Section
          title="Execution gate"
          description="The same blockers the run endpoint enforces"
          actions={
            blockers.length > 0 ? (
              <span className="shrink-0 text-[11px]/4 tabular-nums text-[var(--state-danger-text)]">
                {blockers.length}
              </span>
            ) : undefined
          }
          scroll="md"
          className={
            blockers.length > 0
              ? 'border-[var(--state-danger-solid-line)] md:col-start-1 md:row-start-1 xl:col-start-1 xl:row-start-1'
              : 'md:col-start-1 md:row-start-1 xl:col-start-1 xl:row-start-1'
          }
        >
          {blockers.length === 0 ? (
            <div className="px-4 py-6">
              <StatusDot tone="positive">All runtime requirements are satisfied</StatusDot>
            </div>
          ) : (
            blockers.map((blocker) => (
              <div key={blocker.code} className="border-b border-line px-4 py-2.5 last:border-b-0">
                <p className="text-[13px]/5 font-medium text-[var(--state-danger-text)]">{blocker.label}</p>
                <p className="mt-0.5 text-[11px]/4 text-zinc-400">{blocker.detail}</p>
              </div>
            ))
          )}
        </Section>

        <Section
          title="Recent runs"
          description={`The ${detail.runs.length} most recent runs loaded for this agent`}
          scroll="lg"
          className="md:col-span-2 md:row-start-2 xl:col-span-1 xl:col-start-2 xl:row-start-1"
        >
          {detail.runs.length === 0 ? (
            <EmptyState
              title="No run is recorded for this agent."
              description="The catalogue reads live rows only."
            />
          ) : (
            /* The console's one table language (`screen-primitives`): no
               `dense`, and `TABLE_ROW` on every row — a run row leads nowhere,
               so it must not light up under the cursor. */
            <Table caption="Recent runs for this agent" className={TABLE_SHELL}>
              <TableHead className={TABLE_HEAD}>
                <TableRow className={TABLE_ROW}>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Started</TableHeader>
                  <TableHeader className={TABLE_NUM}>Latency</TableHeader>
                  <TableHeader className={TABLE_NUM}>Tools</TableHeader>
                  <TableHeader className={TABLE_NUM}>Cost</TableHeader>
                  <TableHeader>Model</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody className={TABLE_BODY}>
                {detail.runs.map((run) => {
                  const startedAt = formatUtcTimestamp(run.startedAt)
                  const latency = formatDuration(run.latencyMs)
                  return (
                    <TableRow key={run.id} className={TABLE_ROW}>
                      <TableCell>
                        <StatusDot tone={runStatusTone(run.status)}>{run.status}</StatusDot>
                      </TableCell>
                      <TableCell className="tabular-nums text-zinc-400">
                        {startedAt === null ? <Unavailable /> : startedAt}
                      </TableCell>
                      <TableCell className={`${TABLE_NUM} text-zinc-300`}>
                        {latency === null ? <Unavailable /> : latency}
                      </TableCell>
                      <TableCell className={`${TABLE_NUM} text-zinc-300`}>{run.toolCallCount}</TableCell>
                      <TableCell className={`${TABLE_NUM} text-white`}>
                        {run.costUsd === null ? <Unavailable /> : formatUsd(run.costUsd, 4)}
                      </TableCell>
                      <TableCell>{runModelLabel(run)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </Section>

        <Section
          title="Success rate"
          description="Completed over completed plus failed"
          className="md:col-start-2 md:row-start-1 xl:col-start-3 xl:row-start-1"
        >
          <div className="flex justify-center px-4 pt-4 pb-3">
            <RingGauge
              value={successPercent}
              max={100}
              label="Success rate over the loaded runs"
              caption="percent"
              size={168}
            />
          </div>
          <dl className="border-t border-line">
            <Fact label="Runs loaded" value={metrics.totalRuns} />
            <Fact label="Completed" value={metrics.completedRuns} />
            <Fact
              label="Tool calls"
              value={
                metrics.toolCallCountState === 'MEASURED' && metrics.toolCallCount !== null ? (
                  metrics.toolCallCount
                ) : (
                  <Unavailable className="text-[11px]/5" />
                )
              }
            />
            <Fact
              label="Last run"
              value={
                formatUtcTimestamp(metrics.lastRun?.startedAt ?? null) ?? (
                  <Unavailable className="text-[11px]/5" />
                )
              }
            />
          </dl>
        </Section>
      </div>

      {/* ── ROW 3 · identity · tools · manifest ───────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Section title="Agent identity" description="Persisted configuration and what a run has proved">
          <dl>
            <Fact label="Copilot id" value={<span className="font-mono text-[11px]">{copilot.id}</span>} />
            <Fact
              label="Project"
              value={
                copilot.projectId === null ? (
                  <Unavailable className="text-[11px]/5" />
                ) : (
                  <span className="font-mono text-[11px]">{copilot.projectId}</span>
                )
              }
            />
            {/* Same raw-cast columns as `model` (see `orUnavailable`): unset,
                they used to render as a blank line that reads like a value of
                nothing rather than as an unrecorded field. */}
            <Fact label="Owner" value={orUnavailable(copilot.owner)} />
            <Fact label="Runtime" value={orUnavailable(copilot.runtime)} />
            <Fact label="Lifecycle status" value={agent?.lifecycleStatus ?? copilot.status} />
            <Fact
              label="Runtime status"
              value={
                agent === undefined ? (
                  <Unavailable className="text-[11px]/5" />
                ) : (
                  <StatusDot tone={agentStatusTone(agent.status, agent.lifecycleStatus)}>
                    {agent.status}
                  </StatusDot>
                )
              }
            />
            <Fact
              label="Declared model"
              value={<ModelPair provider={copilot.modelProvider} model={copilot.model} />}
            />
            <Fact
              label="Executed model"
              value={
                agent === undefined || agent.executedModel === null ? (
                  <Unavailable className="text-[11px]/5" />
                ) : (
                  agent.executedModel
                )
              }
            />
            <Fact
              label="Version"
              value={
                currentVersion === undefined ? (
                  <Unavailable className="text-[11px]/5" />
                ) : (
                  <>
                    {orUnavailable(currentVersion.label)} · {orUnavailable(currentVersion.stage)}
                  </>
                )
              }
            />
            <Fact
              label="Tool nature"
              value={
                readOnlyKnown && agent !== undefined ? (
                  agent.readOnly ? (
                    'Read-only'
                  ) : (
                    'Can mutate'
                  )
                ) : (
                  <Unavailable className="text-[11px]/5" />
                )
              }
            />
            <Fact
              label="Human approval"
              value={
                agent === undefined ? (
                  <Unavailable className="text-[11px]/5" />
                ) : agent.requiresHumanApproval ? (
                  'Required'
                ) : (
                  'Not required'
                )
              }
            />
          </dl>
        </Section>

        <Section
          title="Mounted tools"
          description="Persisted tool definitions for the current agent"
          actions={
            <span className="shrink-0 text-[11px]/4 tabular-nums text-zinc-500">{detail.tools.length}</span>
          }
          scroll="lg"
        >
          {detail.tools.length === 0 ? (
            <EmptyState
              title="No mounted tool is available."
              description="A declared tool with no registered row cannot be mounted."
            />
          ) : (
            detail.tools.map((tool) => (
              <PanelRow
                key={tool.id}
                title={<span className="font-mono">{tool.name}</span>}
                subtitle={
                  <span className="flex flex-wrap items-center gap-x-2">
                    <StatusDot tone={riskTone(tool.riskLevel)}>{tool.riskLevel} risk</StatusDot>
                    <span>{tool.provider}</span>
                    {tool.requiresConfirmation ? <span>· confirmation required</span> : null}
                  </span>
                }
                // No `values` prop here. `tool.callsLast7d` is
                // `tools.calls_last_7d int not null default 0` — no run path,
                // telemetry ingest or aggregation ever writes it, so every row
                // reads 0 regardless of real usage while the KPI band above
                // reports real tool-call counts from `agent_runs`. Rendering a
                // schema default as a measurement is worse than showing
                // nothing; remove it rather than hide it behind a flag until a
                // real writer exists.
                trailing={
                  <StatusDot tone={tool.enabled ? 'positive' : 'neutral'} className="max-w-24">
                    {tool.enabled ? 'enabled' : 'disabled'}
                  </StatusDot>
                }
              />
            ))
          )}
        </Section>

        <Section
          title="Manifest & policy"
          description="The contract the runtime gate enforces"
          // This is the third child of a 3-up row that is only 2-up at `md`:
          // with no placement it orphaned itself under "Mounted tools" and left
          // an empty half-column of bare page ground between 768px and 1279px.
          // Full-width at `md`, back to one-third at `xl` where all three fit.
          className="md:col-span-2 xl:col-span-1"
          scroll="lg"
        >
          {manifest === undefined ? (
            <EmptyState
              title="No manifest is persisted for this agent."
              description="Without one the runtime cannot resolve tools, limits or an approval policy."
            />
          ) : (
            <>
              <dl>
                <Fact label="Manifest version" value={manifest.version} />
                <Fact label="Confirmation policy" value={manifest.confirmationPolicy} />
                <Fact label="Max steps per run" value={manifest.maxStepsPerRun} />
                {/* The ONLY `formatUsd` in the console handed a value it did
                    not narrow first — deliberately, and it is not a measurement.
                    This is the manifest's CONFIGURED CEILING, and
                    `manifests.max_cost_per_run_usd` is `numeric not null
                    default 1` (migration 0001, never altered since), so unlike
                    the nullable columns `orUnavailable` exists for, this one
                    cannot arrive absent through `camelRows`. If it somehow did,
                    `formatUsd` now says `Indisponible` — the honest reading,
                    since "no ceiling is configured" is not a state this schema
                    can produce; only an unreadable row is.
                    KNOWN, SEPARATE DEFECT (not an absence-vocabulary one, so
                    not fixed here): the constraint DOES allow a stored `0`, and
                    `runner.ts` treats a `<= 0` ceiling as UNBOUNDED. Such a row
                    would render "$0.0000" here while the runtime enforces no
                    budget at all — a policy display bug that belongs to whoever
                    owns the ceiling contract, not to the formatter. */}
                <Fact label="Max cost per run" value={formatUsd(manifest.maxCostPerRunUsd, 4)} />
                <Fact label="Declared tools" value={manifest.toolIds.length} />
                <Fact label="Allowed routes" value={manifest.allowedRoutes.length} />
                <Fact
                  label="Updated"
                  value={
                    formatUtcTimestamp(manifest.updatedAt) ?? <Unavailable className="text-[11px]/5" />
                  }
                />
              </dl>
              {manifest.skills.length > 0 ? (
                <div className="border-t border-line px-4 py-2.5">
                  <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-zinc-500">
                    Skills
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {manifest.skills.map((skill) => (
                      <li key={skill.label} className="text-[12px]/5 text-zinc-300">
                        {skill.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {manifest.forbiddenActions.length > 0 ? (
                <div className="border-t border-line px-4 py-2.5">
                  <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-zinc-500">
                    Forbidden actions
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {manifest.forbiddenActions.map((action) => (
                      <li key={action} className="text-[12px]/5 text-[var(--state-danger-text)]">
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </Section>
      </div>

      {/* ── ROW 3.5 · delivery ────────────────────────────────────────────
          `detail.delivery` is the LATEST `agent_delivery_events` row for this
          copilot (`getLatestDeliveryEvent`, one resolver, same fail-hard
          contract as every other field on this page — a read failure never
          reaches this component, it fails the whole route instead). `null`
          here is a MEASURED fact: the table was read and this agent has never
          been delivered — not "unknown", so it renders `EmptyState`, not
          `Unavailable`. */}
      <Section
        title="Delivery"
        description="The most recent push of this agent to a consumer repository"
      >
        <dl>
          <Fact
            label="Production version"
            value={
              currentVersion !== undefined && currentVersion.id === copilot.productionVersionId ? (
                <>
                  {orUnavailable(currentVersion.label)} · {currentVersion.id}
                </>
              ) : copilot.productionVersionId === null ? (
                <Unavailable className="text-[11px]/5" />
              ) : (
                <span className="font-mono text-[11px]">{copilot.productionVersionId}</span>
              )
            }
          />
          <Fact
            label="Project"
            value={
              detail.project === undefined ? (
                <Unavailable className="text-[11px]/5" />
              ) : (
                detail.project.name
              )
            }
          />
          <Fact
            label="Target repo"
            value={
              detail.project?.repoFullName ? (
                <span className="font-mono text-[11px]">{detail.project.repoFullName}</span>
              ) : (
                <Unavailable className="text-[11px]/5" />
              )
            }
          />
        </dl>
        {detail.delivery === null ? (
          <EmptyState
            title="This agent has never been delivered."
            description="No row exists in the delivery log for this copilot."
          />
        ) : (
          <DeliveryFacts delivery={detail.delivery} />
        )}
        <DeliveryControls
          copilot={copilot}
          projectId={agent?.projectId ?? null}
          repoFullName={detail.project?.repoFullName}
          blockers={blockers}
          candidateVersion={promotionCandidate}
        />
      </Section>

      {/* ── ROW 3.6 · qualification / shadow / replay ─────────────────────── */}
      <QualificationPanel
        copilotId={copilot.id}
        candidateVersionId={candidateVersion?.id ?? null}
        candidateVersionLabel={candidateVersion?.label ?? null}
        candidateVersionStage={candidateVersion?.stage ?? null}
      />

      {/* ── ROW 3.7 · improve ─────────────────────────────────────────────── */}
      <ImprovePanel
        copilotId={copilot.id}
        baseVersionLabel={
          currentVersion === undefined
            ? 'the current version'
            : typeof currentVersion.label === 'string' && currentVersion.label.length > 0
              ? currentVersion.label
              : currentVersion.id
        }
        initialProposal={detail.improveProposal}
        initialComparison={detail.improveComparison}
      />

      {/* ── ROW 4 · version history ───────────────────────────────────────── */}
      <Section
        title="Version history"
        description="Scores are shown only when a real run produced them"
        actions={
          <span className="shrink-0 text-[11px]/4 tabular-nums text-zinc-500">
            {detail.versions.length}
          </span>
        }
        scroll="lg"
      >
        {detail.versions.length === 0 ? (
          <EmptyState title="No version is persisted for this agent." />
        ) : (
          /* Same table language as the two panels above, and the panel's own
             `scroll="lg"` rung as the single bound — the table is this panel's
             only child, so a second nested scroller would just clip it twice. */
          <Table caption="Version history" className={TABLE_SHELL}>
            <TableHead className={TABLE_HEAD}>
              <TableRow className={TABLE_ROW}>
                <TableHeader>Stage</TableHeader>
                <TableHeader>Version</TableHeader>
                <TableHeader>Model</TableHeader>
                <TableHeader className={TABLE_NUM}>Tests</TableHeader>
                <TableHeader className={TABLE_NUM}>Benchmark</TableHeader>
                <TableHeader className={TABLE_NUM}>Shadow</TableHeader>
                <TableHeader className={TABLE_NUM}>Unsafe</TableHeader>
                <TableHeader>Created</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody className={TABLE_BODY}>
              {detail.versions.map((version) => {
                // `scoresEvidence: 'none'` means the numbers sitting in `scores`
                // are the stored zero baseline, NOT a measurement. Rendering them
                // would state "0.0% of tests pass" about a version nobody ran.
                const measured = version.scoresEvidence === 'runs'
                // EVIDENCE **AND** THE FIELD ITSELF. `measured` alone was not
                // enough: it is set as soon as ANY of the three run-backed
                // figures resolved, so a version with a test run and no
                // benchmark passed the gate with `benchmarkScore` still absent
                // — React rendered `undefined` as an empty cell, and the Tests
                // column of a benchmark-only version rendered "NaN%". Each cell
                // now answers for its own measurement.
                const testPassRate = measured ? version.scores.testPassRate : null
                const benchmarkScore = measured ? version.scores.benchmarkScore : null
                const createdAt = formatUtcTimestamp(version.createdAt)
                return (
                  <TableRow key={version.id} className={TABLE_ROW}>
                    <TableCell>
                      <StatusDot tone={versionStageTone(version.stage)}>{version.stage}</StatusDot>
                    </TableCell>
                    <TableCell className="font-mono text-white">{orUnavailable(version.label)}</TableCell>
                    <TableCell className="text-zinc-400">
                      <ModelPair provider={version.modelProvider} model={version.model} />
                    </TableCell>
                    <TableCell className={`${TABLE_NUM} text-zinc-300`}>
                      {testPassRate === null ? <Unavailable /> : formatPercent(testPassRate)}
                    </TableCell>
                    <TableCell className={`${TABLE_NUM} text-zinc-300`}>
                      {benchmarkScore === null ? <Unavailable /> : benchmarkScore}
                    </TableCell>
                    <TableCell className={`${TABLE_NUM} text-zinc-300`}>
                      {version.scores.shadowAgreement === null ? (
                        <Unavailable />
                      ) : (
                        formatPercent(version.scores.shadowAgreement)
                      )}
                    </TableCell>
                    <TableCell className={TABLE_NUM}>
                      {version.scores.unsafeActionCount === null ? (
                        <Unavailable />
                      ) : version.scores.unsafeActionCount > 0 ? (
                        <span className="text-[var(--state-danger-text)]">
                          {version.scores.unsafeActionCount}
                        </span>
                      ) : (
                        <span className="text-zinc-300">{version.scores.unsafeActionCount}</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums text-zinc-400">
                      {createdAt === null ? <Unavailable /> : createdAt}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  )
}
