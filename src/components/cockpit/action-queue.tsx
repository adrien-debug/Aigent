/**
 * File d'action — la colonne qui fait d'un dashboard un COCKPIT : on n'y regarde
 * pas la flotte, on y prend une décision.
 *
 * Bâtie sur Catalyst (`Badge`, `Text`, `TextLink`). Box bornée : l'en-tête est
 * fixe, seule la liste scrolle.
 */
import type { ActionItem, ActionItemKind } from '@/lib/agent-mission-control/dashboard-overview'
import { Badge } from '@/components/ui/badge'
import { Subheading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { Unavailable } from './primitives'

type BadgeColor = 'amber' | 'sky' | 'rose' | 'violet' | 'zinc'

/** Une couleur par nature de décision — le rouge est réservé à ce qui bloque. */
const KIND_COLOR: Record<ActionItemKind, BadgeColor> = {
  architect_approval: 'amber',
  ready_manual: 'sky',
  sandbox_failed: 'rose',
  release_gate_red: 'rose',
  pr_open: 'violet',
  mission_blocked: 'rose',
  data_unavailable: 'zinc',
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
      <header className="flex shrink-0 items-baseline justify-between border-b border-white/10 px-1 pb-3">
        <Subheading level={2} className="!text-xs !font-semibold !text-zinc-300">
          File d&apos;action
        </Subheading>
        <Text className="!text-xs tabular-nums !text-zinc-500">{items.length}</Text>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {items.length === 0 ? (
          <Unavailable
            reason="no-data"
            detail="Rien ne requiert de décision. C'est une mesure, pas un défaut de lecture."
          />
        ) : (
          <ul className="space-y-1.5">
            {items.map((item) => (
              <li key={item.id}>
                <a
                  href={item.href}
                  className="group block rounded-lg bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/10 transition hover:bg-white/[0.06]"
                >
                  <Badge color={KIND_COLOR[item.kind]}>{KIND_LABEL[item.kind]}</Badge>
                  <p className="mt-1.5 truncate text-sm/6 font-medium text-zinc-100">{item.title}</p>
                  <Text className="truncate !text-xs !text-zinc-500">{item.meta}</Text>
                  <p className="mt-1.5 text-xs/6 font-medium text-sky-400 group-hover:text-sky-300">
                    {item.buttonLabel} →
                  </p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
