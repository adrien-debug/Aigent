import {
  BoltIcon,
  ChartBarIcon,
  CheckBadgeIcon,
  CpuChipIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from '@heroicons/react/20/solid'
import clsx from 'clsx'

import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'
import type { Copilot } from '@/lib/agent-mission-control/types'

/**
 * Per-copilot visual identity. There is NO `type`/`kind`/`role` field on a
 * Copilot (see types.ts), so the type is a *derived visual cue* — never a
 * business fact rendered as data. Differentiation is by GLYPH only: the design
 * system is strictly mono-accent (neon-orange) + zinc, so every avatar shares
 * the same accent surface/ring and only the icon changes. When in doubt →
 * `default`. This keeps copilots (operators, round icon avatar) visually
 * distinct from projects (workspaces, square photo/logo avatar).
 */
export type CopilotType = 'builder' | 'security' | 'qa-release' | 'inspector' | 'finance' | 'ops' | 'default'

const TYPE_ICON: Record<CopilotType, typeof CpuChipIcon> = {
  builder: SparklesIcon,
  security: ShieldCheckIcon,
  'qa-release': CheckBadgeIcon,
  inspector: MagnifyingGlassIcon,
  finance: ChartBarIcon,
  ops: BoltIcon,
  default: CpuChipIcon,
}

// Keyword → type, checked in order (first hit wins). Matched against a lowercase
// haystack of slug + name + tags. Deliberately generous; a miss is harmless (it
// only falls back to the generic chip icon, never a wrong claim about the agent).
const TYPE_RULES: { type: CopilotType; keywords: string[] }[] = [
  { type: 'security', keywords: ['security', 'sentinel', 'policy', 'guard', 'audit', 'compliance'] },
  { type: 'qa-release', keywords: ['qa', 'test', 'quality', 'release', 'gate', 'pilot', 'ship', 'promote'] },
  { type: 'inspector', keywords: ['inspect', 'repo', 'doc', 'search', 'triage', 'navigator', 'explorer', 'review'] },
  { type: 'finance', keywords: ['finance', 'billing', 'cost', 'quota', 'invoice', 'spend', 'budget'] },
  { type: 'ops', keywords: ['ops', 'gateway', 'api', 'bolt', 'power', 'infra', 'deploy', 'runtime'] },
]

/** Derive a copilot's visual type from its slug/name/tags. Never authoritative. */
export function copilotType(copilot: Pick<Copilot, 'slug' | 'name' | 'tags'>): CopilotType {
  if (copilot.slug === AGENT_BUILDER_SLUG) return 'builder'
  const haystack = [copilot.slug, copilot.name, ...(copilot.tags ?? [])].join(' ').toLowerCase()
  for (const rule of TYPE_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) return rule.type
  }
  return 'default'
}

/**
 * Round type-glyph avatar for a copilot. Decorative (`aria-hidden`) — the name
 * always sits next to it in text. Soft accent surface + accent hairline ring +
 * accent icon; identity is carried by the icon, tint stays mono per doctrine.
 * Default size is 40px (`size-10`); override via `className`.
 */
export function CopilotAvatar({
  copilot,
  className,
}: {
  copilot: Pick<Copilot, 'slug' | 'name' | 'tags'>
  className?: string
}) {
  const Icon = TYPE_ICON[copilotType(copilot)]
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-surface)] text-accent-600 ring-1 ring-[var(--accent-line)] dark:text-accent-400',
        className
      )}
    >
      <Icon className="size-5" />
    </span>
  )
}
