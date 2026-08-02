import {
  beginImplementing,
  beginTesting,
  certifyMission,
  type ToolBuildMission,
  type ToolBuildSpec,
} from './mission'
import { runLocalDeterministicSandbox, type LocalDeterministicSandbox, type ToolSandboxRunResult } from './sandbox'

const DEFAULT_LOCAL_SANDBOX_LIMITS = {
  timeoutMs: 1500,
  maxCases: 12,
  maxInputBytes: 8 * 1024,
  maxOutputBytes: 8 * 1024,
} as const

const LOCAL_TOOL_SANDBOXES: Readonly<
  Record<string, LocalDeterministicSandbox<string, { ok: true; words: number; characters: number; longestWord: number }>>
> = {
  count_words: {
    id: 'local/count_words/v1',
    capabilities: ['local-deterministic-exec'],
    ...DEFAULT_LOCAL_SANDBOX_LIMITS,
    executorId: 'count_words',
    cases: [
      { name: 'empty', input: '', expected: { ok: true, words: 0, characters: 0, longestWord: 0 } },
      { name: 'hello world', input: 'hello world', expected: { ok: true, words: 2, characters: 11, longestWord: 5 } },
    ],
  },
}

async function runSandboxForSpec(spec: ToolBuildSpec): Promise<ToolSandboxRunResult> {
  if (spec.kind !== 'local-deterministic') {
    return {
      status: 'unavailable',
      evidence: { ran: false, passed: 0, failed: 0, detail: `unsupported spec kind "${spec.kind}"` },
      reason: `sandbox unavailable for kind "${spec.kind}"`,
    }
  }

  const sandbox = LOCAL_TOOL_SANDBOXES[spec.id]
  if (!sandbox) {
    return {
      status: 'unavailable',
      evidence: { ran: false, passed: 0, failed: 0, detail: `no sandbox registered for "${spec.id}"` },
      reason: `no sandbox registered for tool id "${spec.id}"`,
    }
  }
  return runLocalDeterministicSandbox(sandbox)
}

/** Advance a mission through implement → test → certify when a sandbox exists. */
export async function advanceToolBuildMission(mission: ToolBuildMission): Promise<ToolBuildMission> {
  if (mission.state === 'REJECTED' || mission.state === 'CERTIFIED' || mission.state === 'DEPRECATED') {
    return mission
  }
  let next = mission.state === 'DRAFT' ? beginImplementing(mission) : mission
  if (next.state === 'IMPLEMENTING') next = beginTesting(next)
  if (next.state !== 'TESTING') return next

  const sandboxRun = await runSandboxForSpec(next.spec)
  if (sandboxRun.status === 'unavailable') {
    return {
      ...next,
      state: 'REJECTED',
      evidence: sandboxRun.evidence,
      rejectionReason: sandboxRun.reason ?? 'sandbox unavailable',
    }
  }
  return certifyMission(next, sandboxRun.evidence)
}
