import { CheckIcon, ClipboardDocumentCheckIcon, ClockIcon, RocketLaunchIcon } from '@heroicons/react/20/solid'
import { ArrowUpCircleIcon } from '@heroicons/react/24/outline'
import { notFound } from 'next/navigation'
import clsx from 'clsx'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { PromotionGateCard } from '@/components/agent-ops/promotion-gate-card'
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
} from '@/lib/agent-mission-control/mock-data'
import type { CopilotVersion, IsoTimestamp } from '@/lib/agent-mission-control/types'

interface HistoryEvent {
  id: string
  title: React.ReactNode
  detail: string
  at: IsoTimestamp
  Icon: typeof CheckIcon
  nodeClassName: string
}

function HistoryFeed({ events }: { events: HistoryEvent[] }) {
  return (
    <ul role="list" className="-mb-8">
      {events.map((event, index) => (
        <li key={event.id} className="relative pb-8">
          {index !== events.length - 1 ? (
            <span aria-hidden="true" className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-zinc-950/10 dark:bg-white/10" />
          ) : null}
          <div className="relative flex gap-3">
            <span
              className={clsx(
                'flex size-8 shrink-0 items-center justify-center rounded-full ring-8 ring-white dark:ring-zinc-900',
                event.nodeClassName
              )}
            >
              <event.Icon aria-hidden="true" className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 justify-between gap-4 pt-1.5">
              <div className="min-w-0">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{event.title}</p>
                <p className="mt-1 text-xs text-zinc-500">{event.detail}</p>
              </div>
              <time dateTime={event.at} className="font-mono text-xs whitespace-nowrap tabular-nums text-zinc-500">
                {formatTimestamp(event.at)}
              </time>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default async function PublishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = getCopilot(id)
  if (!copilot) notFound()

  const gate = getPromotionGateForCopilot(id)

  if (!gate) {
    return (
      <div className="rounded-xl bg-white px-6 py-12 ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
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

  const candidateVersion = getVersion(gate.candidateVersionId)
  const productionVersion = copilot.productionVersionId ? getVersion(copilot.productionVersionId) : undefined
  const candidateLabel = candidateVersion?.label ?? gate.candidateVersionId

  // Rollback target: the previous production version — the newest archived
  // version created before the one currently serving production. Same
  // semantics as the Versions page. No previous production → no rollback.
  const rollbackVersion = productionVersion
    ? getVersionsForCopilot(id)
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

  const historyEvents: HistoryEvent[] = []
  historyEvents.push({
    id: 'evaluated',
    title: 'Gate evaluated',
    detail: `${passedChecks} of ${gate.checks.length} checks passing — status: ${gate.overallStatus}`,
    at: gate.lastEvaluatedAt,
    Icon: ClipboardDocumentCheckIcon,
    nodeClassName: 'bg-zinc-500 text-white dark:bg-zinc-600',
  })
  if (gate.approvedAt && gate.approver) {
    historyEvents.push({
      id: 'approved',
      title: `Approved by ${gate.approver}`,
      detail: 'Human sign-off recorded on the gate.',
      at: gate.approvedAt,
      Icon: CheckIcon,
      nodeClassName: 'bg-green-500 text-white',
    })
  } else if (approvalCheck && approvalCheck.status === 'pending') {
    historyEvents.push({
      id: 'approval-requested',
      title: 'Human approval requested',
      detail: `${approvalCheck.observed} — required: ${approvalCheck.required}.`,
      at: gate.lastEvaluatedAt,
      Icon: ClockIcon,
      nodeClassName: 'bg-amber-500 text-amber-950',
    })
  }
  if (candidateVersion) {
    historyEvents.push({
      id: 'candidate-entered',
      title: (
        <>
          Candidate <span className="font-mono tabular-nums">{candidateVersion.label}</span> entered the gate
        </>
      ),
      detail: `Created by ${candidateVersion.createdBy}.`,
      at: candidateVersion.createdAt,
      Icon: ArrowUpCircleIcon,
      nodeClassName: 'bg-zinc-500 text-white dark:bg-zinc-600',
    })
  }
  if (productionVersion) {
    historyEvents.push({
      id: 'last-promotion',
      title: (
        <>
          <span className="font-mono tabular-nums">{productionVersion.label}</span> promoted to production
        </>
      ),
      detail: 'Currently serving production traffic.',
      at: productionVersion.createdAt,
      Icon: RocketLaunchIcon,
      nodeClassName: 'bg-green-500 text-white',
    })
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <PromotionGateCard gate={gate} candidateVersion={candidateVersion} />

        <AgentSectionCard title="History" description="Recent gate activity for this candidate.">
          <HistoryFeed events={historyEvents} />
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
                    candidateVersion.scores.unsafeActionCount > 0 && 'text-rose-600 dark:text-rose-400'
                  )}
                >
                  {candidateVersion.scores.unsafeActionCount}
                </DescriptionDetails>
              </>
            ) : null}
          </DescriptionList>

          <Divider soft className="my-4" />

          <PublishActions
            overallStatus={gate.overallStatus}
            targetStage={gate.targetStage}
            blockingCheckLabels={blockingCheckLabels}
            rollbackVersionLabel={rollbackVersion?.label ?? null}
          />
        </AgentSectionCard>
      </div>
    </div>
  )
}
