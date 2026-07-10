import { ArrowUpCircleIcon } from '@heroicons/react/24/outline'
import { notFound } from 'next/navigation'
import clsx from 'clsx'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { GateHistoryFeed, type GateHistoryEvent } from '@/components/agent-ops/gate-history-feed'
import { PromotionGateCard } from '@/components/agent-ops/promotion-gate-card'
import { PromotionPipelineSteps } from '@/components/agent-ops/promotion-pipeline-steps'
import { PublishActions } from '@/components/agent-ops/publish-actions'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@/components/catalyst/description-list'
import { Divider } from '@/components/catalyst/divider'
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

export default async function PublishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

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
            hint: failingChecks > 0 ? 'Blocking promotion' : pendingChecks > 0 ? 'Awaiting signal' : 'All green',
          },
          {
            name: 'Benchmark score',
            value: candidateVersion ? `${candidateVersion.scores.benchmarkScore} / 100` : '—',
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
          <DescriptionList>
            <DescriptionTerm>Candidate</DescriptionTerm>
            <DescriptionDetails className="font-mono text-xs/6 tabular-nums">{candidateLabel}</DescriptionDetails>

            <DescriptionTerm>Target stage</DescriptionTerm>
            <DescriptionDetails>
              <Badge color={gate.targetStage === 'production' ? 'green' : 'zinc'}>{gate.targetStage}</Badge>
            </DescriptionDetails>

            {candidateVersion ? (
              <>
                <DescriptionTerm>Test pass rate</DescriptionTerm>
                <DescriptionDetails className="font-mono text-xs/6 tabular-nums">
                  {formatPercent(candidateVersion.scores.testPassRate)}
                </DescriptionDetails>

                <DescriptionTerm>Benchmark score</DescriptionTerm>
                <DescriptionDetails className="font-mono text-xs/6 tabular-nums">
                  {candidateVersion.scores.benchmarkScore} / 100
                </DescriptionDetails>

                <DescriptionTerm>Shadow agreement</DescriptionTerm>
                <DescriptionDetails className="font-mono text-xs/6 tabular-nums">
                  {candidateVersion.scores.shadowAgreement !== null
                    ? formatPercent(candidateVersion.scores.shadowAgreement)
                    : 'never shadowed'}
                </DescriptionDetails>

                <DescriptionTerm>Unsafe actions</DescriptionTerm>
                <DescriptionDetails
                  className={clsx(
                    'font-mono text-xs/6 tabular-nums',
                    candidateVersion.scores.unsafeActionCount > 0 && 'text-accent-600 dark:text-accent-400'
                  )}
                >
                  {candidateVersion.scores.unsafeActionCount}
                </DescriptionDetails>
              </>
            ) : null}
          </DescriptionList>

          <Divider soft className="my-4" />

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
        </AgentSectionCard>
        </div>
      </div>
    </div>
  )
}
