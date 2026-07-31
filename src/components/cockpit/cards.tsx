/**
 * Cartes du cockpit — 100 % composants Catalyst officiels.
 *
 * Structure d'une carte : un en-tête d'identité (avatar + nom + statut), puis un
 * corps en `DescriptionList` — des paires fait/valeur, pas des jauges. Une jauge
 * à zéro n'est pas une donnée, c'est du remplissage ; un fait chiffré en est une.
 *
 * Respiration assumée : `p-5` / `py-3`, taille de texte par défaut de Catalyst.
 * La version précédente écrasait tout à 10px pour tenir dans le viewport — c'est
 * la compression qui rendait l'écran laid, pas la contrainte de hauteur.
 */
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@/components/ui/description-list'
import { Subheading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import type { AgentCard, ProjectCard } from '@/lib/cockpit/named-runs'
import { timeAgo } from '@/lib/cockpit/named-runs'

type BadgeColor = 'emerald' | 'amber' | 'rose' | 'sky' | 'zinc' | 'violet'

const COPILOT_STATUS: Record<string, { color: BadgeColor; label: string }> = {
  active: { color: 'emerald', label: 'Actif' },
  paused: { color: 'amber', label: 'En pause' },
  draft: { color: 'zinc', label: 'Brouillon' },
  degraded: { color: 'rose', label: 'Dégradé' },
  archived: { color: 'zinc', label: 'Archivé' },
}

/** Deux premières lettres du nom — Catalyst attend des initiales, pas une image. */
function initials(name: string | null): string {
  if (!name) return '??'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function fmtUsd(usd: number): string {
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`
}

/** Carte d'agent : un agent qui a réellement tourné sur la fenêtre. */
export function AgentGridCard({ card, nowMs }: { card: AgentCard; nowMs: number }) {
  const status = COPILOT_STATUS[card.status] ?? COPILOT_STATUS.draft
  const healthy = card.failures24h === 0

  return (
    <li className="overflow-hidden rounded-xl bg-white/[0.03] ring-1 ring-white/10">
      <div className="flex items-center gap-x-3 border-b border-white/10 bg-white/[0.02] p-4">
        <Avatar initials={initials(card.name)} className="size-9 bg-sky-500/20 text-sky-200" />
        <div className="min-w-0 flex-1">
          <Subheading level={3} className="truncate !text-sm !font-medium !text-white">
            {card.name ?? 'Agent inconnu'}
          </Subheading>
          <Text className="truncate !text-xs !text-zinc-500">{card.projectName ?? 'Sans projet'}</Text>
        </div>
        <Badge color={status.color}>{status.label}</Badge>
      </div>

      <DescriptionList className="!my-0 px-4 py-0.5 !text-sm">
        <DescriptionTerm className="!py-2 !text-zinc-400">Runs 24 h</DescriptionTerm>
        <DescriptionDetails className="!py-2 !text-white">
          <span className="tabular-nums">{card.runs24h}</span>
          {!healthy ? (
            <Badge color="rose" className="ml-2">
              {card.failures24h} en échec
            </Badge>
          ) : null}
        </DescriptionDetails>

        <DescriptionTerm className="!py-2 !text-zinc-400">Coût</DescriptionTerm>
        <DescriptionDetails className="!py-2 !text-white">
          {card.costUsd === null ? (
            <Badge color="zinc">{UNAVAILABLE_LABEL}</Badge>
          ) : (
            <span className="tabular-nums">{fmtUsd(card.costUsd)}</span>
          )}
        </DescriptionDetails>

        <DescriptionTerm className="!py-2 !text-zinc-400">Dernier run</DescriptionTerm>
        <DescriptionDetails className="!py-2 !text-zinc-300">
          {card.lastRunMs === null ? UNAVAILABLE_LABEL : timeAgo(card.lastRunMs, nowMs)}
        </DescriptionDetails>
      </DescriptionList>
    </li>
  )
}

/** Carte de projet : identité + faits mesurés. Aucune jauge. */
export function ProjectGridCard({ card }: { card: ProjectCard }) {
  return (
    <li className="overflow-hidden rounded-xl bg-white/[0.03] ring-1 ring-white/10">
      <div className="flex items-center gap-x-3 border-b border-white/10 bg-white/[0.02] p-4">
        <Avatar initials={initials(card.name)} className="size-9 bg-violet-500/20 text-violet-200" />
        <div className="min-w-0 flex-1">
          <Subheading level={3} className="truncate !text-sm !font-medium !text-white">
            {card.name}
          </Subheading>
          <Text className="truncate !text-xs !text-zinc-500">{card.repoFullName ?? 'Aucun repo lié'}</Text>
        </div>
        <Badge color={card.activeCount > 0 ? 'emerald' : 'zinc'}>
          {card.activeCount}/{card.copilotCount}
        </Badge>
      </div>

      <DescriptionList className="!my-0 px-4 py-0.5 !text-sm">
        <DescriptionTerm className="!py-2 !text-zinc-400">Runs 24 h</DescriptionTerm>
        <DescriptionDetails className="!py-2 !text-white">
          {card.runs24h === null ? (
            <Badge color="zinc">{UNAVAILABLE_LABEL}</Badge>
          ) : (
            <span className="tabular-nums">{card.runs24h}</span>
          )}
        </DescriptionDetails>

        <DescriptionTerm className="!py-2 !text-zinc-400">Coût 24 h</DescriptionTerm>
        <DescriptionDetails className="!py-2 !text-white">
          {card.costLast24hUsd === null ? (
            <Badge color="zinc">{UNAVAILABLE_LABEL}</Badge>
          ) : (
            <span className="tabular-nums">{fmtUsd(card.costLast24hUsd)}</span>
          )}
        </DescriptionDetails>

        <DescriptionTerm className="!py-2 !text-zinc-400">Taux de réussite</DescriptionTerm>
        <DescriptionDetails className="!py-2 !text-white">
          {card.passRate === null ? (
            <Badge color="zinc">{UNAVAILABLE_LABEL}</Badge>
          ) : (
            <span className="tabular-nums">{Math.round(card.passRate * 100)} %</span>
          )}
        </DescriptionDetails>
      </DescriptionList>
    </li>
  )
}
