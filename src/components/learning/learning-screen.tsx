/**
 * L'écran Learning — supervision, revue, évaluations, connaissance.
 *
 * Server Component : il ne fait aucune lecture, il rend ce que la page lui
 * passe. Les seuls fragments clients sont les commandes Obsidian, parce
 * qu'elles ont besoin de `window.location.origin` pour écrire des liens de
 * preuve cliquables depuis le vault.
 *
 * CE QUE CET ÉCRAN REFUSE DE FAIRE
 * --------------------------------
 * · Rendre une absence comme un zéro. `runsInWindow === null` veut dire « la
 *   fenêtre n'a pas été lue », jamais « zéro run ». Les deux cas ont des rendus
 *   VISUELLEMENT différents : `Unavailable reason="unread"` contre une valeur.
 * · Dessiner un faux graphe LangGraph. La mission l'interdit explicitement et
 *   c'est juste : un diagramme inventé est pire qu'une absence de diagramme.
 * · Afficher une zone Datasets / Training / Models vide. Ces capacités
 *   n'existent pas encore ; elles sont DÉCRITES dans le bloc runtime, ce qui
 *   est honnête, plutôt que suggérées par des écrans creux.
 *
 * LARGEUR MOBILE — deux causes distinctes, toutes deux mesurées
 * -------------------------------------------------------------
 * Les panneaux débordaient du viewport à 360-375 px (496 px de large pour 343
 * disponibles). DEUX causes, corrigées séparément :
 *
 * 1. `min-width: auto` sur les items de grille. C'est le défaut CSS : un enfant
 *    de `grid` refuse de rétrécir SOUS la largeur de son contenu, donc un
 *    panneau restait à 383 px dans une grille de 328. D'où `[&>*]:min-w-0` sur
 *    les deux grilles de cet écran — la cause racine, celle qui tenait le plus
 *    de pixels.
 * 2. Les slots `hint` et `actions` de `Panel` sont `shrink-0` : ils refusent
 *    aussi de rétrécir, et un libellé long y impose sa largeur au panneau
 *    entier. `Panel` sert sept surfaces, on ne le modifie pas pour un écran :
 *    les hints d'ici restent COURTS, et ce qui est long (horodatage, liste des
 *    signaux, lien vers la file) vit dans le corps ou le pied, où le texte
 *    revient à la ligne.
 */
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageBody, PageHeader } from '@/components/app-shell'
import { Divider } from '@/components/ui/divider'
import { Subheading } from '@/components/ui/heading'
import { Strong, Text } from '@/components/ui/text'
import { Unavailable } from '@/components/cockpit/primitives'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import { QUEUE_KIND_LABEL, type OperatorQueueKind } from '@/lib/agent-mission-control/operator-queue'
import type { LearningOverview } from '@/lib/agent-mission-control/learning-overview'
import type { LearningRuntimeStatus } from '@/lib/agent-mission-control/learning-runtime'
import type { TelemetryHealthStatus } from '@/lib/agent-mission-control/telemetry-health'
import type { ObsidianConfig } from '@/lib/agent-mission-control/obsidian-bridge'
import { ObsidianCommands } from './obsidian-buttons'

/* ───────────────────────── Zone 1 — Supervision ───────────────────────── */

/**
 * Les cinq états du canal de télémétrie, tels que `telemetry-health.ts` les
 * définit — pas une échelle inventée ici.
 *
 * `unavailable` n'est PAS `loop_muted` : l'un dit « je n'ai pas pu savoir »,
 * l'autre « la boucle est silencieuse depuis N jours ». Les confondre en une
 * seule pastille rouge effacerait exactement la distinction que ce module
 * existe pour tenir.
 */
const TELEMETRY_LABEL: Record<TelemetryHealthStatus, string> = {
  healthy: 'sain',
  loop_muted: 'boucle muette',
  incomplete_configuration: 'configuration incomplète',
  not_configured: 'non configuré',
  unavailable: 'indisponible',
}

