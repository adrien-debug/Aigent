import { EmptyState } from '@/components/agent-ops/empty-state'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { PageHeader } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import { Badge } from '@/components/ui/badge'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import type { getTool } from '@/lib/agent-mission-control/registry'
import type { TOOL_BUILD_STATE_STEPS } from '@/lib/agent-mission-control/tool-builder/mission'

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
          eyebrow="Factory"
          title="Build a tool"
          description="The lifecycle a tool build passes through before it can be trusted by an agent."
        />
      </StaggerFade>

      <StaggerFade delay={2}>
        <Section
          title="Pipeline"
          description="DRAFT → IMPLEMENTING → TESTING → CERTIFIED, with REJECTED/DEPRECATED as the failure and retirement branches."
          contentClassName="max-h-96 overflow-y-auto px-6 py-4"
        >
          <ol className="flex flex-col gap-4">
            {pipelineSteps.map((step, index) => (
              <li key={step.state} className="flex gap-4">
                <div className="flex w-6 shrink-0 flex-col items-center">
                  <span className="font-mono text-xs tabular-nums text-zinc-500">{index + 1}</span>
                </div>
                <div className="min-w-0">
                  <Badge color={step.state === 'CERTIFIED' ? 'accent' : 'zinc'}>{step.state}</Badge>
                  <Text className="mt-1.5 text-zinc-400">{step.description}</Text>
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
                <span className="font-mono text-xs tabular-nums text-zinc-500">v{countWords.version}</span>
                <Badge color={countWords.certification === 'certified' ? 'accent' : 'zinc'}>
                  {countWords.certification}
                </Badge>
                <Badge color="zinc">risk: {countWords.risk}</Badge>
              </div>
              <Text className="mt-2 text-zinc-400">{countWords.summary}</Text>
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-zinc-500">kind</dt>
                  <dd className="font-mono text-sm tabular-nums text-zinc-300">{countWords.kind}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">mutates</dt>
                  <dd className="font-mono text-sm tabular-nums text-zinc-300">{String(countWords.mutates)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">provenance</dt>
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
          <Text className="text-zinc-400">
            Only <span className="font-mono text-zinc-300">local-deterministic</span> tools can be generated
            and certified through this pipeline today: spec → validation → sandbox tests → certification.
            Tools of kind <span className="font-mono text-zinc-300">http</span>,{' '}
            <span className="font-mono text-zinc-300">db</span> or{' '}
            <span className="font-mono text-zinc-300">repo</span> need adapters and secrets the sandbox
            cannot safely run, and are not generable here yet.
          </Text>
          <Text className="mt-2 font-mono text-xs text-zinc-500">
            src/lib/agent-mission-control/tool-builder/mission.ts
          </Text>
        </Section>
      </StaggerFade>
    </PageLayout>
  )
}
