import {
  BoltIcon,
  CheckBadgeIcon,
  CpuChipIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from '@heroicons/react/20/solid'
import clsx from 'clsx'

import { Avatar } from '@/components/ui/avatar'
import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'
import type { Copilot } from '@/lib/agent-mission-control/types'

/**
 * Per-copilot visual identity. There is NO `type`/`kind`/`role` field on a
 * Copilot (see types.ts), so the type is a *derived visual cue* — never a
 * business fact rendered as data. Differentiation is by GLYPH first: the
 * design system is strictly mono-accent + zinc, so no avatar may use
 * a chromatic hue outside `accent`/`zinc`. The `builder` type (the one
 * first-class agent) gets the sole accent surface; every other type is
 * differentiated by a zinc-shade step, never by a competing hue. When in
 * doubt → `default`. This keeps copilots (operators, round icon avatar)
 * visually distinct from projects (workspaces, square photo/logo avatar).
 */
export type CopilotType = 'builder' | 'security' | 'qa-release' | 'inspector' | 'ops' | 'default'

const TYPE_ICON: Record<CopilotType, typeof CpuChipIcon> = {
  builder: SparklesIcon,
  security: ShieldCheckIcon,
  'qa-release': CheckBadgeIcon,
  inspector: MagnifyingGlassIcon,
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
  { type: 'ops', keywords: ['ops', 'gateway', 'api', 'bolt', 'power', 'infra', 'deploy', 'runtime'] },
]

/** Derive a copilot's visual type from its slug/name/tags. Never authoritative. */
function copilotType(copilot: Pick<Copilot, 'slug' | 'name' | 'tags'>): CopilotType {
  if (copilot.slug === AGENT_BUILDER_SLUG) return 'builder'
  const haystack = [copilot.slug, copilot.name, ...(copilot.tags ?? [])].join(' ').toLowerCase()
  for (const rule of TYPE_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) return rule.type
  }
  return 'default'
}

/**
 * Round type-glyph avatar for a copilot. Composes `Avatar` (frame: outline,
 * radius, sizing) with a custom `children` fill — the type icon on a gradient
 * tile — since a copilot has neither a photo nor initials to hand `Avatar`'s
 * own `src`/`initials` props. Decorative (`aria-hidden`) — the name always
 * sits next to it in text. Default size is 40px (`size-10`); override via
 * `className`. `square`: a copilot avatar is round (Catalyst's `Avatar`
 * default), distinct from `ProjectAvatar`'s square photo/logo tile.
 */
export function CopilotAvatar({
  copilot,
  className,
}: {
  copilot: Pick<Copilot, 'slug' | 'name' | 'tags'>
  className?: string
}) {
  const type = copilotType(copilot)
  const Icon = TYPE_ICON[type]

  // Visual identity stays mono-accent + zinc (design-system doctrine): the
  // `builder` type is the one first-class agent and is the only one that
  // earns the accent surface. Every other type is told apart by a zinc-shade
  // step (never a competing hue) — the icon already carries the semantic
  // meaning, the tint is just texture.
  const gradientClass = {
    builder: 'bg-gradient-to-br from-[var(--accent-surface)] to-[var(--accent-soft)] ring-[var(--accent-line)] text-accent-400',
    security: 'bg-gradient-to-br from-zinc-600/40 to-zinc-700/20 ring-zinc-400/30 text-zinc-100',
    'qa-release': 'bg-gradient-to-br from-zinc-500/30 to-zinc-600/15 ring-zinc-400/25 text-zinc-200',
    inspector: 'bg-gradient-to-br from-zinc-700/40 to-zinc-800/20 ring-zinc-500/25 text-zinc-300',
    ops: 'bg-gradient-to-br from-zinc-500/20 to-zinc-400/10 ring-zinc-500/30 text-zinc-300',
    default: 'bg-gradient-to-br from-[var(--accent-soft)] to-transparent ring-[var(--accent-line)] text-accent-400'
  }[type]

  return (
    <Avatar
      aria-hidden="true"
      className={clsx(
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] ring-1',
        gradientClass,
        className || 'size-10'
      )}
    >
      <span className="flex size-full items-center justify-center">
        <Icon className="size-1/2" />
      </span>
    </Avatar>
  )
}
