import Image from 'next/image'
import { CodeBracketIcon, ServerStackIcon } from '@heroicons/react/24/outline'

import { ProjectAvatar } from '@/components/agent-ops/project-avatar'
import { surfaceCardClass, surfaceCardFooterClass } from '@/components/agent-ops/surface-card'
import { Heading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'
import { PROJECT_PLATFORM_LABELS } from '@/lib/agent-mission-control/labels'
import type { Project } from '@/lib/agent-mission-control/types'

/**
 * Project identity header — cover photo + avatar + repo intelligence, so every
 * project page announces where you are without leaning on navigation menus.
 * The avatar sits BELOW the banner (never overlaps → never clipped).
 * `children` renders as the footer strip (repo-intelligence status + actions).
 */
export function ProjectHeader({
  project,
  actions,
  children,
}: {
  project: Project
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className={surfaceCardClass}>
      {/* Cover photo — bounded banner, image covers, accent wash fallback */}
      <div className="relative h-28 sm:h-40">
        {project.imageUrl ? (
          <Image
            src={project.imageUrl}
            alt=""
            fill
            sizes="100vw"
            priority
            unoptimized={project.imageUrl.startsWith('/')}
            className="object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,var(--accent-surface),transparent_65%)] bg-black/30"
          />
        )}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-[var(--color-surface-secondary)] to-transparent"
        />
      </div>

      {/* Identity row — fully below the photo, nothing clipped */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 lg:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <ProjectAvatar name={project.name} src={project.logoUrl} size="lg" />
          <div className="min-w-0">
            <Heading className="truncate tracking-tight">{project.name}</Heading>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="flex shrink-0 items-center gap-1.5 text-zinc-400">
                <ServerStackIcon aria-hidden="true" className="size-4" />
                <span className="font-mono">{PROJECT_PLATFORM_LABELS[project.platform]}</span>
              </span>
              {project.repoUrl && project.repoFullName && (
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-1.5 rounded-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                >
                  <CodeBracketIcon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="max-w-[50vw] truncate font-mono sm:max-w-xs">{project.repoFullName}</span>
                </a>
              )}
            </div>
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>

      {project.description ? (
        <Text className="-mt-2 max-w-3xl px-6 pb-5 lg:px-8">{project.description}</Text>
      ) : null}

      {children ? <div className={`${surfaceCardFooterClass} px-6 py-4 lg:px-8`}>{children}</div> : null}
    </div>
  )
}
