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
 *      p95) en `aig-display` grand format, à côté d'une courbe d'ACTIVITÉ
 *      large. Ce qui est majeur est grand ; ce qui est mineur est petit à côté.
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
 * Les visualisations sont natives à l'écran et alimentées par les mêmes runs
 * persistés que les KPI et le flux. Aucune iframe n'est rendue au premier niveau.
 *
 * Server Component pur : il reçoit la donnée déjà lue et la distribue. La
 * sélection passe par l'URL (`/runs?run=<id>`), donc aucun état client.
 */
import { navEntry } from '@/components/navigation'
import { PageBody, PageHeader } from '@/components/app-shell'
import { Fact, FactValue, NotMeasured, Unavailable } from '@/components/cockpit/primitives'
import { Link } from '@/components/ui/link'
import type { AgentRun } from '@/lib/agent-mission-control/types'
import type { RunsMetrics } from '@/lib/runs-console/runs-metrics'
import { formatDuration, formatPercent } from '@/lib/runs-console/runs-metrics'
import { formatUsd } from '@/lib/agent-mission-control/format'
import RunDetail from './run-detail'
import RunList from './run-list'
import TrafficProvenance from './traffic-provenance'
import { resolveSelectedRun } from './run-view-model'
import type { ProvenanceBreakdown } from './run-view-model'
import { RunsActivityCanvas, RunsTerminalStrip, SourceGrade } from './runs-native-visuals'

const ENTRY = navEntry('/runs')

function windowPanelHint(capped: boolean, shownCount: number, windowRunCount: number): string {
  if (capped) {
    return `${shownCount} affichés sur ${windowRunCount} dans la fenêtre`
  }
  const runWord = windowRunCount > 1 ? 'runs' : 'run'
  return `${windowRunCount} ${runWord} dans la fenêtre`
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
          <span className="aig-display text-3xl leading-none font-semibold sm:text-5xl">
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
  const windowHint = windowPanelHint(capped, runs.length, windowRunCount)

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

      <PageBody className="gap-3">
        <section
          className="aig-stage aig-accent-edge flex flex-col gap-4 p-4 sm:p-5"
          aria-label="Scène principale des runs"
        >
          <div className="flex flex-wrap items-center gap-2">
            <SourceGrade grade="SNAPSHOT" label="Métriques calculées sur la fenêtre 24h" />
            <span className="aig-text-muted text-xs">{windowHint}</span>
            <span className="aig-text-faint text-xs">·</span>
            <span className="aig-text-muted text-xs">
              {selected ? `Run sélectionné: ${selected.id.slice(0, 8)}` : 'Sélectionnez un run'}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Link
                href="/runtime?tab=telemetry"
                className="aig-text-muted text-xs no-underline transition hover:text-(--aig-accent)"
              >
                Canal runtime →
              </Link>
              <Link href="/actions" className="aig-accent text-xs no-underline transition hover:opacity-80">
                File d’action →
              </Link>
            </div>
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col">
              <div className="grid grid-cols-3 gap-x-5 gap-y-4 pb-2">
                <HeadlineMeasure label="Runs" value={String(metrics.total)} hint={windowTruncated ? `plafond ${tableRowCap}` : 'fenêtre lue'} />
                <HeadlineMeasure
                  label="Réussite"
                  value={metrics.successRate === null ? null : formatPercent(metrics.successRate)}
                  hint={metrics.terminal === 0 ? 'aucun terminal' : `${metrics.completed}/${metrics.terminal}`}
                />
                <HeadlineMeasure
                  label="Latence p95"
                  value={formatDuration(metrics.p95LatencyMs)}
                  hint={`${metrics.measuredLatencyRuns} mesuré(s)`}
                />
              </div>

              <div className="aig-hairline mb-3" />

              <div>
                <RunsActivityCanvas runs={runs} nowMs={nowMs} />
              </div>

              <div className="aig-hairline my-3" />

              <div>
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
              </div>
            </div>

            <aside className="flex min-w-0 flex-col gap-3 border-l border-(--aig-line-soft) pl-4">
              <RunsTerminalStrip runs={runs} />

              <div className="aig-hairline" />

              <div className="grid grid-cols-1 gap-y-1 sm:grid-cols-3 xl:grid-cols-1">
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
                      ? `${metrics.unmeasuredCostRuns} sans coût`
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

              <div className="aig-hairline" />

              <div>
                {selected ? (
                  <RunDetail
                    run={selected}
                    agentName={agentNameById.get(selected.copilotId) ?? null}
                    projectName={selected.projectId ? (projectNameById.get(selected.projectId) ?? null) : null}
                    nowMs={nowMs}
                  />
                ) : notFound ? (
                  <Unavailable
                    reason="no-data"
                    detail={`Le run demandé n'est pas dans la fenêtre chargée. Il peut être plus ancien que 24 h, avoir été écarté par le plafond de ${tableRowCap} lignes, ou ne pas exister.`}
                  />
                ) : (
                  <Unavailable
                    reason="no-data"
                    detail="Le détail complet d’un run apparaît ici après sélection dans le flux."
                  />
                )}
                </div>
            </aside>
          </div>
        </section>

        {degradedDetail ? (
          <p className="aig-accent truncate px-1 font-mono text-2xs">
            Libellés partiellement indisponibles — {degradedDetail}
          </p>
        ) : null}
      </PageBody>
    </>
  )
}
