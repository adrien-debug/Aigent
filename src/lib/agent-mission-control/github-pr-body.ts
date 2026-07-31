import type { AgentManifest, Copilot } from './types'

/** PR body — provenance + files + validation + optional scorecard/sandbox summary. No secrets. */
export function buildAgentDeliveryPrBody(
  copilot: Copilot,
  manifest: AgentManifest,
  files: string[],
  extra?: string
): string {
  const lines = [
    `## Agent delivery — ${copilot.name} (\`${copilot.slug}\`)`,
    '',
    'Delivered by **Aigent** (Agent Mission Control). Merge remains a **manual** decision in this repo — this PR is never auto-merged.',
    '',
    `- **Copilot id:** \`${copilot.id}\``,
    `- **Version:** \`${manifest.version}\``,
    `- **Runtime:** ${copilot.runtime} · **model:** ${copilot.model}`,
    '- **Source:** aigent',
    '',
    '### Files changed',
    ...files.map((f) => `- \`${f}\``),
    '',
    '### Validation',
    'Run the target repo gate scripts (e.g. `npm run verify` / `npm run typecheck`) before merging. Aigent can validate this branch through its Target Repo Sandbox.',
  ]
  if (extra?.trim().length && extra.trim().length > 0) {
    lines.push('', '### Aigent quality summary', extra.trim())
  }
  lines.push('', '> ⚠️ No secret is embedded — the handler reads credentials from `process.env` at runtime.')
  return lines.join('\n')
}

/** PR body for consumer intake delivery. */
export function buildConsumerIntakePrBody(projectName: string, files: string[], packVersion: string): string {
  return [
    `## Consumer intake — ${projectName}`,
    '',
    'Provisioned by **Aigent**. Merge manually after review.',
    '',
    `- Pack version: \`${packVersion}\``,
    '- Intake UI: `/admin/aigent`',
    '- Demand file: `AGENTS-WANTED.md`',
    '',
    '### Files',
    ...files.map((f) => `- \`${f}\``),
    '',
    'After merge: restyle `/admin/aigent` to your design system, then push agents from Aigent.',
  ].join('\n')
}
