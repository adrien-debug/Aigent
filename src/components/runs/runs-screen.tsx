/**
 * Écran « Runs » — le POSTE D'EXPLOITATION de la flotte.
 *
 * CE QUI A CHANGÉ, ET POURQUOI. L'écran empilait quatre blocs de MÊME POIDS
 * VISUEL : un panneau de six mesures, une grille de panneaux Grafana, la
 * provenance, puis le maître-détail. Même fond, même liseré, même rayon partout
 * — donc aucun point d'entrée pour le regard, et un opérateur qui devait lire
 * les quatre blocs pour savoir lequel comptait.
 *
 * La composition est maintenant ÉDITORIALE — un rang par niveau de lecture :
 *
 *   1. LE SIGNAL PRINCIPAL (`aig-stage`, une seule zone par page) — les trois
 *      mesures qui décident si on reste sur cet écran (Runs, Réussite, Latence
 *      p95) en `aig-display` grand format, à côté du panneau d'ACTIVITÉ le plus
 *      large. Ce qui est majeur est grand ; ce qui est mineur est petit à côté.
 *   2. LES ANALYSES SECONDAIRES (`aig-quiet`) — les autres panneaux Grafana,
 *      visiblement subordonnés : pas de liseré complet, densité `compact`.
 *   3. LE FLUX OPÉRATIONNEL (`aig-inset`) — la liste des runs dans un creux qui
 *      l'accueille, avec de la hauteur réelle et son propre défilement.
 *   4. LE DÉTAIL À LA DEMANDE — le run sélectionné, à côté du flux.
 *   5. LE RANG BAS — mesures secondaires (Échecs, Coût, Appels d'outils) et
 *      provenance du trafic, groupés et discrets.
 *
 * AUCUNE MESURE N'A ÉTÉ PERDUE en descendant de rang : les six restent
 * lisibles, simplement pas toutes à la même taille. Une mesure absente reste
 * absente (`Fact` rend `NotMeasured` sur `null`) — aucun `?? 0` n'existe ici.
 *
 * AUCUN GRAPHIQUE N'EST RECODÉ. Les séries appartiennent à Grafana, les
 * métriques à Prometheus. `EmbeddedVisualization` reste le seul moyen de les
 * afficher ; cet écran ne décide que de leur PLACE et de leur densité. Toute
 * visualisation reste sous un ancêtre `.viz-scope` — les variables `--viz-*` et
 * la garde `prefers-reduced-motion` y sont scopées.
 *
 * Server Component pur : il reçoit la donnée déjà lue et la distribue. La
 * sélection passe par l'URL (`/runs?run=<id>`), donc aucun état client.
 */
import type { ReactNode } from 'react'
import { navEntry } from '@/components/navigation'
import { PageBody, PageHeader } from '@/components/app-shell'
import { Fact, FactValue, NotMeasured, Unavailable } from '@/components/cockpit/primitives'
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

/**
 * Une mesure MAJEURE de la scène — grand chiffre métallique.
 *
 * `null` ne descend pas en `0` : il rend `NotMeasured`, à la taille du texte
 * courant et non à celle du chiffre, pour qu'une absence ne puisse jamais se
 * lire de loin comme une valeur.
 */
function HeadlineMeasure({
  label,
  value,
  hint,
}: Readonly<{ label: string; value: string | null; hint?: string }>) {
  return (
    <div className="min-w-0">
      <p className="aig-text-faint text-2xs tracking-[0.16em] uppercase">{label}</p>
      <p className="mt-1 min-w-0 truncate">
        {value === null ? (
          <NotMeasured />
        ) : (
          <span className="aig-display text-3xl leading-none font-semibold sm:text-4xl">
            {value}
          </span>
        )}
      </p>
      {hint ? <p className="aig-text-muted mt-1.5 truncate text-xs">{hint}</p> : null}
    </div>
  )
}

/** Une mesure de rang bas — même contrat de vérité, poids visuel réduit. */
function MinorMeasure({
  label,
  value,
  hint,
}: Readonly<{ label: string; value: string | null; hint?: string }>) {
  return (
    <Fact
      className="px-3 py-2"
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

/** Le titre d'un rang — un mot, un filet de lumière, pas un en-tête de carte. */
function RankTitle({ children, hint }: Readonly<{ children: ReactNode; hint?: string }>) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="aig-display shrink-0 text-xs font-semibold tracking-[0.16em] uppercase">
        {children}
      </h2>
      {hint ? <span className="aig-text-faint shrink-0 truncate text-2xs">{hint}</span> : null}
      <span aria-hidden className="aig-hairline min-w-0 flex-1" />
    </div>
  )
}

/**
 * ÉDITORIAL, PAS EXHAUSTIF. Le registre porte huit panneaux ; cet écran en
 * demande trois fonctions (activité, fiabilité, performance) et les répartit en
 * DEUX rangs de poids différents plutôt qu'en une grille de cadres égaux.
 *
 * Le panneau qui ouvre la scène est le plus large disponible (`aspectRatio` le
 * plus grand) : un panneau large écrasé perd ses axes, donc il prend la place
 * qu'il déclare. Tous les autres descendent en second rang, en `compact`.
 */
