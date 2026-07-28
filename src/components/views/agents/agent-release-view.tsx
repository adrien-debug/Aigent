import { TimestampValue } from '@/components/agent-ops/agent-detail/agent-value'
import {
  CapabilityNote,
  ReleaseActions,
  ReleaseGateChecks,
  ReleaseOwnership,
} from '@/components/agent-ops/agent-detail/release-panel'
import { AgentSection as Section } from '@/components/agent-ops/agent-section'
import { GaugeChart } from '@/components/agent-ops/dashboard-charts/gauge-chart'
import {
  PromotionChecksList,
  PromotionOverall,
  ReplayEvidence,
  ShadowEvidence,
} from '@/components/agent-ops/agent-detail/promotion-evidence-panel'
import { QualificationActions } from '@/components/agent-ops/agent-detail/qualification-actions'
import { QualificationTimeline } from '@/components/agent-ops/agent-detail/qualification-timeline'
import { PageLayout } from '@/components/shell/page-layout'
import { eyebrowClass } from '@/components/shell/page-header'
import { Text } from '@/components/ui/text'
import { VERSION_STAGE_LABELS } from '@/lib/agent-mission-control/labels'
import type { AgentReleasePageData } from '@/lib/agent-mission-control/agent-release-page-data'
import type { CopilotVersion } from '@/lib/agent-mission-control/types'

/**
 * Release — may this version ship, and who decides (AIGENT-OPERATOR-RESTORE-028).
 *
 * Restored as its own section because folding it into Observability turned a
 * decision into a dashboard: Observability answers "what did this agent do",
 * Release answers "does production change". The two are read at different
 * moments by people carrying different risk.
 *
 * The view owns NO logic. `getAgentReleasePageData` reads the release gate
 * through `evaluateReleaseGate` — the single source of truth, which the
 * promotion route re-runs server-side before writing — and states which
 * actions may be offered. Recomputing any of it here would create a second
 * gate that eventually disagrees with the one that actually guards the write.
 *
 * `gate.evaluatedAt` is deliberately NOT rendered: `evaluateReleaseGate` stays
 * pure of `Date` (see its closing comment) and stamps the empty string, so
 * printing it would show a timestamp nobody measured.
 */

/**
 * A version identity block. Stage is muted zinc text (doctrine: lifecycle
 * stages are not pills), and the label always sits next to the raw id — an
 * operator about to move production needs the id that is actually written.
 */
function VersionIdentity({ version, absence }: { version: CopilotVersion | undefined; absence: string }) {
  if (version === undefined) {
    return <Text className="text-xs">{absence}</Text>
  }
  return (
    <dl className="flex flex-col gap-3">
      <div>
        <dt className={eyebrowClass}>Version</dt>
        <dd className="mt-1 font-mono text-sm tabular-nums text-white">{version.label}</dd>
      </div>
      <div>
        <dt className={eyebrowClass}>Identifier</dt>
        <dd className="mt-1 font-mono text-xs tabular-nums break-all text-zinc-300">{version.id}</dd>
      </div>
      <div>
        <dt className={eyebrowClass}>Stage</dt>
        <dd className="mt-1 text-sm font-medium text-zinc-400">{VERSION_STAGE_LABELS[version.stage]}</dd>
      </div>
      <div>
        <dt className={eyebrowClass}>Model</dt>
        <dd className="mt-1 font-mono text-xs tabular-nums break-all text-zinc-300">{version.model}</dd>
      </div>
      <div>
        <dt className={eyebrowClass}>Created</dt>
        <dd className="mt-1 text-xs text-zinc-300">
          <TimestampValue value={version.createdAt} />
        </dd>
      </div>
    </dl>
  )
}

