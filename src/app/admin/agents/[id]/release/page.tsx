import { notFound } from 'next/navigation'

import { TimestampValue } from '@/components/agent-ops/agent-detail/agent-value'
import {
  CapabilityNote,
  ReleaseActions,
  ReleaseGateChecks,
  ReleaseOwnership,
} from '@/components/agent-ops/agent-detail/release-panel'
import { AgentSection as Section } from '@/components/agent-ops/agent-section'
import {
  ProofActions,
  PromotionChecksList,
  PromotionOverall,
  ReplayEvidence,
  ShadowEvidence,
} from '@/components/agent-ops/agent-detail/promotion-evidence-panel'
import { eyebrowClass } from '@/components/agent-ops/surface-card'
import { Text } from '@/components/catalyst/text'
import { getAgentLifecycle } from '@/lib/agent-mission-control/agent-lifecycle'
import { VERSION_STAGE_LABELS } from '@/lib/agent-mission-control/labels'
import { pgrest } from '@/lib/agent-mission-control/postgrest'
import { evaluatePromotionGate } from '@/lib/agent-mission-control/promotion-gate'
import type { CopilotVersion } from '@/lib/agent-mission-control/types'

/**
 * Release — may this version ship, and who decides (AIGENT-OPERATOR-RESTORE-028).
 *
 * Restored as its own section because folding it into Observability turned a
 * decision into a dashboard: Observability answers "what did this agent do",
 * Release answers "does production change". The two are read at different
 * moments by people carrying different risk.
 *
 * The page owns NO logic. `getAgentLifecycle` reads the release gate through
 * `evaluateReleaseGate` — the single source of truth, which the promotion route
 * re-runs server-side before writing — and states which actions may be offered.
 * Recomputing any of it here would create a second gate that eventually
 * disagrees with the one that actually guards the write.
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
    return <Text className="!mt-0 !text-xs">{absence}</Text>
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

export default async function AgentReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const lifecycle = await getAgentLifecycle(id)
  if (!lifecycle) notFound()

  const { versions, productionVersion, candidateVersion, gate, capabilities } = lifecycle

  // The rollback target is the version the promotion transition archived most
  // recently. `archived` is the only stage that proves a version actually
  // served production; rolling back to a draft would ship something that never
  // passed a gate. Same rule as `rollbackCapability` — read here only to name
  // the target, never to decide whether the action is allowed.
  const rollbackTarget = versions
    .filter((v) => v.stage === 'archived' && v.id !== productionVersion?.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]

  const blocking = gate ? gate.checks.filter((c) => c.status !== 'pass') : []

  // Promotion evidence — the extended gate `evaluatePromotionGate` already
  // computes for the promotion route. Read-only, same source of truth as
  // "Promote or roll back" below; never a second gate that could disagree.
  const candidateVersionIdForEvidence = gate?.candidateVersionId ?? candidateVersion?.id ?? null
  const promotionGate = candidateVersionIdForEvidence
    ? await evaluatePromotionGate(lifecycle.copilotId, candidateVersionIdForEvidence).catch(() => null)
    : null

  const shadowRows = candidateVersionIdForEvidence
    ? await pgrest<Record<string, unknown>[]>(
        'GET',
        `shadow_experiments?copilot_id=eq.${encodeURIComponent(lifecycle.copilotId)}&candidate_version_id=eq.${encodeURIComponent(candidateVersionIdForEvidence)}&select=status,candidate_verdict,would_mutate_count,sampled_run_count,execution_mode&order=started_at.desc&limit=1`,
      ).catch(() => [])
    : []
  const shadowRow = shadowRows[0] ?? null
  const shadow = shadowRow
    ? {
        status: shadowRow.status as string,
        candidateVerdict: (shadowRow.candidate_verdict as string | null) ?? null,
        wouldMutateCount: shadowRow.would_mutate_count as number,
        sampledRunCount: shadowRow.sampled_run_count as number,
        // PR #22 rework: never a stand-in default here — an absent column
        // read (pre-migration row) is exactly 'legacy_unknown' territory,
        // and the UI must render it as unlabelled/unproven, never as PASS.
        executionMode: (shadowRow.execution_mode as string | undefined) ?? 'legacy_unknown',
      }
    : null

  const replayRows = candidateVersionIdForEvidence
    ? await pgrest<Record<string, unknown>[]>(
        'GET',
        `replay_comparisons?copilot_id=eq.${encodeURIComponent(lifecycle.copilotId)}&candidate_version_id=eq.${encodeURIComponent(candidateVersionIdForEvidence)}&select=status,verdict,case_count,candidates,execution_mode&order=created_at.desc&limit=1`,
      ).catch(() => [])
    : []
  const replayRow = replayRows[0] ?? null
  const replay = replayRow
    ? {
        verdict: (replayRow.verdict as string | null) ?? null,
        caseCount: replayRow.case_count as number,
        divergent: ((replayRow.candidates as Array<{ comparison: string; note: string }>) ?? []).filter(
          (c) => c.comparison === 'worse' || c.comparison === 'nondeterministic',
        ),
        executionMode: (replayRow.execution_mode as string | undefined) ?? 'legacy_unknown',
      }
    : null
  const replayStatus = (replayRow?.status as string | null) ?? null

  return (
    <div className="flex flex-col gap-6">
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
              <span className="text-xs font-medium text-zinc-400">Under evaluation</span>
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
        title="Release gate"
        description="Nine checks evaluated from this candidate’s real test run, benchmark and tool policy. Promotion needs all nine."
        meta={
          gate ? (
            <span className="text-xs font-medium text-zinc-400">
              {gate.promotable
                ? 'All checks pass'
                : `${blocking.length} of ${gate.checks.length} blocking`}
            </span>
          ) : null
        }
      >
        {gate === null ? (
          <div className="max-w-prose">
            <Text className="!mt-0 !text-xs">
              The gate has no candidate to evaluate, so no verdict exists — not a failing one, and not a
              passing one. Nothing here is a measurement of this agent’s quality.
            </Text>
            <div className="mt-4">
              <CapabilityNote capability={capabilities.promote} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <ReleaseGateChecks checks={gate.checks} />
            {/* `missing` and `fail` block identically but mean opposite things,
                so the summary names them separately instead of totalling them. */}
            {blocking.length > 0 ? (
              <Text className="!mt-0 !text-xs">
                Blocked by {blocking.filter((c) => c.status === 'fail').length} failing check
                {blocking.filter((c) => c.status === 'fail').length === 1 ? '' : 's'} and{' '}
                {blocking.filter((c) => c.status === 'missing').length} unmeasured one
                {blocking.filter((c) => c.status === 'missing').length === 1 ? '' : 's'}. An unmeasured check is
                not a negative result — it is evidence nobody has produced yet.
              </Text>
            ) : (
              <Text className="!mt-0 !text-xs">
                Every check passes on {gate.evidence.candidateLabel}. That permits a promotion; it does not
                perform one.
              </Text>
            )}
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
          <Text className="!mt-0 !text-xs">
            There is no candidate to evaluate, so there is no promotion evidence either.
          </Text>
        ) : promotionGate === null ? (
          <Text className="!mt-0 !text-xs">
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
              {candidateVersionIdForEvidence ? (
                <div className="mt-3">
                  <ProofActions
                    copilotId={lifecycle.copilotId}
                    versionId={candidateVersionIdForEvidence}
                    versionLabel={gate?.evidence.candidateLabel ?? candidateVersion?.label ?? null}
                    kind="shadow"
                    runningStatus={shadow?.status ?? null}
                  />
                </div>
              ) : null}
            </div>
            <div>
              <p className={eyebrowClass}>Replay comparison</p>
              <div className="mt-2">
                <ReplayEvidence replay={replay} />
              </div>
              {candidateVersionIdForEvidence ? (
                <div className="mt-3">
                  <ProofActions
                    copilotId={lifecycle.copilotId}
                    versionId={candidateVersionIdForEvidence}
                    versionLabel={gate?.evidence.candidateLabel ?? candidateVersion?.label ?? null}
                    kind="replay"
                    runningStatus={replayStatus}
                  />
                </div>
              ) : null}
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
    </div>
  )
}