const TELEMETRY_COLOR: Record<TelemetryHealthStatus, 'emerald' | 'amber' | 'zinc'> = {
  healthy: 'emerald',
  loop_muted: 'amber',
  incomplete_configuration: 'amber',
  not_configured: 'zinc',
  unavailable: 'zinc',
}

/**
 * Une mesure, ou son absence QUALIFIÉE.
 *
 * `value === null` n'est jamais rendu « 0 » ni « — » : il porte un badge et sa
 * raison. C'est la seule façon pour un opérateur de distinguer une flotte
 * calme d'une lecture tombée.
 */
function Measure({
  label,
  value,
  unreadReason,
}: Readonly<{ label: string; value: number | null; unreadReason: string }>) {
  return (
    <div className="min-w-0">
      {value === null ? (
        <>
          {/* L'absence garde son badge et sa raison : c'est le seul rendu qui
              distingue une flotte calme d'une lecture tombée. Elle n'emprunte
              PAS la taille du grand chiffre — un « indisponible » à 36 px se
              lirait comme une mesure. */}
          <Badge color="zinc">{UNAVAILABLE_LABEL}</Badge>
          <Text className="aig-text-muted mt-1.5 truncate text-sm">{label}</Text>
          <Text className="aig-text-faint mt-0.5 text-xs">{unreadReason}</Text>
        </>
      ) : (
        <>
          <div className="aig-display text-3xl font-semibold tabular-nums sm:text-4xl">{value}</div>
          <Text className="aig-text-muted mt-1 truncate text-sm">{label}</Text>
        </>
      )}
    </div>
  )
}

/**
 * LA SUPERVISION — la zone dominante de cette route.
 *
 * Elle était un `Panel` parmi quatre, de rang strictement égal à « Évaluations »
 * (qui n'a rien à montrer) et à « Connaissance » (qui est une liste de liens).
 * Elle prend la scène : c'est la seule zone de l'écran qui porte des mesures
 * réelles de la flotte.
 */
