/**
 * Écran « Runs » — maître-détail, scroll document naturel.
 *
 * Server Component pur : il reçoit la donnée déjà lue et la distribue. Aucun
 * module client n'est nécessaire ici — la sélection passe par l'URL
 * (`/runs?run=<id>`), donc il n'y a pas d'état à tenir côté navigateur.
 *
 * La liste et le détail suivent leur hauteur réelle ; la page défiler quand le
 * contenu dépasse le viewport. Sous `xl`, la grille repasse en une colonne
 * (liste puis détail) — deux colonnes côte à côte sur ~700 px seraient illisibles.
 */
import type { ReactNode } from 'react'
import { Strong, Text } from '@/components/ui/text'
import { Panel, Unavailable } from '@/components/cockpit/primitives'
import type { AgentRun } from '@/lib/agent-mission-control/types'
import type { RunsMetrics } from '@/lib/runs-console/runs-metrics'
import { formatDuration, formatPercent } from '@/lib/runs-console/runs-metrics'
import { formatUsd } from '@/lib/agent-mission-control/format'
import RunDetail from './run-detail'
import RunList from './run-list'
import TrafficProvenance from './traffic-provenance'
import { resolveSelectedRun } from './run-view-model'
import type { ProvenanceBreakdown } from './run-view-model'

function windowPanelHint(capped: boolean, shownCount: number, windowRunCount: number): string {
  if (capped) {
    return `${shownCount} affichés sur ${windowRunCount} dans la fenêtre`
  }
  const runWord = windowRunCount > 1 ? 'runs' : 'run'
  return `${windowRunCount} ${runWord} dans la fenêtre`
}

function terminalSuccessHint(terminal: number): string {
  const word = terminal > 1 ? 'terminaux' : 'terminal'
  return `sur ${terminal} ${word}`
}

/**
 * Une mesure du bandeau. `value === null` ⇒ la mesure n'existe pas, et la tuile
 * le dit avec le mot, pas avec un tiret ambigu.
 */
function Measure({
  label,
  value,
  hint,
}: Readonly<{ label: string; value: string | null; hint?: string }>) {
  return (
    <div className="min-w-0 px-3 py-2">
      <Text className="truncate text-xs uppercase">{label}</Text>
      {value === null ? (
        <Text className="text-sm">
          <span className="text-zinc-500 uppercase dark:text-zinc-400">Non mesuré</span>
        </Text>
      ) : (
        <Strong className="block truncate text-sm tabular-nums">{value}</Strong>
      )}
      {hint ? <Text className="truncate text-xs">{hint}</Text> : null}
    </div>
  )
}

export default function RunsScreen({
  runs,
  metrics,
  agentNameById,
  projectNameById,
  selectedRunId,
  provenance,
  nowMs,
  windowRunCount,
  windowTruncated,
  tableRowCap,
  degradedDetail,
  buildHref,
}: Readonly<{
  runs: AgentRun[]
  metrics: RunsMetrics
  agentNameById: Map<string, string>
  projectNameById: Map<string, string>
  selectedRunId: string | null
  /** `null` = lecture du flux télémétrie échouée. Jamais un flux vide. */
  provenance: ProvenanceBreakdown | null
  nowMs: number
  windowRunCount: number
  windowTruncated: boolean
  tableRowCap: number
  degradedDetail: string | null
  buildHref: (runId: string) => string
}>) {
  const { run: selected, notFound } = resolveSelectedRun(runs, selectedRunId)

  // Le total de la FENÊTRE, pas la taille de la tranche rendue : afficher 200
  // quand la fenêtre en contient 640 serait un total faux.
  const capped = windowRunCount > runs.length

  let detailPanel: ReactNode
  if (notFound) {
    detailPanel = (
      <Unavailable
        reason="no-data"
        detail={`Le run demandé n'est pas dans la fenêtre chargée. Il peut être plus ancien que 24 h, avoir été écarté par le plafond de ${tableRowCap} lignes, ou ne pas exister — cet écran ne peut pas trancher.`}
      />
    )
  } else if (selected === null) {
    detailPanel = (
      <Unavailable
        reason="no-data"
        detail="Aucun run à détailler : la fenêtre ne contient aucun run."
      />
    )
  } else {
    detailPanel = (
      <RunDetail
        run={selected}
        agentName={agentNameById.get(selected.copilotId) ?? null}
        projectName={selected.projectId ? (projectNameById.get(selected.projectId) ?? null) : null}
        nowMs={nowMs}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* ── Bandeau de mesures — dérivées d'une SEULE source (`deriveRunsMetrics`) ── */}
      <Panel
        title="Fenêtre 24 h"
        hint={windowPanelHint(capped, runs.length, windowRunCount)}
        padded={false}
        bodyClassName="grid grid-cols-2 divide-x divide-zinc-950/5 sm:grid-cols-3 xl:grid-cols-6 dark:divide-white/5"
      >
        <Measure label="Runs" value={String(metrics.total)} hint="rendus" />
        <Measure
          label="Réussite"
          value={metrics.successRate === null ? null : formatPercent(metrics.successRate)}
          hint={metrics.terminal === 0 ? 'aucun run terminal' : terminalSuccessHint(metrics.terminal)}
        />
        <Measure label="Échecs" value={String(metrics.failed)} hint={`${metrics.blocked} bloqué(s)`} />
        <Measure
          label="Latence p95"
          value={formatDuration(metrics.p95LatencyMs)}
          hint={`${metrics.measuredLatencyRuns} mesuré(s)`}
        />
        <Measure
          label="Coût mesuré"
          value={metrics.measuredCostUsd === null ? null : formatUsd(metrics.measuredCostUsd)}
          hint={
            metrics.unmeasuredCostRuns > 0
              ? `${metrics.unmeasuredCostRuns} run(s) sans coût`
              : 'tous les runs mesurés'
          }
        />
        <Measure
          label="Appels d'outils"
          value={String(metrics.totalToolCalls)}
          hint={metrics.unsafeAttemptRuns > 0 ? `${metrics.unsafeAttemptRuns} run(s) unsafe` : undefined}
        />
      </Panel>

      {/* ── Provenance du trafic — l'affirmation interne / consommateur ── */}
      <TrafficProvenance breakdown={provenance} />

      {/* ── Maître-détail ── */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.25fr]">
        <Panel
          title="Runs"
          hint={windowTruncated ? 'fenêtre plafonnée' : undefined}
          className="min-w-0"
          padded={false}
        >
          {runs.length === 0 ? (
            <Unavailable
              reason="no-data"
              detail="Aucun run opérationnel sur les dernières 24 heures. La lecture a réussi — la fenêtre est réellement vide."
            />
          ) : (
            <RunList
              runs={runs}
              agentNameById={agentNameById}
              selectedRunId={selected?.id ?? null}
              buildHref={buildHref}
            />
          )}
        </Panel>

        <Panel
          title="Détail du run"
          className="min-w-0"
          padded={false}
        >
          {detailPanel}
        </Panel>
      </div>

      {/* Lecture partiellement dégradée : les runs sont réels, les libellés non
          tous résolus. On le DIT plutôt que d'afficher des ids en silence. */}
      {degradedDetail ? (
        <p className="truncate rounded-md border border-[#be850f]/25 bg-[#be850f]/8 px-3 py-1.5 font-mono text-[10.5px] text-[#d9a635]">
          Libellés partiellement indisponibles — {degradedDetail}
        </p>
      ) : null}
    </div>
  )
}
