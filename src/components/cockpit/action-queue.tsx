/**
 * File d'action — la colonne qui fait d'un tableau de bord un COCKPIT : on n'y
 * regarde pas la flotte, on y prend une décision.
 *
 * Composée à partir du kit `ui/` : `Link` pour la carte cliquable, `Badge` pour
 * la nature de la décision, `Strong`/`Text` pour le contenu. Le seul objet hors
 * kit est le `Rail` de sévérité, que le kit ne fournit pas.
 *
 * Box bornée : l'en-tête est fixe, seule la liste défile.
 */
import type { ComponentProps } from 'react'

import { Badge } from '@/components/ui/badge'
import { Divider } from '@/components/ui/divider'
import { Subheading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import type { ActionItem, ActionItemKind } from '@/lib/agent-mission-control/dashboard-overview'
import { Rail, Unavailable } from './primitives'

type BadgeColor = ComponentProps<typeof Badge>['color']

/** Une couleur par nature de décision — le rouge est réservé à ce qui bloque. */
const KIND_BADGE: Record<ActionItemKind, BadgeColor> = {
  architect_approval: 'amber',
  ready_manual: 'blue',
  sandbox_failed: 'red',
  release_gate_red: 'red',
  pr_open: 'purple',
  mission_blocked: 'red',
  data_unavailable: 'zinc',
}

/** La même sévérité, en valeur littérale, pour le rail (hors kit). */
const KIND_RAIL: Record<ActionItemKind, string> = {
  architect_approval: '#d97706',
  ready_manual: '#2563eb',
  sandbox_failed: '#dc2626',
  release_gate_red: '#dc2626',
  pr_open: '#9333ea',
  mission_blocked: '#dc2626',
  data_unavailable: 'rgb(161 161 170 / 0.5)',
}

const KIND_LABEL: Record<ActionItemKind, string> = {
  architect_approval: 'Approbation',
  ready_manual: 'Test manuel',
  sandbox_failed: 'Sandbox',
  release_gate_red: 'Release gate',
  pr_open: 'PR ouverte',
  mission_blocked: 'Mission bloquée',
  data_unavailable: 'Donnée absente',
}

export default function ActionQueue({ items }: { items: ActionItem[] }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0">
        <div className="flex items-center gap-3 px-4 py-3">
          <Subheading level={2}>File d&apos;action</Subheading>
          <Badge className="ml-auto" color={items.length > 0 ? 'blue' : 'zinc'}>
            {items.length}
          </Badge>
        </div>
        <Divider soft />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {items.length === 0 ? (
          <Unavailable
            reason="no-data"
            detail="Rien ne requiert de décision. C'est une mesure, pas un défaut de lecture."
          />
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="relative block overflow-hidden rounded-lg py-3 pr-3 pl-4 ring-1 ring-zinc-950/5 data-hover:bg-zinc-950/2.5 dark:ring-white/10 dark:data-hover:bg-white/5"
                >
                  <Rail color={KIND_RAIL[item.kind]} />
                  <Badge color={KIND_BADGE[item.kind]}>{KIND_LABEL[item.kind]}</Badge>
                  <Strong className="mt-2 block truncate">{item.title}</Strong>
                  <Text className="truncate">{item.meta}</Text>
                  <Text className="mt-2">{item.buttonLabel} →</Text>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
