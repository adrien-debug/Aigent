/**
 * Barre d'état du cockpit — `Navbar` du kit `ui/`, sans retouche du kit.
 *
 * Tout ce qui est affiché ici sort de `DashboardOverview` (`telemetryHealth`,
 * `telemetryReportingAgents`, `telemetryRunsMeasured`). Rien n'est inventé :
 *  · « LangGraph » n'est pas un état de santé, c'est l'invariant produit — le
 *    seul runtime exécutable (AGENTS.md § Invariants agents & runtime). Il
 *    s'affiche en neutre, parce qu'aucune sonde ne l'a interrogé au rendu.
 *  · Le canal de télémétrie, lui, EST diagnostiqué : son badge porte le statut
 *    réel, et son résumé complet reste accessible en info-bulle.
 *  · Un compteur non lu affiche « — », jamais 0.
 */
import type { ComponentProps } from 'react'

import { Badge } from '@/components/ui/badge'
import { Navbar, NavbarDivider, NavbarSection, NavbarSpacer } from '@/components/ui/navbar'
import { Strong, Text } from '@/components/ui/text'
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import type { TelemetryHealthStatus } from '@/lib/agent-mission-control/telemetry-health'

/**
 * Un badge et un mot par état du canal — jamais la couleur seule.
 *
 * Le mot d'absence vient de `UNAVAILABLE_LABEL` et n'est PAS réécrit en dur :
 * le vocabulaire de l'absence n'a qu'une orthographe dans tout le produit, et
 * `tests/unit/cost-truth.test.ts` le vérifie littéralement.
 */
const TELEMETRY_VIEW: Record<
  TelemetryHealthStatus,
  { color: ComponentProps<typeof Badge>['color']; label: string }
> = {
  healthy: { color: 'emerald', label: 'Canal actif' },
  loop_muted: { color: 'amber', label: 'Canal muet' },
  incomplete_configuration: { color: 'amber', label: 'Config partielle' },
  not_configured: { color: 'zinc', label: 'Non configuré' },
  unavailable: { color: 'zinc', label: UNAVAILABLE_LABEL },
}

/** Un compteur de télémétrie — la valeur, puis ce qu'elle compte. */
function Count({ value, unit }: { value: number | null; unit: string }) {
  return (
    <Text className="whitespace-nowrap">
      {value === null ? '—' : <Strong className="tabular-nums">{value}</Strong>} {unit}
    </Text>
  )
}

export default function TopBar({
  overview,
}: {
  overview: Pick<
    DashboardOverview,
    'telemetryHealth' | 'telemetryReportingAgents' | 'telemetryRunsMeasured'
  >
}) {
  const telemetry = TELEMETRY_VIEW[overview.telemetryHealth.status]

  return (
    <Navbar>
      <NavbarSection className="min-w-0">
        <Text className="truncate">Flotte · fenêtre 24 h glissante</Text>
      </NavbarSection>

      <NavbarSpacer />

      <NavbarSection className="hidden lg:flex">
        <Count value={overview.telemetryReportingAgents} unit="agents rapportent" />
        <NavbarDivider />
        <Count value={overview.telemetryRunsMeasured} unit="runs remontés" />
        <NavbarDivider />
        <Badge color={telemetry.color}>
          <span title={overview.telemetryHealth.summary}>{telemetry.label}</span>
        </Badge>
        <Badge color="zinc">Runtime LangGraph</Badge>
      </NavbarSection>
    </Navbar>
  )
}
