import { ArrowRightIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/status-dot'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'
import { Metric, ScreenHeader, Section } from './screen-primitives'

export function ProjectsScreen({ projects, copilots }: { projects: Project[]; copilots: Copilot[] }) {
  const assigned = copilots.filter((copilot) => copilot.projectId !== null)
  const active = assigned.filter((copilot) => copilot.displayStatus === 'production' || copilot.status === 'active')

  return (
    <div className="space-y-8">
      <ScreenHeader title="Projects" description="Repositories and their persisted agent teams." />
      <div className="grid divide-y divide-white/8 border-y border-white/8 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Metric label="Projects" value={projects.length} detail="Persisted workspaces" />
        <Metric label="Assigned agents" value={assigned.length} detail="Linked to a project" />
        <Metric label="Serving" value={active.length} detail="Active or production" />
      </div>
      <Section title="Project registry" description="Live records from the Aigent perimeter">
        <div className="divide-y divide-white/8">
          {projects.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-zinc-400">No project is available.</p>
          ) : projects.map((project) => {
            const team = assigned.filter((copilot) => copilot.projectId === project.id)
            return (
              <div key={project.id} className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <p className="truncate text-sm font-medium text-white">{project.name}</p>
                    <StatusDot tone={project.repoFullName ? 'positive' : 'neutral'}>
                      {project.repoFullName ? 'Repository linked' : 'Repository unavailable'}
                    </StatusDot>
                  </div>
                  <p className="mt-1 truncate text-xs text-zinc-400">{project.description || project.repoFullName || project.slug}</p>
                </div>
                <div className="flex shrink-0 items-center gap-5">
                  <div className="text-right">
                    <p className="text-sm tabular-nums text-white">{team.length}</p>
                    <p className="text-[11px] text-zinc-500">agents</p>
                  </div>
                  <Button href={`/admin/projects/${project.id}/builder`} outline>
                    Open Builder <ArrowRightIcon />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}
