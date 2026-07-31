/**
 * File d'action — la colonne qui fait d'un tableau de bord un COCKPIT : on n'y
 * regarde pas la flotte, on y prend une décision.
 *
 * Elle est traitée comme une colonne de commande et non comme un panneau de
 * plus : surface propre, en-tête à compteur, et une carte par décision portant
 * son rail de sévérité. Le rouge reste réservé à ce qui bloque.
 *
 * Box bornée : l'en-tête est fixe, seule la liste scrolle.
 */
import type { ActionItem, ActionItemKind } from '@/lib/agent-mission-control/dashboard-overview'
import { CompactMetricBadge, PanelHeader, Rail, Unavailable } from './primitives'

/** Une couleur par nature de décision — le rouge est réservé à ce qui bloque. */
const KIND_COLOR: Record<ActionItemKind, string> = {
  architect_approval: '#be850f',
  ready_manual: '#3d82ee',
  sandbox_failed: '#e8455f',
  release_gate_red: '#e8455f',
  pr_open: '#8e63ee',
  mission_blocked: '#e8455f',
  data_unavailable: '#6f7782',
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
      <PanelHeader
        title="File d'action"
        actions={
          <CompactMetricBadge color={items.length > 0 ? 'var(--accent-main)' : undefined}>
            {items.length}
          </CompactMetricBadge>
        }
      />

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <Unavailable
            reason="no-data"
            detail="Rien ne requiert de décision. C'est une mesure, pas un défaut de lecture."
          />
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const color = KIND_COLOR[item.kind]
              return (
                <li key={item.id}>
                  <a
                    href={item.href}
                    className="group relative block overflow-hidden rounded-lg border border-white/6 bg-raised px-3 py-2.5 pl-4 transition-colors hover:border-accent/25 hover:bg-elevated"
                  >
                    <Rail color={color} className="opacity-70 transition-opacity group-hover:opacity-100" />
                    <span
                      className="inline-flex items-center rounded border px-1.5 py-px font-mono text-[9px] tracking-[0.14em] uppercase"
                      style={{
                        color,
                        borderColor: `${color}44`,
                        background: `${color}14`,
                      }}
                    >
                      {KIND_LABEL[item.kind]}
                    </span>
                    <p className="mt-1.5 truncate text-[12.5px] font-medium text-ink">{item.title}</p>
                    <p className="truncate text-[10.5px] text-ink-faint">{item.meta}</p>
                    <p className="mt-1.5 font-mono text-[10px] tracking-wide text-accent-soft uppercase transition-colors group-hover:text-accent-bright">
                      {item.buttonLabel} →
                    </p>
                  </a>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
