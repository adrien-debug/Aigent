import { EmptyState } from '@/components/agent-ops/empty-state'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { PageHeader } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import { Badge } from '@/components/ui/badge'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import type { getTool } from '@/lib/agent-mission-control/registry'
import type { TOOL_BUILD_STATE_STEPS } from '@/lib/agent-mission-control/tool-builder/mission'

/**
 * /admin/factory/tools/new — reference documentation of the build pipeline.
 *
 * This screen starts nothing: it explains the states a tool passes through and
 * shows the one tool that has actually walked them. It shared its title with
 * /admin/factory/tools ("Build a tool"), which made a documentation page look
 * like a second, duplicate builder. The title now states what the page is.
 */
export function ToolNewView({
  pipelineSteps,
  countWords,
}: {
  pipelineSteps: typeof TOOL_BUILD_STATE_STEPS
  countWords: ReturnType<typeof getTool>
}) {
  return (
    <PageLayout className="gap-8 pb-12">
      <StaggerFade delay={1}>
        <PageHeader
          eyebrow="Tool Builder"
          title="How a tool build works"
          description="Reference only — this page starts nothing. It documents the lifecycle a tool build passes through before an agent is allowed to mount it."
        />
      </StaggerFade>

      <StaggerFade delay={2}>
        <Section
          title="Pipeline"
          description="DRAFT → IMPLEMENTING → TESTING → CERTIFIED, with REJECTED/DEPRECATED as the failure and retirement branches."
          // No `max-h-96 overflow-y-auto`. A bounded box that scrolls is the
          // right shape for a LIVE list, whose length is decided by data at
          // runtime; this one renders `TOOL_BUILD_STATE_STEPS`, a six-entry
          // compile-time constant, so the box was already deterministic — the
          // cap only decided how much of it you could see.
          //
          // MEASURED clientHeight 384 against scrollHeight: 436 @1440 (52px
          // hidden, step 6 clipped), 484 @1024 and @768 (100px, step 6 fully
          // below the fold), 676 @390 (292px — steps 5 and 6, REJECTED and
          // DEPRECATED, entirely out of view and step 4 cut mid-sentence).
          // Those two are exactly the branches this section's own description
          // announces, so on a phone the page promised a failure and a
          // retirement state it then hid behind an inner scroll — nested inside
          // a page that already scrolls, which on touch swallows the swipe.
          contentClassName="px-6 py-4"
        >
          {/* Step number and its badge sat on two different centres — 277 against
              283 measured, on every row: the badge is an inline-flex inside a
              24px line box, which pushes it 2px down, while the number was pinned
              to the top of a stretched column. `flex-col items-start` on the body
              makes the badge a flex item (no baseline shift), and `h-6` on the
              number column gives it the same 24px box, so both centre at the same
              y. `text-zinc-400`, not `-500`: the same 12px/zinc-500 pairing on
              this raised plane measured 3.59:1 against the 4.5 AA threshold. */}
          <ol className="flex flex-col gap-4">
            {pipelineSteps.map((step, index) => (
              <li key={step.state} className="flex gap-4">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                  <span className="font-mono text-xs tabular-nums text-zinc-400">{index + 1}</span>
                </div>
                <div className="flex min-w-0 flex-col items-start">
                  <Badge color={step.state === 'CERTIFIED' ? 'accent' : 'zinc'}>{step.state}</Badge>
                  <Text className="mt-1.5">{step.description}</Text>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      </StaggerFade>

      <StaggerFade delay={3}>
        <Section
          title="Worked example: count_words"
          description="The one tool that has actually walked this pipeline end to end, read live from the registry."
          contentClassName="px-6 py-4"
        >
          {countWords ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm tabular-nums text-white">{countWords.id}</span>
                {/* zinc-400: this span measured 3.59:1 at 12px on the raised plane. */}
                <span className="font-mono text-xs tabular-nums text-zinc-400">v{countWords.version}</span>
                <Badge color={countWords.certification === 'certified' ? 'accent' : 'zinc'}>
                  {countWords.certification}
                </Badge>
                <Badge color="zinc">risk: {countWords.risk}</Badge>
              </div>
              <Text className="mt-2">{countWords.summary}</Text>
              {/* `grid-cols-2` for three items left a hole in the second row under
                  640px. One column below sm cannot leave one, and the row is
                  exactly full at sm and up. `text-zinc-400` on the terms: the
                  three `dt` measured 3.59:1 at 12px, under the 4.5 AA threshold. */}
              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-zinc-400">kind</dt>
                  <dd className="font-mono text-sm tabular-nums text-zinc-300">{countWords.kind}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-400">mutates</dt>
                  <dd className="font-mono text-sm tabular-nums text-zinc-300">{String(countWords.mutates)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-400">provenance</dt>
                  <dd className="font-mono text-sm tabular-nums text-zinc-300">{countWords.provenance}</dd>
                </div>
              </dl>
            </>
          ) : (
            <EmptyState title="count_words not found" description="The reference tool is not registered." />
          )}
        </Section>
      </StaggerFade>

      <StaggerFade delay={4}>
        <Section title="What the builder supports today" contentClassName="px-6 py-4">
          {/* No colour class: `Text` already defaults to zinc-500/zinc-400, so the
              one written here was a dead override of the identical value. */}
          <Text>
            Only <span className="font-mono text-zinc-300">local-deterministic</span> tools can be generated
            and certified through this pipeline today: spec → validation → sandbox tests → certification.
            Tools of kind <span className="font-mono text-zinc-300">http</span>,{' '}
            <span className="font-mono text-zinc-300">db</span> or{' '}
            <span className="font-mono text-zinc-300">repo</span> need adapters and secrets the sandbox
            cannot safely run, and are not generable here yet.
          </Text>
          {/* Plain `text-xs`. The `!` dated from `Text`'s `clsx(className,
              defaults)` era, when a bare caller class was emitted before the
              primitive's `sm:text-sm/6` and lost the cascade — this path
              rendered at 14px. `cn(defaults, className)` resolves it in JS now,
              and keeping the `!` would only stop `tailwind-merge` from dropping
              the dead default (important and non-important classes sit in
              different conflict groups). Measured 12px/16px either way. */}
          <Text className="mt-2 font-mono text-xs">
            src/lib/agent-mission-control/tool-builder/mission.ts
          </Text>
        </Section>
      </StaggerFade>
    </PageLayout>
  )
}
