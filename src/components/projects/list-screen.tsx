/**
 * Écran « Projets » — la liste, moitié gauche du maître-détail.
 *
 * Server Component : il reçoit des lignes déjà qualifiées par `./model` et les
 * rend. Aucune lecture ici.
 */
import type { ReactNode } from 'react'
import Link from 'next/link'

import { PageBody, PageHeader } from '@/components/app-shell'
import { Avatar } from '@/components/ui/avatar'
import { Divider } from '@/components/ui/divider'
import { Strong, Text } from '@/components/ui/text'
import {
  AbsentMark,
  Unavailable,
  initialsOf,
} from '@/components/cockpit/primitives'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import type { ProjectListItem, ProjectMeasure } from './model'

function projectCountHint(count: number): string {
  const suffix = count > 1 ? 's' : ''
  return `${count} projet${suffix}`
}

/**
 * Une mesure agrégée, rendue selon son état réel.
 *
 * `measured` → le chiffre. `not-measured` → `AbsentMark`, qui rend le mot
 * d'absence du produit (UNAVAILABLE_LABEL, une seule orthographe).
 * `no-subject` → rien du tout : l'appelant a déjà dit « aucun agent », répéter
 * un tiret ici ne renseignerait personne.
 */
function Measure({
  measure,
  render,
}: Readonly<{
  measure: ProjectMeasure
  render: (value: number) => React.ReactNode
}>) {
  if (measure.state === 'measured' && measure.value !== null) return <>{render(measure.value)}</>
  if (measure.state === 'not-measured') return <AbsentMark />
  return null
}

function ProjectListRow({ item }: Readonly<{ item: ProjectListItem }>) {
  const live = item.activeCount > 0
  const empty = item.copilotCount === 0
  const stateLabel = empty ? 'vide' : live ? 'actif' : 'inactif'

  return (
    <li className="aig-line-soft border-b last:border-b-0">
      <Link
        href={item.href}
        className="grid grid-cols-[minmax(0,1.4fr)_110px_90px_90px_80px] items-center gap-3 px-2 py-2.5 hover:bg-(--aig-line-soft) focus-visible:bg-(--aig-line-soft) focus-visible:outline-hidden sm:px-3"
      >
        <div className="min-w-0 flex items-center gap-2">
          <Avatar square initials={initialsOf(item.name)} className="size-8 shrink-0" />
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0">
              <Strong className="truncate">{item.name}</Strong>
              <Text className="truncate">{item.repoFullName ?? 'aucun dépôt lié'}</Text>
            </div>
          </div>
        </div>

        <Text className="shrink-0 text-right tabular-nums">{item.copilotCount}</Text>
        <Text className="shrink-0 text-right tabular-nums">
          {empty ? (
            <span className="aig-text-faint text-xs">—</span>
          ) : (
            <Measure
              measure={item.runs}
              render={(runs) => (
                <>
                  <Strong className="tabular-nums">{runs}</Strong>
                </>
              )}
            />
          )}
        </Text>
        <Text className="shrink-0 text-right">{stateLabel}</Text>
        <div className="shrink-0 text-right">
          <Text className="aig-text-faint text-xs">ouvrir</Text>
        </div>
      </Link>
    </li>
  )
}

function renderProjectCatalog(
  unreadable: boolean,
  items: readonly ProjectListItem[],
  failure?: string | null,
): ReactNode {
  if (unreadable) {
    return (
      <div className="p-4">
        <Unavailable
          reason="unread"
          detail="La liste des projets n'a pas pu être lue. Aucun projet n'est affiché — ce n'est pas un catalogue vide, c'est un catalogue inconnu."
        />
        {failure ? <Text className="mt-3 text-center font-mono text-xs">{failure}</Text> : null}
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="p-4">
        <Unavailable
          reason="no-data"
          detail="La lecture a réussi et le catalogue est réellement vide : aucun projet n'est enregistré."
        />
      </div>
    )
  }
  return (
    <ul className="divide-y aig-line-soft">
      {items.map((item) => (
        <ProjectListRow key={item.id} item={item} />
      ))}
    </ul>
  )
}

export default function ProjectsListScreen({
  items,
  /** `true` quand la lecture de la liste a ÉCHOUÉ — jamais quand elle est vide. */
  unreadable = false,
  failure,
}: Readonly<{
  items: readonly ProjectListItem[]
  unreadable?: boolean
  failure?: string | null
}>) {
  return (
    <>
      <PageHeader
        title="Projets"
        description="Projets consommateurs, leur dépôt cible et les agents qui leur sont rattachés."
      />
      <PageBody className="gap-3">
        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Catalogue</h2>
            <Text className="aig-text-faint text-xs">
              {unreadable ? 'lecture échouée' : projectCountHint(items.length)}
            </Text>
          </div>
          <div className="aig-hairline my-2" />
          <div className="aig-text-faint grid grid-cols-[minmax(0,1.4fr)_110px_90px_90px_80px] gap-3 px-2 pb-1 text-2xs uppercase tracking-wide sm:px-3">
            <span>Projet</span>
            <span className="text-right">Agents</span>
            <span className="text-right">Runs</span>
            <span className="text-right">Etat</span>
            <span className="text-right">Action</span>
          </div>
          {renderProjectCatalog(unreadable, items, failure)}
        </section>

        <Divider soft />
        <Text className="aig-text-faint text-xs">
          Un projet sans agent n&apos;affiche ni coût ni compteur de runs : il n&apos;a rien à
          mesurer. Une mesure absente sur un projet peuplé s&apos;affiche «&nbsp;{UNAVAILABLE_LABEL}
          &nbsp;», jamais zéro.
        </Text>
      </PageBody>
    </>
  )
}
