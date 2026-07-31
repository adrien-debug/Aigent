/**
 * Builder — sélection du projet, la porte d'entrée de la surface.
 *
 * Server Component : il reçoit des lignes déjà qualifiées par `./model` et les
 * rend. Aucune lecture ici, aucune mutation.
 *
 * POURQUOI UN PROJET D'ABORD
 * --------------------------
 * La conversation d'authoring est PERSISTÉE PAR PROJET
 * (`project_builder_conversations.project_id`) et l'architecte lit le dépôt lié
 * pour proposer un agent qui colle au code réel. Sans projet, il n'y a ni fil à
 * reprendre ni dépôt à lire — la surface n'aurait rien à montrer.
 *
 * ZÉRO-SCROLL : la page est `h-full overflow-hidden` ; c'est la liste qui défile
 * dans sa box bornée.
 */
import Link from 'next/link'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Divider } from '@/components/ui/divider'
import { Heading } from '@/components/ui/heading'
import { Strong, Text } from '@/components/ui/text'
import { Panel, Rail, Unavailable, initialsOf } from '@/components/cockpit/primitives'
import type { ProjectChoice } from './model'

const MUTED_RAIL = 'rgb(161 161 170 / 0.35)'

function ProjectRow({ item }: { item: ProjectChoice }) {
  return (
    <li className="relative border-b border-zinc-950/5 last:border-b-0 dark:border-white/5">
      <Rail color={item.repoLinked ? '#0da87f' : MUTED_RAIL} />
      <Link
        href={item.href}
        className="flex items-center gap-3 py-2.5 pr-4 pl-4 hover:bg-zinc-950/[2.5%] focus-visible:bg-zinc-950/[2.5%] focus-visible:outline-hidden dark:hover:bg-white/[2.5%] dark:focus-visible:bg-white/[2.5%]"
      >
        <Avatar square initials={initialsOf(item.name)} className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Strong className="truncate">{item.name}</Strong>
            {item.repoLinked ? null : <Badge color="zinc">aucun dépôt</Badge>}
          </div>
          {/* Pas de dépôt lié → on le DIT. L'architecte travaillera sans contexte
              de code, ce qui change la qualité de ce qu'il propose. */}
          <Text className="truncate">
            {item.repoFullName ?? 'aucun dépôt lié — l’architecte ne pourra pas lire de code'}
          </Text>
        </div>
      </Link>
    </li>
  )
}

export default function BuilderSelectScreen({
  items,
  /** `true` quand la lecture a ÉCHOUÉ — jamais quand elle est vide. */
  unreadable = false,
  failure,
}: {
  items: readonly ProjectChoice[]
  unreadable?: boolean
  failure?: string | null
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3">
      <header className="shrink-0 px-1">
        <Heading level={1}>Builder</Heading>
        <Text className="mt-1">
          Conversation d’authoring : architecte, manifeste, matérialisation d’un agent.
        </Text>
      </header>

      <Panel
        title="Choisir un projet"
        hint={unreadable ? 'lecture échouée' : `${items.length} projet${items.length > 1 ? 's' : ''}`}
        className="min-h-0 flex-1"
        padded={false}
        bodyClassName="overflow-y-auto"
      >
        {unreadable ? (
          <div className="p-4">
            <Unavailable
              reason="unread"
              detail="La liste des projets n’a pas pu être lue. Ce n’est pas un catalogue vide, c’est un catalogue inconnu."
            />
            {failure ? <Text className="mt-3 text-center font-mono text-xs">{failure}</Text> : null}
          </div>
        ) : items.length === 0 ? (
          <div className="p-4">
            <Unavailable
              reason="no-data"
              detail="La lecture a réussi et le catalogue est réellement vide : aucun projet n’est enregistré. Créer un projet avant d’ouvrir le builder."
            />
          </div>
        ) : (
          <ul>
            {items.map((item) => (
              <ProjectRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </Panel>

      <Divider soft className="shrink-0" />
      <Text className="shrink-0 px-1 text-xs">
        La conversation d’authoring est persistée par projet : rouvrir un projet reprend le fil
        exactement où il s’est arrêté, y compris une décision humaine restée en attente.
      </Text>
    </div>
  )
}
