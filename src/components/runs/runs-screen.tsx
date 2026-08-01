/**
 * Écran « Runs » — la surface opérateur globale.
 *
 * CE QUE CET ÉCRAN EST DEVENU. C'était une table plus six mesures dans une
 * boîte. C'est maintenant une surface qui répond, dans cet ordre, aux quatre
 * questions qu'un opérateur se pose en arrivant :
 *
 *   1. « est-ce que ça tourne, et est-ce que ça tient ? »  → le bandeau de
 *      mesures, dérivé d'UNE seule source (`deriveRunsMetrics`) ;
 *   2. « à quoi ressemble la fenêtre ? »                   → la bande de
 *      visualisations Grafana (activité, fiabilité, performance) ;
 *   3. « d'où vient le trafic ? »                          → la provenance ;
 *   4. « que s'est-il passé sur CE run ? »                  → le maître-détail.
 *
 * L'ordre n'est pas décoratif : il va du global au particulier, et chaque
 * niveau est lisible sans avoir lu le suivant.
 *
 * AUCUN GRAPHIQUE N'EST RECODÉ ICI. Les séries appartiennent à Grafana,
 * les métriques à Prometheus. Aigent possède l'enveloppe — titre, hiérarchie,
 * provenance, état de vérité. Un panneau dont la source est muette rend un état
 * honnête, jamais un cadre vide sous un badge vert.
 *
 * Server Component pur : il reçoit la donnée déjà lue et la distribue. La
 * sélection passe par l'URL (`/runs?run=<id>`), donc aucun état client.
 */
import type { ReactNode } from 'react'
import { navEntry } from '@/components/navigation'
import { PageBody, PageHeader } from '@/components/app-shell'
import { Fact, FactValue, Panel, Unavailable } from '@/components/cockpit/primitives'
import EmbeddedVisualization from '@/components/visualizations/embedded-visualization'
import type { ResolvedVisualization } from '@/components/visualizations/embed/contract'
import type { AgentRun } from '@/lib/agent-mission-control/types'
import type { RunsMetrics } from '@/lib/runs-console/runs-metrics'
import { formatDuration, formatPercent } from '@/lib/runs-console/runs-metrics'
import { formatUsd } from '@/lib/agent-mission-control/format'
import RunDetail from './run-detail'
import RunList from './run-list'
import TrafficProvenance from './traffic-provenance'
import { resolveSelectedRun } from './run-view-model'
import type { ProvenanceBreakdown } from './run-view-model'

const ENTRY = navEntry('/runs')

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

/** Une mesure du bandeau, dans un `Fact` (`labelUppercase` reprend le style d'origine). */
function Measure({
  label,
  value,
  hint,
}: Readonly<{ label: string; value: string | null; hint?: string }>) {
  return (
    <Fact
      className="px-3 py-2.5"
      label={label}
      labelUppercase
      value={value === null ? null : <FactValue>{value}</FactValue>}
      hint={hint}
    />
  )
}

/**
 * Une information de contexte de l'en-tête — la fenêtre, le plafond.
 *
 * Elle vit dans le `meta` du `PageHeader` plutôt que dans un panneau : c'est la
 * portée de TOUT ce qui est dessous. La reléguer dans une boîte laisserait
 * croire qu'elle ne qualifie que cette boîte.
 */
function HeaderMeta({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <span className="flex items-baseline gap-1.5 text-xs">
      <span className="aig-text-faint uppercase tracking-[0.14em]">{label}</span>
      <span className="aig-text-muted tabular-nums">{value}</span>
    </span>
  )
}

