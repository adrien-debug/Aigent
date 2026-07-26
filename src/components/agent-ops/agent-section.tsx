import { surfaceSectionClass } from '@/components/agent-ops/surface-card'
import { Subheading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

/**
 * Shared section wrapper for the agent detail subpages (configuration,
 * instructions, observability, runs, release) — one `surfaceSectionClass`
 * panel with a `Subheading` + optional description, and an optional `meta`
 * slot for a right-aligned status line (release page only).
 *
 * Extracted because the same component was reimplemented identically in all
 * five pages (AIGENT-AGENT-PAGES-021 debt). Kept in this dedicated file
 * rather than `authoring-primitives.tsx`, which is a `'use client'` module
 * for the authoring workbench, not the (server) agent-detail subpages.
 */
export function AgentSection({
  title,
  description,
  meta,
  children,
}: {
  title: string
  description?: string
  meta?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className={surfaceSectionClass}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <Subheading level={2}>{title}</Subheading>
          {/* Was `!text-xs` — the v3 prefix dialect, which `tailwind-merge` v3 does not even
              read, so it never participated in the merge and only won by `!important`. `Text`
              composes `cn(defaults, className)` now and withdraws its `max-sm:` bump as soon as
              the caller names a size, so the bare class lands at every width on its own.
              Measured on /admin/agents/<id>/instructions @1440 across the five section
              descriptions: 12px/16px before and after, boxes byte-identical. */}
          {description ? <Text className="mt-1 text-xs">{description}</Text> : null}
        </div>
        {meta ? <div className="shrink-0">{meta}</div> : null}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  )
}
