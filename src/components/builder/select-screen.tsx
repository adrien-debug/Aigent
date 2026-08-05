/**
 * Builder — sélection du projet, la porte d'entrée de la surface.
 *
 * Server Component : il reçoit des lignes déjà qualifiées par `./model` et les
 * rend. Aucune lecture ici, aucune mutation.
 */
import { PageBody, PageHeader } from '@/components/app-shell'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Divider } from '@/components/ui/divider'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import { Panel, Rail, SEVERITY, Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { projectCountLabel, type ProjectChoice } from './model'

function ProjectRow({ item }: Readonly<{ item: ProjectChoice }>) {
  return (
    <li className="relative">
      <Rail color={item.repoLinked ? SEVERITY.good : SEVERITY.muted} />
      <Link
        href={item.href}
        className="flex items-center gap-3 py-2.5 pr-4 pl-4 hover:bg-(--aig-line-soft) focus-visible:bg-(--aig-line-soft) focus-visible:outline-hidden"
      >
        <Avatar square initials={initialsOf(item.name)} className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Strong className="truncate">{item.name}</Strong>
            {item.repoLinked ? null : <Badge color="zinc">aucun dépôt</Badge>}
          </div>
          <Text className="truncate">
            {item.repoFullName ?? 'aucun dépôt lié — l’architecte ne pourra pas lire de code'}
          </Text>
        </div>
      </Link>
    </li>
  )
}

function ProjectListBody({
  unreadable,
  failure,
  items,
}: Readonly<{
  unreadable: boolean
  failure?: string | null
  items: readonly ProjectChoice[]
}>) {
  if (unreadable) {
    return (
      <div className="p-4">
        <Unavailable
          reason="unread"
          detail="La liste des projets n’a pas pu être lue. Ce n’est pas un catalogue vide, c’est un catalogue inconnu."
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
          detail="La lecture a réussi et le catalogue est réellement vide : aucun projet n’est enregistré. Créer un projet avant d’ouvrir le builder."
        />
      </div>
    )
  }

  return (
    <ul className="divide-y aig-line-soft">
      {items.map((item) => (
        <ProjectRow key={item.id} item={item} />
      ))}
    </ul>
  )
}

export default function BuilderSelectScreen({
  items,
  unreadable = false,
  failure,
}: Readonly<{
  items: readonly ProjectChoice[]
  unreadable?: boolean
  failure?: string | null
}>) {
  return (
    <>
      <PageHeader
        title="Builder"
        description="Conversation d’authoring : architecte, manifeste, matérialisation d’un agent."
      />
      <PageBody className="gap-3">
        <Panel
          title="Choisir un projet"
          hint={unreadable ? 'lecture échouée' : projectCountLabel(items.length)}
          padded={false}
        >
          <ProjectListBody unreadable={unreadable} failure={failure} items={items} />
        </Panel>

        <Divider soft />
        <Text className="aig-text-faint text-xs">
          La conversation d’authoring est persistée par projet : rouvrir un projet reprend le fil
          exactement où il s’est arrêté, y compris une décision humaine restée en attente.
        </Text>
      </PageBody>
    </>
  )
}