function splitVisualizations(visualizations: readonly ResolvedVisualization[]): {
  lead: ResolvedVisualization | null
  secondary: readonly ResolvedVisualization[]
} {
  if (visualizations.length === 0) return { lead: null, secondary: [] }

  let lead = visualizations[0]!
  for (const viz of visualizations) {
    if (viz.aspectRatio > lead.aspectRatio) lead = viz
  }
  return { lead, secondary: visualizations.filter((viz) => viz.id !== lead.id) }
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
  const windowHint = windowPanelHint(capped, runs.length, windowRunCount)
  const { lead, secondary } = splitVisualizations(visualizations)

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
            <HeaderMeta label="Runs" value={windowHint} />
            {windowTruncated ? (
              <HeaderMeta label="Plafond" value={`${tableRowCap} lignes`} />
            ) : null}
          </>
        }
      />

      <PageBody className="viz-scope">
        {/* ══ RANG 1 — LE SIGNAL PRINCIPAL ══════════════════════════════════
            Une seule `aig-stage` par page. Les trois mesures qui décident si
            l'opérateur reste ici, en grand, contre le panneau d'activité le
            plus large. Le liseré cuivre ouvre la zone ; il n'entoure rien. */}
        <section
          className="aig-stage aig-accent-edge grid gap-x-8 gap-y-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]"
          aria-label="Signal principal de la fenêtre"
        >
          <div className="flex min-w-0 flex-col gap-5">
            <div className="min-w-0">
              <h2 className="aig-display text-base font-semibold">État de la fenêtre</h2>
              <p className="aig-text-muted mt-1 text-xs">{windowHint}</p>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-1">
              <HeadlineMeasure label="Runs" value={String(metrics.total)} hint="rendus" />
              <HeadlineMeasure
                label="Réussite"
                value={metrics.successRate === null ? null : formatPercent(metrics.successRate)}
                hint={
                  metrics.terminal === 0
                    ? 'aucun run terminal'
                    : terminalSuccessHint(metrics.terminal)
                }
              />
              <HeadlineMeasure
                label="Latence p95"
                value={formatDuration(metrics.p95LatencyMs)}
                hint={`${metrics.measuredLatencyRuns} mesuré(s)`}
              />
            </div>
          </div>

          {/* Le panneau d'activité le plus large. Absent quand aucune source
              n'est configurée : la scène tient sur ses mesures seules plutôt
              que d'afficher un cadre vide. */}
          {lead ? (
            <div className="aig-inset min-w-0 self-start p-2">
              <EmbeddedVisualization visualization={lead} density="compact" />
            </div>
          ) : null}
        </section>

        {/* ══ RANG 2 — LES ANALYSES SECONDAIRES ═════════════════════════════
            Subordonnées et lisibles comme telles : `aig-quiet`, sans liseré
            complet, densité compacte. Pas huit cadres égaux. */}
        {secondary.length > 0 ? (
          <section className="flex flex-col gap-2" aria-label="Analyses de la fenêtre">
            <RankTitle hint="fiabilité · performance">Analyses</RankTitle>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
              {secondary.map((viz) => (
                <div key={viz.id} className="aig-quiet min-w-0 p-2">
                  <EmbeddedVisualization visualization={viz} density="compact" />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ══ RANG 3 & 4 — LE FLUX, PUIS LE DÉTAIL ══════════════════════════
            La liste vit dans un creux qui l'accueille et prend de la hauteur
            réelle : elle défile chez elle, la page ne s'allonge pas avec la
            fenêtre de runs. */}
        <section
          className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]"
          aria-label="Flux des runs et détail"
        >
          <div className="flex min-w-0 flex-col gap-2">
            <RankTitle hint={windowTruncated ? 'fenêtre plafonnée' : windowHint}>Flux</RankTitle>
            <div className="aig-inset scroll-thin min-h-0 max-h-[34rem] overflow-y-auto">
              {runs.length === 0 ? (
                <div className="p-4">
                  <Unavailable
                    reason="no-data"
                    detail="Aucun run opérationnel sur les dernières 24 heures. La lecture a réussi — la fenêtre est réellement vide."
                  />
                </div>
              ) : (
                <RunList
                  runs={runs}
                  agentNameById={agentNameById}
                  selectedRunId={selected?.id ?? null}
                  buildHref={buildHref}
                />
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <RankTitle hint={selected ? 'run sélectionné' : undefined}>Détail</RankTitle>
            <div className="aig-panel scroll-thin min-h-0 max-h-[34rem] overflow-y-auto">
              {detailPanel}
            </div>
          </div>
        </section>

        {/* ══ RANG 5 — LE BAS DE PAGE ═══════════════════════════════════════
            Les mesures secondaires et la provenance : conservées entières,
            groupées, sans le chrome d'un panneau plein. */}
        <section className="flex flex-col gap-2" aria-label="Mesures secondaires et provenance">
          <RankTitle>Contexte</RankTitle>
          <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="aig-quiet grid min-w-0 grid-cols-1 gap-y-1 p-1 sm:grid-cols-3 xl:grid-cols-1">
              <MinorMeasure
                label="Échecs"
                value={String(metrics.failed)}
                hint={`${metrics.blocked} bloqué(s)`}
              />
              <MinorMeasure
                label="Coût mesuré"
                value={metrics.measuredCostUsd === null ? null : formatUsd(metrics.measuredCostUsd)}
                hint={
                  metrics.unmeasuredCostRuns > 0
                    ? `${metrics.unmeasuredCostRuns} run(s) sans coût`
                    : 'tous les runs mesurés'
                }
              />
              <MinorMeasure
                label="Appels d'outils"
                value={String(metrics.totalToolCalls)}
                hint={
                  metrics.unsafeAttemptRuns > 0
                    ? `${metrics.unsafeAttemptRuns} run(s) unsafe`
                    : undefined
                }
              />
            </div>

            <TrafficProvenance breakdown={provenance} />
          </div>
        </section>

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
