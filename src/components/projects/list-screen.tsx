/**
 * Écran « Projets » — la liste, moitié gauche du maître-détail.
 *
 * Server Component : il reçoit des lignes déjà qualifiées par `./model` et les
 * rend. Aucune lecture ici.
 *
 * ZÉRO-SCROLL : la page est `h-full overflow-hidden` ; c'est la LISTE qui
 * défile, dans sa box de hauteur bornée (`Panel`). Une box ne grandit jamais
 * avec sa donnée.
 *
 * CE QUE CET ÉCRAN REFUSE D'AFFICHER
 * ----------------------------------
 * « $0.00 · 0 runs » sur un projet qui n'a aucun agent. Le data layer produit
 * bien un `0` là (`sumMeasuredHealth([])` → `{ value: 0 }`, documenté comme un
 * zéro mesuré : pas d'agent, pas de run, pas de coût) et ce n'est donc pas un
 * faux zéro au sens strict. Mais à l'écran, deux chiffres à zéro se lisent
 * comme « on a mesuré, c'est calme », alors que le fait réel est « il n'y a
 * personne ». On dit le fait. Voir `./model.ts` → `MeasureState`.
 */
import Link from 'next/link'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Divider } from '@/components/ui/divider'
import { Heading } from '@/components/ui/heading'
import { Strong, Text } from '@/components/ui/text'
import { AbsentMark, Panel, Rail, Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { UNAVAILABLE_LABEL, formatUsd } from '@/lib/agent-mission-control/format'
import type { ProjectListItem, ProjectMeasure } from './model'

const MUTED_RAIL = 'rgb(161 161 170 / 0.35)'

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
}: {
  measure: ProjectMeasure
  render: (value: number) => React.ReactNode
}) {
  if (measure.state === 'measured' && measure.value !== null) return <>{render(measure.value)}</>
  if (measure.state === 'not-measured') return <AbsentMark />
  return null
}

function ProjectListRow({ item }: { item: ProjectListItem }) {
  const live = item.activeCount > 0
  const empty = item.copilotCount === 0

  return (
    <li className="relative border-b border-zinc-950/5 last:border-b-0 dark:border-white/5">
      <Rail color={live ? '#0da87f' : MUTED_RAIL} />
      {/* Toute la ligne est cliquable — le deep link est la raison d'être de
          cette liste. `block` + `focus-visible` : atteignable au clavier. */}
      <Link
        href={item.href}
        className="flex items-center gap-3 py-2.5 pr-4 pl-4 hover:bg-zinc-950/[2.5%] focus-visible:bg-zinc-950/[2.5%] focus-visible:outline-hidden dark:hover:bg-white/[2.5%] dark:focus-visible:bg-white/[2.5%]"
      >
        <Avatar square initials={initialsOf(item.name)} className="size-8 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Strong className="truncate">{item.name}</Strong>
            {empty ? (
              <Badge color="zinc">aucun agent</Badge>
            ) : (
              <Badge color={live ? 'emerald' : 'zinc'}>
                {item.activeCount}/{item.copilotCount}
              </Badge>
            )}
          </div>
          <Text className="truncate">{item.repoFullName ?? 'aucun dépôt lié'}</Text>
        </div>

        <div className="shrink-0 text-right">
          <Text>
            {empty ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">rien à mesurer</span>
            ) : (
              <Measure
                measure={item.runs}
                render={(runs) => (
                  <>
                    <Strong className="tabular-nums">{runs}</Strong> runs
                  </>
                )}
              />
            )}
          </Text>
          {empty ? null : (
            <Text className="tabular-nums">
              <Measure measure={item.cost} render={(usd) => <>{formatUsd(usd)}</>} />
              {' · '}
              {item.passRate === null ? (
                <AbsentMark />
              ) : (
                `${Math.round(item.passRate * 100)} %`
              )}
            </Text>
          )}
        </div>
      </Link>
    </li>
  )
}

export default function ProjectsListScreen({
  items,
  /** `true` quand la lecture de la liste a ÉCHOUÉ — jamais quand elle est vide. */
  unreadable = false,
  failure,
}: {
  items: readonly ProjectListItem[]
  unreadable?: boolean
  failure?: string | null
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3">
      <header className="shrink-0 px-1">
        <Heading level={1}>Projets</Heading>
        <Text className="mt-1">
          Projets consommateurs, leur dépôt cible et les agents qui leur sont rattachés.
        </Text>
      </header>

      <Panel
        title="Catalogue"
        hint={unreadable ? 'lecture échouée' : `${items.length} projet${items.length > 1 ? 's' : ''}`}
        className="min-h-0 flex-1"
        padded={false}
        bodyClassName="overflow-y-auto"
      >
        {unreadable ? (
          <div className="p-4">
            <Unavailable
              reason="unread"
              detail="La liste des projets n'a pas pu être lue. Aucun projet n'est affiché — ce n'est pas un catalogue vide, c'est un catalogue inconnu."
            />
            {failure ? <Text className="mt-3 text-center font-mono text-xs">{failure}</Text> : null}
          </div>
        ) : items.length === 0 ? (
          <div className="p-4">
            <Unavailable
              reason="no-data"
              detail="La lecture a réussi et le catalogue est réellement vide : aucun projet n'est enregistré."
            />
          </div>
        ) : (
          <ul>
            {items.map((item) => (
              <ProjectListRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </Panel>

      <Divider soft className="shrink-0" />
      <Text className="shrink-0 px-1 text-xs">
        Un projet sans agent n&apos;affiche ni coût ni compteur de runs : il n&apos;a rien à
        mesurer. Une mesure absente sur un projet peuplé s&apos;affiche{' '}
        «&nbsp;{UNAVAILABLE_LABEL}&nbsp;», jamais zéro.
      </Text>
    </div>
  )
}