/**
 * La bande de visualisations — les panneaux Grafana rangés par fonction.
 *
 * ÉDITORIAL, PAS EXHAUSTIF. Le registre porte huit panneaux ; cet écran en
 * montre ceux qui servent la lecture d'une FENÊTRE DE RUNS (activité,
 * fiabilité, performance) et laisse la répartition par agent à la surface qui
 * parle des agents. Empiler les huit ici produirait un mur que personne ne lit.
 *
 * La grille suit le ratio déclaré par chaque panneau : un panneau large
 * (`21/9`, la latence) prend toute la largeur, les autres se rangent par deux.
 * Un panneau écrasé perd ses axes — c'est pour ça que le ratio est dans le
 * registre et pas dans la page.
 */
function VisualizationBand({
  visualizations,
}: Readonly<{ visualizations: readonly ResolvedVisualization[] }>) {
  if (visualizations.length === 0) return null

  const wide = visualizations.filter((v) => v.aspectRatio >= 2)
  const standard = visualizations.filter((v) => v.aspectRatio < 2)

  return (
    <section className="viz-scope flex flex-col gap-3" aria-label="Visualisations de la fenêtre">
      {standard.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {standard.map((viz) => (
            <EmbeddedVisualization key={viz.id} visualization={viz} density="compact" />
          ))}
        </div>
      ) : null}
      {wide.map((viz) => (
        <EmbeddedVisualization key={viz.id} visualization={viz} />
      ))}
    </section>
  )
}

export default function RunsScreen({
  runs,
  metrics,
  agentNameById,
  projectNameById,
  selectedRunId,
  provenance,
  visualizations,
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
  /** Panneaux déjà résolus côté serveur. Vide = aucune source configurée. */
  visualizations: readonly ResolvedVisualization[]
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
    <>
      <PageHeader
        title={ENTRY.name}
        description={ENTRY.purpose}
        meta={
          <>
            <HeaderMeta label="Fenêtre" value="24 h" />
            <HeaderMeta label="Runs" value={windowPanelHint(capped, runs.length, windowRunCount)} />
            {windowTruncated ? (
              <HeaderMeta label="Plafond" value={`${tableRowCap} lignes`} />
            ) : null}
          </>
        }
      />

      <PageBody>
        {/* ── Ce qui tient ou ne tient pas, en six mesures ── */}
        <Panel
          title="État de la fenêtre"
          hint={windowPanelHint(capped, runs.length, windowRunCount)}
          padded={false}
          bodyClassName="grid grid-cols-2 divide-x divide-y sm:grid-cols-3 xl:grid-cols-6 xl:divide-y-0 [&>*]:aig-line-soft"
        >
          <Measure label="Runs" value={String(metrics.total)} hint="rendus" />
          <Measure
            label="Réussite"
            value={metrics.successRate === null ? null : formatPercent(metrics.successRate)}
            hint={
              metrics.terminal === 0 ? 'aucun run terminal' : terminalSuccessHint(metrics.terminal)
            }
          />
          <Measure
            label="Échecs"
            value={String(metrics.failed)}
            hint={`${metrics.blocked} bloqué(s)`}
          />
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
            hint={
              metrics.unsafeAttemptRuns > 0
                ? `${metrics.unsafeAttemptRuns} run(s) unsafe`
                : undefined
            }
          />
        </Panel>

        {/* ── Les séries, telles que Grafana les dessine ── */}
        <VisualizationBand visualizations={visualizations} />

        {/* ── Provenance du trafic — l'affirmation interne / consommateur ── */}
        <TrafficProvenance breakdown={provenance} />

        {/* ── Maître-détail — le particulier, après le global ── */}
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

          <Panel title="Détail du run" className="min-w-0" padded={false}>
            {detailPanel}
          </Panel>
        </div>

        {/* Lecture partiellement dégradée : les runs sont réels, les libellés non
            tous résolus. On le DIT plutôt que d'afficher des ids en silence. */}
        {degradedDetail ? (
          <p className="aig-panel-raised aig-accent truncate px-3 py-2 font-mono text-2xs">
            Libellés partiellement indisponibles — {degradedDetail}
          </p>
        ) : null}
      </PageBody>
    </>
  )
}