export function AgentReleaseView({
  lifecycle,
  promotionGate,
  qualificationReadiness,
  candidateVersionIdForEvidence,
  shadow,
  replay,
}: AgentReleasePageData) {
  const { versions, productionVersion, candidateVersion, gate, capabilities } = lifecycle
  const copilotId = lifecycle.copilotId

  // The rollback target is the version the promotion transition archived most
  // recently. `archived` is the only stage that proves a version actually
  // served production; rolling back to a draft would ship something that never
  // passed a gate. Same rule as `rollbackCapability` — read here only to name
  // the target, never to decide whether the action is allowed.
  const rollbackTarget = versions
    .filter((v) => v.stage === 'archived' && v.id !== productionVersion?.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]

  const blocking = gate ? gate.checks.filter((c) => c.status !== 'pass') : []
  const candidateIsProduction =
    productionVersion !== undefined &&
    candidateVersion !== undefined &&
    productionVersion.id === candidateVersion.id

  return (
    <PageLayout>
      {candidateIsProduction ? (
        <Text className="text-xs text-zinc-400">
          Production and candidate are the same version — nothing new is waiting to ship. The gate below
          documents the version currently serving; promote stays off until a newer draft or beta exists.
        </Text>
      ) : null}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section
          title="In production"
          description="The version consumers are served today."
          meta={
            productionVersion ? (
              <span className="text-xs font-medium text-zinc-400">Serving</span>
            ) : (
              <span className="text-xs font-medium text-zinc-400">Nothing serving</span>
            )
          }
        >
          <VersionIdentity
            version={productionVersion}
            absence="No version is in production. The copilot’s production pointer is unset, so nothing is being served from a released version."
          />
        </Section>

        <Section
          title="Candidate"
          description="The version the release gate is evaluating."
          meta={
            candidateVersion ? (
              <span className="text-xs font-medium text-zinc-400">
                {candidateIsProduction ? 'Already serving' : 'Under evaluation'}
              </span>
            ) : (
              <span className="text-xs font-medium text-zinc-400">No candidate</span>
            )
          }
        >
          <VersionIdentity
            version={candidateVersion}
            absence="No candidate version exists. Nothing can be promoted until a version is created for this agent."
          />
        </Section>
      </div>

      <Section
        title="Qualification workflow"
        description="The candidate’s ordered walk — tests, benchmark, shadow, replay, gate — with the single recommended next action. The workflow never promotes; it makes a version promotable and says so honestly."
        meta={
          <span className="text-xs font-medium text-zinc-400">
            {qualificationReadiness.state === 'not_started'
              ? 'Not started'
              : qualificationReadiness.state === 'promotable'
                ? 'Promotion permitted'
                : qualificationReadiness.state === 'running'
                  ? 'In progress'
                  : qualificationReadiness.state}
          </span>
        }
      >
        {candidateVersionIdForEvidence === null ? (
          <Text className="text-xs">
            There is no candidate version to qualify, so the workflow has nothing to evaluate.
          </Text>
        ) : (
          <>
            <QualificationTimeline readiness={qualificationReadiness} />
            <QualificationActions
              copilotId={copilotId}
              candidateVersionId={candidateVersionIdForEvidence}
              readiness={qualificationReadiness}
            />
          </>
        )}
      </Section>

      <Section
        title="Release gate"
        description="Nine checks evaluated from this candidate’s real test run, benchmark and tool policy. Promotion needs all nine."
      >
        {gate === null ? (
          <div className="max-w-prose">
            <Text className="text-xs">
              The gate has no candidate to evaluate, so no verdict exists — not a failing one, and not a
              passing one. Nothing here is a measurement of this agent’s quality.
            </Text>
            <div className="mt-4">
              <CapabilityNote capability={capabilities.promote} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <GaugeChart
                value={gate.checks.length - blocking.length}
                max={gate.checks.length}
                label={`${gate.checks.length - blocking.length}/${gate.checks.length}`}
                tone={gate.promotable ? 'positive' : 'negative'}
                ariaLabel={`${gate.checks.length - blocking.length} of ${gate.checks.length} release gate checks passing`}
              />
              {/* `missing` and `fail` block identically but mean opposite things,
                  so the count is split rather than totalled. */}
              {blocking.length > 0 ? (
                <Text className="text-xs">
                  {blocking.filter((c) => c.status === 'fail').length} failing ·{' '}
                  {blocking.filter((c) => c.status === 'missing').length} not measured
                </Text>
              ) : (
                <Text className="text-xs">All checks pass on {gate.evidence.candidateLabel}.</Text>
              )}
            </div>
            <ReleaseGateChecks checks={gate.checks} />
          </div>
        )}
      </Section>

      <Section
        title="Promotion evidence"
        description="The extended gate the promotion route re-evaluates: runtime, certified tools, shadow proof and replay comparison, on top of the release gate above."
        meta={
          promotionGate ? (
            <span className="text-xs font-medium text-zinc-400">
              {promotionGate.promotable ? 'All checks pass' : promotionGate.overall}
            </span>
          ) : null
        }
      >
        {candidateVersionIdForEvidence === null ? (
          <Text className="text-xs">
            There is no candidate to evaluate, so there is no promotion evidence either.
          </Text>
        ) : promotionGate === null ? (
          <Text className="text-xs">
            The promotion gate could not be evaluated for this candidate. This is not a failing verdict —
            no verdict exists.
          </Text>
        ) : (
          <div className="flex flex-col gap-6">
            <PromotionOverall overall={promotionGate.overall} promotable={promotionGate.promotable} />
            <PromotionChecksList checks={promotionGate.checks} />
            <div>
              <p className={eyebrowClass}>Shadow experiment</p>
              <div className="mt-2">
                <ShadowEvidence shadow={shadow} />
              </div>
            </div>
            <div>
              <p className={eyebrowClass}>Replay comparison</p>
              <div className="mt-2">
                <ReplayEvidence replay={replay} />
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Promote or roll back"
        description="Both writes change what consumers are served. Neither happens without a click and a confirmation."
      >
        <ReleaseActions
          copilotId={lifecycle.copilotId}
          candidateVersionId={gate?.candidateVersionId ?? candidateVersion?.id ?? null}
          candidateLabel={gate?.evidence.candidateLabel ?? candidateVersion?.label ?? null}
          currentProductionVersionId={productionVersion?.id ?? null}
          productionLabel={productionVersion?.label ?? null}
          rollbackVersionId={rollbackTarget?.id ?? null}
          rollbackVersionLabel={rollbackTarget?.label ?? null}
          promote={capabilities.promote}
          rollback={capabilities.rollback}
        />
      </Section>

      <Section
        title="Who does what"
        description="Which parts of this release are performed by the platform, and which require a person."
      >
        <ReleaseOwnership gateEvaluated={gate !== null} />
      </Section>
    </PageLayout>
  )
}
