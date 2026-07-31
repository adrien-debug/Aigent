/**
 * Barre d'état du cockpit — ce qui transforme un tableau de bord en poste de
 * contrôle : avant de lire des chiffres, on lit l'état du SYSTÈME qui les
 * produit.
 *
 * Tout ce qui est affiché ici sort de `DashboardOverview` et n'était jusque-là
 * lu par personne (`telemetryHealth`, `telemetryReportingAgents`,
 * `telemetryRunsMeasured`). Rien n'est inventé :
 *  · « LangGraph » n'est pas un état de santé, c'est l'invariant produit — le
 *    seul runtime exécutable (AGENTS.md § Invariants agents & runtime). Il
 *    s'affiche en neutre, sans diode verte, parce qu'aucune sonde ne l'a
 *    interrogé au moment du rendu.
 *  · Le canal de télémétrie, lui, EST diagnostiqué : sa diode porte le statut
 *    réel, et son résumé complet reste accessible en info-bulle.
 *  · Un compteur non lu affiche « — », jamais 0.
 */
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import type { TelemetryHealthStatus } from '@/lib/agent-mission-control/telemetry-health'
import { Chip, Led } from './primitives'

/**
 * Une diode et un mot par état du canal — jamais la couleur seule.
 *
 * Le mot d'absence vient de `UNAVAILABLE_LABEL` et n'est PAS réécrit en dur :
 * le vocabulaire de l'absence n'a qu'une orthographe dans tout le produit, et
 * `tests/unit/cost-truth.test.ts` le vérifie littéralement.
 */
const TELEMETRY_VIEW: Record<TelemetryHealthStatus, { color: string; label: string }> = {
  healthy: { color: '#0da87f', label: 'Canal actif' },
  loop_muted: { color: '#be850f', label: 'Canal muet' },
  incomplete_configuration: { color: '#be850f', label: 'Config partielle' },
  not_configured: { color: '#6f7782', label: 'Non configuré' },
  unavailable: { color: '#6f7782', label: UNAVAILABLE_LABEL },
}

/** Marque Aigent : un losange creux traversé d'un éclat — pas un logo tiers. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M12 2.2 21.8 12 12 21.8 2.2 12 12 2.2Z"
        stroke="var(--accent-main)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M12 7.4 16.6 12 12 16.6 7.4 12 12 7.4Z" fill="var(--accent-main)" fillOpacity="0.9" />
    </svg>
  )
}

function Count({ value, unit }: { value: number | null; unit: string }) {
  return (
    <span className="font-mono text-[10px] tracking-tight whitespace-nowrap text-ink-faint">
      <span className={value === null ? 'text-ink-faint' : 'text-ink-dim'}>{value ?? '—'}</span> {unit}
    </span>
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
    <header className="flex h-full min-w-0 shrink-0 items-center gap-4 px-4">
      {/* Identité */}
      <div className="flex shrink-0 items-center gap-2.5">
        <Mark className="size-[18px]" />
        <span className="text-[13px] font-semibold tracking-[0.26em] text-ink">AIGENT</span>
        <span className="hidden text-[10px] font-medium tracking-[0.24em] text-ink-faint uppercase sm:inline">
          Control
        </span>
      </div>

      <span aria-hidden className="h-4 w-px shrink-0 bg-edge" />

      <div className="flex min-w-0 items-center gap-2">
        <Led color="var(--accent-main)" live />
        <span className="truncate text-[11px] tracking-[0.14em] text-ink-dim uppercase">
          Flotte · fenêtre 24 h glissante
        </span>
      </div>

      {/* État du système — mesuré, ou dit absent */}
      <div className="ml-auto hidden shrink-0 items-center gap-2 lg:flex">
        <Count value={overview.telemetryReportingAgents} unit="agents rapportent" />
        <span aria-hidden className="h-3 w-px bg-edge" />
        <Count value={overview.telemetryRunsMeasured} unit="runs remontés" />
        <span aria-hidden className="h-3 w-px bg-edge" />
        <Chip color={telemetry.color} live={overview.telemetryHealth.status === 'healthy'}>
          <span title={overview.telemetryHealth.summary}>{telemetry.label}</span>
        </Chip>
        <Chip>Runtime LangGraph</Chip>
      </div>
    </header>
  )
}
