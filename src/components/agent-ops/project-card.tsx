import { CodeBracketIcon } from '@heroicons/react/16/solid'
import Image from 'next/image'

import { Avatar } from '@/components/catalyst/avatar'
import { Badge } from '@/components/catalyst/badge'
import { Subheading } from '@/components/catalyst/heading'
import { Link } from '@/components/catalyst/link'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { Project } from '@/lib/agent-mission-control/types'

/**
 * Project registry card — landscape photo header + square logo avatar overlapping
 * the header, then title/meta and a three-stat footer. Server-safe (no `use client`),
 * props serialisable. Twin cards share an identical skeleton so grid rows align to
 * the pixel; absent data renders `—` zinc, never `0.0%`.
 * `imageUrl`/`logoUrl` are optional on the shared `Project` interface.
 */
interface ProjectRollup {
  copilotCount: number
  activeCount: number
  runsLast24h: number
  costLast24hUsd: number
  openWarnings: number
}

interface ProjectCardProps {
  project: Project
  rollup: ProjectRollup
  href: string
}

const PLATFORM_LABELS: Record<Project['platform'], string> = {
  web: 'Web',
  desktop: 'Desktop',
  mobile: 'Mobile',
  api: 'API',
}

const numberFormat = new Intl.NumberFormat('en-US')

/** First two letters of the project name, uppercased, for the avatar fallback. */
function initialsFor(name: string): string {
  return name.replace(/\s+/g, '').slice(0, 2).toUpperCase()
}

export function ProjectCard({ project, rollup, href }: ProjectCardProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
      {/* Landscape photo header — real image or a zinc-only gradient fallback. */}
      <div className="relative h-28">
        {project.imageUrl ? (
          <Image
            src={project.imageUrl}
            alt={project.name}
            fill
            sizes="(min-width: 1024px) 33vw, 100vw"
            className="object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="size-full bg-gradient-to-br from-zinc-800 to-zinc-950"
          />
        )}
        {rollup.openWarnings > 0 && (
          <div className="absolute top-3 right-3 z-10">
            <Badge color="accentStrong" className="font-mono tabular-nums shadow-sm">
              {numberFormat.format(rollup.openWarnings)}
              <span className="sr-only"> open warnings</span>
            </Badge>
          </div>
        )}
      </div>

      {/* Square logo avatar overlapping the bottom edge of the header —
          relative z-10 so it sits ABOVE the header instead of being clipped by it. */}
      <div className="relative z-10 -mt-8 ml-6">
        <Avatar
          square
          src={project.logoUrl ?? undefined}
          initials={initialsFor(project.name)}
          alt={project.name}
          className="size-14 bg-zinc-900 ring-2 ring-white dark:ring-zinc-950"
        />
      </div>

      {/* Body — title, meta line, description. flex-col + flex-1 pousse le footer
          au bas de la carte pour que les cartes jumelles alignent leurs stats au pixel. */}
      <div className="flex flex-1 flex-col px-6 pt-3 pb-6">
        <Subheading level={3} className="truncate">
          <Link href={href} title={project.name} className="hover:underline">
            {project.name}
          </Link>
        </Subheading>
        <div className="mt-1 truncate font-mono text-xs text-zinc-500">
          {project.slug} · {PLATFORM_LABELS[project.platform]}
        </div>
        {project.repoUrl && project.repoFullName ? (
          <Link
            href={project.repoUrl}
            target="_blank"
            rel="noreferrer"
            title={project.repoFullName}
            className="mt-1 inline-flex max-w-full items-center gap-1.5 font-mono text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            <CodeBracketIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{project.repoFullName}</span>
            <span className="sr-only">GitHub repository (opens in a new tab)</span>
          </Link>
        ) : null}
        {/* Hauteur fixe 2 lignes → toutes les cartes réservent la même place, même
            si la description tient sur une seule ligne (sinon le footer remonte). */}
        <p className="mt-3 line-clamp-2 min-h-10 text-sm text-zinc-500 dark:text-zinc-400">{project.description}</p>

        {/* Footer — three mini-stats, identical slots across twin cards.
            mt-auto colle le footer au bas de la carte. */}
        <div className="mt-auto grid grid-cols-3 gap-4 border-t border-zinc-950/5 pt-4 dark:border-white/5">
          <div>
            <div className="text-xs text-zinc-500">Fleet</div>
            <div className="mt-1 font-mono text-zinc-700 tabular-nums dark:text-zinc-200">
              {rollup.activeCount}/{rollup.copilotCount}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Runs 24h</div>
            <div className="mt-1 font-mono text-zinc-700 tabular-nums dark:text-zinc-200">
              {numberFormat.format(rollup.runsLast24h)}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Cost 24h</div>
            <div className="mt-1 font-mono text-zinc-700 tabular-nums dark:text-zinc-200">
              {rollup.runsLast24h > 0 ? (
                formatUsd(rollup.costLast24hUsd)
              ) : (
                <span className="text-zinc-500">
                  <span aria-hidden="true">&mdash;</span>
                  <span className="sr-only">No runs in the last 24 hours</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