function SupervisionZone({ overview }: Readonly<{ overview: LearningOverview }>) {
  const { supervision } = overview
  const runs = supervision.runsInWindow
  const unread = "La fenêtre de runs n'a pas pu être lue — ce n'est pas une absence d'activité."

  const inFlight = runs === null ? null : runs.filter((run) => run.status === 'running').length
  const awaiting =
    runs === null ? null : runs.filter((run) => run.status === 'needs-confirmation').length

  return (
    <section className="aig-stage aig-accent-edge p-5 sm:p-6" aria-label="Supervision">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Text className="aig-text-faint text-2xs font-medium uppercase tracking-[0.18em]">
          Supervision
        </Text>
        <Text className="aig-text-faint text-xs">fenêtre 24 h</Text>
      </div>

      {/* Un `0` MESURÉ doit se distinguer d'une absence de lecture, sinon les
          deux se lisent pareil. La provenance est donc dite explicitement :
          « lecture réussie » quand la fenêtre a répondu, même vide. */}
      <Text className="aig-text-muted mt-2 text-xs">
        {runs === null
          ? 'Lecture de la fenêtre impossible — les compteurs ci-dessous sont indisponibles, pas nuls.'
          : `Lecture réussie au ${new Date(supervision.asOf).toLocaleString('fr-FR')} : ${runs.length} run(s) dans la fenêtre. Un 0 ci-dessous est une mesure, pas une absence de lecture.`}
      </Text>

      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Measure
          label="Runs (24 h)"
          value={runs === null ? null : runs.length}
          unreadReason={unread}
        />
        <Measure label="Échecs" value={supervision.failedRunsInWindow} unreadReason={unread} />
        <Measure label="En vol" value={inFlight} unreadReason={unread} />
        <Measure label="En attente d'accord" value={awaiting} unreadReason={unread} />
      </div>

      <div className="aig-hairline my-5" />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Text className="aig-text-faint text-xs uppercase">Canal de télémétrie</Text>
            <Badge color={TELEMETRY_COLOR[supervision.telemetryHealth.status]}>
              {TELEMETRY_LABEL[supervision.telemetryHealth.status]}
            </Badge>
            {supervision.recentTelemetryEvents === null ? (
              <Badge color="zinc">flux non lu</Badge>
            ) : (
              <Text className="aig-text-muted text-xs">
                {supervision.recentTelemetryEvents.length} événement(s) récent(s)
              </Text>
            )}
          </div>
          {/* `summary` est rédigé par `telemetry-health.ts` et documenté « safe to
              render as-is ». Il n'affirme JAMAIS une activité d'agent — seulement
              l'état de la boucle et de sa configuration. On le rend tel quel
              plutôt que de le paraphraser et d'en perdre la nuance. */}
          <Text className="aig-text-muted mt-2 max-w-2xl text-sm">
            {supervision.telemetryHealth.summary}
          </Text>
        </div>

        {overview.dataWarnings.length > 0 ? (
          <ul className="aig-quiet min-w-0 list-disc space-y-1 py-2 pr-3 pl-8 lg:max-w-sm lg:shrink-0">
            {overview.dataWarnings.map((warning) => (
              <li key={warning}>
                <Text className="aig-text-muted text-xs">{warning}</Text>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}

/* ─────────────────────── Zone 2 — File de revue ───────────────────────── */

/**
 * Nombre de lignes montrées ici. `/actions` porte la file entière ; cette zone
 * en est un aperçu, et le pied de panneau DIT combien de lignes il ne montre
 * pas — une troncature muette se lirait comme une file courte.
 */
const REVIEW_QUEUE_PREVIEW = 12

function ReviewQueueZone({ overview }: Readonly<{ overview: LearningOverview }>) {
  const items = overview.reviewQueue.items

  // Ni `hint` ni `actions` dans l'en-tête. Le titre et son compte vivent sur une
  // ligne qui WRAPPE : titre + bouton imposaient 399 px de large pour 360
  // disponibles au viewport 360. Le lien et l'état de la file descendent dans
  // le pied du creux, qui wrappe aussi.
  return (
    <section className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 pb-3">
        <Subheading level={2}>File de revue</Subheading>
        <Text className="aig-text-muted text-sm">{items.length} ligne(s)</Text>
      </div>

      {/* La file est un FLUX : elle descend dans un creux qui l'accueille, avec
          de la hauteur réelle, plutôt que d'être posée sur une carte de rang
          égal au reste de l'écran. Box bornée, la donnée défile dedans. */}
      <div className="aig-inset min-w-0">
        {items.length === 0 ? (
          <div className="p-4">
            <Unavailable
              reason="no-data"
              detail="Aucune action en attente. Les sources ont été lues : file vide mesurée."
            />
          </div>
        ) : (
          // Le séparateur prend le liseré doux de la grammaire : il n'y a plus de
          // paire claire/sombre à arbitrer, le document est graphite partout.
          <ul className="divide-y divide-[color:var(--aig-line-soft)]">
            {items.slice(0, REVIEW_QUEUE_PREVIEW).map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color={item.kind === 'data_unavailable' ? 'zinc' : 'amber'}>
                      {QUEUE_KIND_LABEL[item.kind as OperatorQueueKind] ?? item.kind}
                    </Badge>
                  </div>
                  <Strong className="mt-1 block truncate">{item.title}</Strong>
                  <Text className="aig-text-muted truncate text-xs">{item.meta}</Text>
                </div>
                <Button plain href={item.href} className="shrink-0">
                  Ouvrir
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* Provenance et troncature, dites explicitement. Un extrait qui ne
            s'annonce pas comme extrait se lit comme la file entière — et la
            mission interdit précisément ce genre de silence. */}
        <div className="aig-line-soft flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
          <Text className="aig-text-muted text-xs">
            {overview.reviewQueue.isFullQueue ? 'File complète' : 'Extrait de la file'}
            {items.length > REVIEW_QUEUE_PREVIEW
              ? ` · ${REVIEW_QUEUE_PREVIEW} des ${items.length} ligne(s) affichée(s) ici`
              : ` · ${items.length} ligne(s)`}
          </Text>
          <Button plain href="/actions">
            Ouvrir la file
          </Button>
        </div>
      </div>
    </section>
  )
}

/* ───────────────────────── Zone 3 — Évaluations ───────────────────────── */

/**
 * Évaluations — une zone qui n'a RIEN de mesuré à montrer.
 *
 * Elle occupait un `Panel` complet, de rang égal à la supervision qui, elle,
 * porte de vraies mesures. Elle passe au second rang (`aig-quiet`) : présente,
 * lisible, subordonnée. C'est exactement l'écart qu'elle décrit — les cinq
 * signaux existent, ailleurs.
 */
function EvaluationsZone({ overview }: Readonly<{ overview: LearningOverview }>) {
  return (
    <div className="aig-quiet p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Subheading level={3}>Évaluations</Subheading>
        <Text className="aig-text-faint text-xs">5 signaux</Text>
      </div>

      {/* `Unavailable` centre son détail sur ~34 caractères — bon pour une
          cellule, illisible pour ce paragraphe. On garde donc sa MARQUE
          (le badge « Aucune mesure », qui porte le sens) et on rend la raison
          en texte aligné à gauche, à sa mesure. */}
      {/* La marque d'absence en TÊTE, pas centrée face au paragraphe : le badge
          porte le verdict, la raison le développe en dessous. Centré, il se
          lisait comme une puce de liste au milieu du texte. */}
      <div className="mt-3">
        {/* `Unavailable compact` est un bloc qui CENTRE son contenu : posé seul
            il s'étirait sur toute la largeur et sa marque flottait au milieu.
            Un conteneur `inline-block` le borne à la largeur de son contenu
            sans toucher au composant, qui sert sept surfaces. */}
        <div className="inline-block">
          <Unavailable reason="no-data" compact />
        </div>
        <Text className="aig-text-muted mt-2 text-sm">{overview.evaluations.reason}</Text>
      </div>

      <Text className="aig-text-muted mt-3 text-xs">
        Les cinq signaux — tests, benchmarks, shadow, replay, release gate — existent et sont mesurés
        par agent, là où leur coût se paie une seule fois : ouvrez la fiche d’un agent ou la surface
        Qualification.
      </Text>
    </div>
  )
}

/* ──────────────── Zone 4 — Connaissance & Learning Runtime ─────────────── */

/**
 * Les quatre états du Learning Runtime.
 *
 * `unavailable` prend `UNAVAILABLE_LABEL` plutôt qu'une chaîne écrite ici : le
 * repo n'épelle le mot d'absence QU'À UN SEUL endroit (`format.ts`), et une
 * gate le vérifie (`cost-truth.test.ts`). C'est ce qui a empêché les deux
 * orthographes de l'absence de diverger la première fois.
 */
const RUNTIME_LABEL: Record<LearningRuntimeStatus, string> = {
  live: 'Live',
  partial: 'Partiel',
  unavailable: UNAVAILABLE_LABEL,
  not_configured: 'Non connecté',
}

const RUNTIME_COLOR: Record<LearningRuntimeStatus, 'emerald' | 'amber' | 'red' | 'zinc'> = {
  live: 'emerald',
  partial: 'amber',
  unavailable: 'red',
  not_configured: 'zinc',
}

function KnowledgeZone({
  overview,
  obsidian,
}: Readonly<{ overview: LearningOverview; obsidian: ObsidianConfig }>) {
  const runtime = overview.learningRuntime

  return (
    // Une colonne dans la gouttière étroite du second rang, deux quand l'écran
    // n'a pas encore de colonne étroite (sous `xl`, la grille parente retombe
    // en pile pleine largeur).
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1 [&>*]:min-w-0">
      {/* Pas de `hint` en ligne avec le titre : « Connaissance (Obsidian) » est
          déjà long, et la paire dépassait de 23 px une fois la gouttière de
          contrôle fixe réservée. Le corps dit la même chose, en wrappant. */}
      <div className="aig-quiet p-4">
        <Subheading level={3}>Connaissance (Obsidian)</Subheading>
        <Text className="aig-text-muted mt-2 text-sm">
          Obsidian est le workspace éditable de l’opérateur : les revues, les incidents et les
          décisions s’y écrivent à la main. Aigent n’y lit rien et n’y écrit rien — il ouvre des
          liens.
        </Text>
        <div className="mt-4">
          <ObsidianCommands config={obsidian} />
        </div>
      </div>

      <div className="aig-quiet p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <Subheading level={3}>Learning Runtime</Subheading>
          <Text className="aig-text-faint text-xs">H-Supervised</Text>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge color={RUNTIME_COLOR[runtime.status]}>{RUNTIME_LABEL[runtime.status]}</Badge>
          {runtime.latencyMs !== null ? (
            <Text className="aig-text-muted text-xs tabular-nums">{runtime.latencyMs} ms</Text>
          ) : null}
          {runtime.endpoint ? (
            <Text className="aig-text-faint truncate text-xs">{runtime.endpoint}</Text>
          ) : null}
        </div>

        {runtime.detail ? (
          <Text className="aig-text-muted mt-2 text-sm">{runtime.detail}</Text>
        ) : null}

        <Divider soft className="my-4" />

        <Text className="aig-text-faint text-xs uppercase">Capacités</Text>
        {runtime.capabilities === null ? (
          <div className="mt-1">
            <Badge color="zinc">Non mesuré</Badge>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {runtime.capabilities.map((capability) => (
              <Badge key={capability} color="blue">
                {capability}
              </Badge>
            ))}
          </div>
        )}

        <Text className="aig-text-muted mt-4 text-xs">
          Datasets, évaluations par lot, jobs d’entraînement et registre de modèles vivront derrière
          ce contrat, dans un moteur séparé. Tant qu’il n’est pas branché, ces capacités n’ont pas
          d’écran dans Aigent — les décrire ici est honnête, leur donner une page vide ne le serait
          pas.
        </Text>
      </div>
    </div>
  )
}

/* ────────────────────────────── L'écran ───────────────────────────────── */

export default function LearningScreen({
  overview,
  obsidian,
  title,
  purpose,
}: Readonly<{
  overview: LearningOverview
  obsidian: ObsidianConfig
  title: string
  purpose: string
}>) {
  return (
    <>
      {/* Les deux liens de sortie vivaient au fond du panneau « Évaluations »,
          qui est précisément la zone qui n'a rien à montrer : les commandes de
          la surface étaient enterrées sous son état d'absence. Elles remontent
          groupées dans les actions de l'en-tête, où le shell les attend. */}
      <PageHeader
        title={title}
        description={purpose}
        actions={
          <>
            <Button outline href="/qualification">
              Qualification
            </Button>
            <Button outline href="/agents">
              Agents
            </Button>
          </>
        }
      />
      <PageBody className="gap-5">
        <SupervisionZone overview={overview} />

        {/* La file de revue tient la colonne large : c'est la seule zone de ce
            second rang qui porte de la donnée ligne à ligne. Les trois zones
            purement descriptives (évaluations, Obsidian, runtime) se rangent en
            colonne étroite à côté, en second rang. */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] [&>*]:min-w-0">
          <ReviewQueueZone overview={overview} />

          <div className="flex flex-col gap-4">
            <EvaluationsZone overview={overview} />
            <div>
              <Subheading level={2} className="sr-only">
                Connaissance et runtime
              </Subheading>
              <KnowledgeZone overview={overview} obsidian={obsidian} />
            </div>
          </div>
        </div>
      </PageBody>
    </>
  )
}
