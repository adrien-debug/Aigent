import { ArrowUpCircleIcon } from '@heroicons/react/24/outline'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { GateHistoryFeed, type GateHistoryEvent } from '@/components/agent-ops/gate-history-feed'
import { PromotionGateCard } from '@/components/agent-ops/promotion-gate-card'
import { PromotionPipelineSteps } from '@/components/agent-ops/promotion-pipeline-steps'
import { PublishActions } from '@/components/agent-ops/publish-actions'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { SplitBar } from '@/components/agent-ops/widgets/split-bar'
import { Button } from '@/components/catalyst/button'
import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'
import { formatPercent, formatTimestamp } from '@/lib/agent-mission-control/format'
import {
  getCopilot,
  getPromotionGateForCopilot,
  getVersion,
  getVersionsForCopilot,
} from '@/lib/agent-mission-control/data'
import type { CopilotVersion } from '@/lib/agent-mission-control/types'

function statusLabel(status: string) {
  const text = status.replace(/-/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export async function PublishSection({ copilotId }: { copilotId: string }) {
  const id = copilotId
  const copilot = await getCopilot(id)
  if (!copilot) return null

  const gate = await getPromotionGateForCopilot(id)

  if (!gate) {
    return (
      <div className="rounded-xl bg-white px-6 py-12 ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
        <div className="mx-auto max-w-md text-center">
          <ArrowUpCircleIcon aria-hidden="true" className="mx-auto size-10 text-zinc-400 dark:text-zinc-600" />
          <Subheading className="mt-4">No candidate in the gate</Subheading>
          <Text className="mt-2">
            Nothing is queued for promotion yet. Promote a version from Versions to start a gate evaluation.
          </Text>
          <div className="mt-6">
            <Button outline href={`/admin/agents/${id}/versions`}>
              Go to Versions
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const [candidateVersion, productionVersion, allVersions] = await Promise.all([
    getVersion(gate.candidateVersionId),
    copilot.productionVersionId ? getVersion(copilot.productionVersionId) : undefined,
    getVersionsForCopilot(id),
  ])
  const candidateLabel = candidateVersion?.label ?? gate.candidateVersionId

  // Rollback target: the previous production version — the newest archived
  // version created before the one currently serving production. Same
  // semantics as the Versions page. No previous production → no rollback.
  const rollbackVersion = productionVersion
    ? allVersions
        .filter((version) => version.stage === 'archived' && version.createdAt < productionVersion.createdAt)
        .reduce<CopilotVersion | null>(
          (newest, version) => (newest === null || version.createdAt > newest.createdAt ? version : newest),
          null
        )
    : null

  const blockingCheckLabels = gate.checks
    .filter((check) => check.status === 'fail' || check.status === 'pending')
    .map((check) => check.label)

  const passedChecks = gate.checks.filter((check) => check.status === 'pass').length
  const approvalCheck = gate.checks.find((check) => check.id === 'human-approval')

  const historyEvents: GateHistoryEvent[] = []
  historyEvents.push({
    id: 'evaluated',
    kind: 'evaluated',
    content: `Gate evaluated — ${passedChecks} of ${gate.checks.length} checks passing, status`,
    target: gate.overallStatus,
    date: formatTimestamp(gate.lastEvaluatedAt),
    datetime: gate.lastEvaluatedAt,
  })
  if (gate.approvedAt && gate.approver) {
    historyEvents.push({
      id: 'approved',
      // Recorded sign-off is a success → green treatment ('promoted' kind).
      kind: 'promoted',
      content: 'Human sign-off recorded on the gate — approved by',
      target: gate.approver,
      date: formatTimestamp(gate.approvedAt),
      datetime: gate.approvedAt,
    })
  } else if (approvalCheck && approvalCheck.status === 'pending') {
    historyEvents.push({
      id: 'approval-requested',
      kind: 'approval',
      content: `Human approval requested — ${approvalCheck.observed}, required:`,
      target: approvalCheck.required,
      date: formatTimestamp(gate.lastEvaluatedAt),
      datetime: gate.lastEvaluatedAt,
    })
  }
  if (candidateVersion) {
    historyEvents.push({
      id: 'candidate-entered',
      kind: 'entered',
      content: `Candidate created by ${candidateVersion.createdBy} entered the gate —`,
      target: candidateVersion.label,
      date: formatTimestamp(candidateVersion.createdAt),
      datetime: candidateVersion.createdAt,
    })
  }
  if (productionVersion) {
    historyEvents.push({
      id: 'last-promotion',
      kind: 'promoted',
      content: 'Promoted to production, currently serving traffic —',
      target: productionVersion.label,
      date: formatTimestamp(productionVersion.createdAt),
      datetime: productionVersion.createdAt,
    })
  }

  const failingChecks = gate.checks.filter((check) => check.status === 'fail').length
  const pendingChecks = gate.checks.filter((check) => check.status === 'pending').length
  const gateStatusLabel =
    gate.overallStatus === 'ready' ? 'Ready' : gate.overallStatus === 'blocked' ? 'Blocked' : 'Pending approval'

  return (
    <div className="space-y-8">
      <PromotionPipelineSteps gate={gate} />

      <AgentKpiBand
        stats={[
          {
            name: 'Gate status',
            value: gateStatusLabel,
            changeType: gate.overallStatus === 'blocked' ? 'negative' : 'positive',
            hint: `Candidate ${candidateLabel} → ${gate.targetStage}`,
          },
          {
            name: 'Checks passing',
            value: `${passedChecks} / ${gate.checks.length}`,
            change: failingChecks > 0 ? `${failingChecks} failing` : pendingChecks > 0 ? `${pendingChecks} pending` : undefined,
            changeType: failingChecks > 0 ? 'negative' : undefined,
            viz: (
              <SplitBar
                showLegend={false}
                segments={[
                  { key: 'pass', label: 'Passing', value: passedChecks, tone: 'accent-500' },
                  { key: 'pending', label: 'Pending', value: pendingChecks, tone: 'accent-300' },
                  { key: 'fail', label: 'Failing', value: failingChecks, tone: 'accent-700' },
                ]}
              />
            ),
            hint: failingChecks > 0 ? 'Blocking promotion' : pendingChecks > 0 ? 'Awaiting signal' : 'All green',
          },
          {
            name: 'Benchmark score',
            value: candidateVersion ? `${candidateVersion.scores.benchmarkScore} / 100` : '—',
            viz: candidateVersion ? (
              <LinearMeter
                value={candidateVersion.scores.benchmarkScore}
                max={100}
                ariaLabel="Candidate benchmark score"
              />
            ) : undefined,
            hint: candidateVersion
              ? `${formatPercent(candidateVersion.scores.testPassRate)} test pass`
              : 'No candidate scores',
          },
          {
            name: 'Unsafe actions',
            value: candidateVersion ? String(candidateVersion.scores.unsafeActionCount) : '—',
            changeType:
              candidateVersion && candidateVersion.scores.unsafeActionCount > 0 ? 'negative' : undefined,
            hint:
              candidateVersion && candidateVersion.scores.unsafeActionCount > 0
                ? 'Must be zero to promote'
                : 'Clean candidate',
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PromotionGateCard gate={gate} candidateVersion={candidateVersion} />

          <AgentSectionCard title="History" description="Recent gate activity for this candidate.">
            <GateHistoryFeed events={historyEvents} />
          </AgentSectionCard>
        </div>

        <div>
          <AgentSectionCard title="Decision" description="Promote, request approval, or roll back.">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-300">{candidateLabel}</span>
              <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">
                &rarr;
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{statusLabel(gate.targetStage)}</span>
              {rollbackVersion ? (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Rollback target&nbsp;<span className="font-mono tabular-nums">{rollbackVersion.label}</span>
                </span>
              ) : null}
            </div>

            <div className="mt-6">
              <PublishActions
                copilotId={id}
                candidateVersionId={gate.candidateVersionId}
                productionVersionId={copilot.productionVersionId}
                rollbackVersionId={rollbackVersion?.id ?? null}
                overallStatus={gate.overallStatus}
                targetStage={gate.targetStage}
                blockingCheckLabels={blockingCheckLabels}
                rollbackVersionLabel={rollbackVersion?.label ?? null}
              />
            </div>
          </AgentSectionCard>
        </div>
      </div>
    </div>
  )
}
