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
import { Divider } from '@/components/ui/divider'
import { Heading, Subheading } from '@/components/ui/heading'
import { Strong, Text } from '@/components/ui/text'
import { Panel, Unavailable } from '@/components/cockpit/primitives'
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
      <Text className="truncate text-xs uppercase">{label}</Text>
      {value === null ? (
        <div className="mt-1">
          <Badge color="zinc">{UNAVAILABLE_LABEL}</Badge>
          <Text className="mt-1 text-xs">{unreadReason}</Text>
        </div>
      ) : (
        <Strong className="mt-1 block text-2xl tabular-nums">{value}</Strong>
      )}
    </div>
  )
}

function SupervisionZone({ overview }: Readonly<{ overview: LearningOverview }>) {
  const { supervision } = overview
  const runs = supervision.runsInWindow
  const unread = "La fenêtre de runs n'a pas pu être lue — ce n'est pas une absence d'activité."

  const inFlight = runs === null ? null : runs.filter((run) => run.status === 'running').length
  const awaiting = runs === null ? null : runs.filter((run) => run.status === 'needs-confirmation').length

  return (
    <Panel title="Supervision" hint="fenêtre 24 h">
      {/* Un `0` MESURÉ doit se distinguer d'une absence de lecture, sinon les
          deux se lisent pareil. La provenance est donc dite explicitement :
          « lecture réussie » quand la fenêtre a répondu, même vide. */}
      <Text className="mb-3 text-xs">
        {runs === null
          ? 'Lecture de la fenêtre impossible — les compteurs ci-dessous sont indisponibles, pas nuls.'
          : `Lecture réussie au ${new Date(supervision.asOf).toLocaleString('fr-FR')} : ${runs.length} run(s) dans la fenêtre. Un 0 ci-dessous est une mesure, pas une absence de lecture.`}
      </Text>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Measure label="Runs (24 h)" value={runs === null ? null : runs.length} unreadReason={unread} />
        <Measure label="Échecs" value={supervision.failedRunsInWindow} unreadReason={unread} />
        <Measure label="En vol" value={inFlight} unreadReason={unread} />
        <Measure label="En attente d'accord" value={awaiting} unreadReason={unread} />
      </div>

      <Divider soft className="my-4" />

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Text className="text-xs uppercase">Canal de télémétrie</Text>
          <Badge color={TELEMETRY_COLOR[supervision.telemetryHealth.status]}>
            {TELEMETRY_LABEL[supervision.telemetryHealth.status]}
          </Badge>
          {supervision.recentTelemetryEvents === null ? (
            <Badge color="zinc">flux non lu</Badge>
          ) : (
            <Text className="text-xs">
              {supervision.recentTelemetryEvents.length} événement(s) récent(s)
            </Text>
          )}
        </div>
        {/* `summary` est rédigé par `telemetry-health.ts` et documenté « safe to
            render as-is ». Il n'affirme JAMAIS une activité d'agent — seulement
            l'état de la boucle et de sa configuration. On le rend tel quel
            plutôt que de le paraphraser et d'en perdre la nuance. */}
        <Text className="mt-2 text-xs">{supervision.telemetryHealth.summary}</Text>
      </div>

      {overview.dataWarnings.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5">
          {overview.dataWarnings.map((warning) => (
            <li key={warning}>
              <Text className="text-xs">{warning}</Text>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
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

  // Ni `hint` ni `actions` sur ce panneau. Les deux slots du header de `Panel`
  // sont `shrink-0` : ils REFUSENT de rétrécir, donc titre + bouton imposaient
  // 399 px de large pour 360 disponibles (mesuré au viewport 360). `Panel` sert
  // sept surfaces, on ne le modifie pas pour cet écran — le lien et l'état de
  // la file descendent dans le pied, qui wrappe.
  return (
    <Panel title="File de revue" scrollable className="max-h-96" padded={false}>
      {items.length === 0 ? (
        <div className="p-4">
          <Unavailable
            reason="no-data"
            detail="Aucune action en attente. Les sources ont été lues : file vide mesurée."
          />
        </div>
      ) : (
        <ul className="divide-y divide-zinc-950/5 dark:divide-white/10">
          {items.slice(0, REVIEW_QUEUE_PREVIEW).map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={item.kind === 'data_unavailable' ? 'zinc' : 'amber'}>
                    {QUEUE_KIND_LABEL[item.kind as OperatorQueueKind] ?? item.kind}
                  </Badge>
                </div>
                <Strong className="mt-1 block truncate">{item.title}</Strong>
                <Text className="truncate text-xs">{item.meta}</Text>
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-950/5 px-4 py-2 dark:border-white/10">
        <Text className="text-xs">
          {overview.reviewQueue.isFullQueue ? 'File complète' : 'Extrait de la file'}
          {items.length > REVIEW_QUEUE_PREVIEW
            ? ` · ${REVIEW_QUEUE_PREVIEW} des ${items.length} ligne(s) affichée(s) ici`
            : ` · ${items.length} ligne(s)`}
        </Text>
        <Button plain href="/actions">
          Ouvrir la file
        </Button>
      </div>
    </Panel>
  )
}

/* ───────────────────────── Zone 3 — Évaluations ───────────────────────── */

function EvaluationsZone({ overview }: Readonly<{ overview: LearningOverview }>) {
  return (
    <Panel title="Évaluations" hint="5 signaux">
      {/* `Unavailable` centre son détail sur ~34 caractères — bon pour une
          cellule, illisible pour ce paragraphe. On garde donc sa MARQUE
          (le badge « Aucune mesure », qui porte le sens) et on rend la raison
          en texte aligné à gauche, à sa mesure. */}
      <div className="rounded-lg border border-dashed border-zinc-950/10 p-4 dark:border-white/10">
        <Unavailable reason="no-data" compact />
        <Text className="mt-2">{overview.evaluations.reason}</Text>
      </div>
      <Text className="mt-3 text-xs">
        Les cinq signaux — tests, benchmarks, shadow, replay, release gate — existent et sont mesurés par
        agent, là où leur coût se paie une seule fois : ouvrez la fiche d’un agent ou la surface
        Qualification.
      </Text>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button plain href="/qualification">
          Ouvrir Qualification
        </Button>
        <Button plain href="/agents">
          Ouvrir les agents
        </Button>
      </div>
    </Panel>
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
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      {/* Pas de `hint` : le titre « Connaissance (Obsidian) » est déjà long, et
          le slot `hint` de `Panel` est `shrink-0` — la paire dépassait de 23 px
          une fois la gouttière de contrôle fixe réservée. Le corps du panneau
          dit exactement la même chose, en pouvant revenir à la ligne. */}
      <Panel title="Connaissance (Obsidian)">
        <Text>
          Obsidian est le workspace éditable de l’opérateur : les revues, les incidents et les décisions s’y
          écrivent à la main. Aigent n’y lit rien et n’y écrit rien — il ouvre des liens.
        </Text>
        <div className="mt-4">
          <ObsidianCommands config={obsidian} />
        </div>
      </Panel>

      <Panel title="Learning Runtime" hint="H-Supervised">
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={RUNTIME_COLOR[runtime.status]}>{RUNTIME_LABEL[runtime.status]}</Badge>
          {runtime.latencyMs !== null ? (
            <Text className="text-xs tabular-nums">{runtime.latencyMs} ms</Text>
          ) : null}
          {runtime.endpoint ? <Text className="truncate text-xs">{runtime.endpoint}</Text> : null}
        </div>

        {runtime.detail ? <Text className="mt-2">{runtime.detail}</Text> : null}

        <Divider soft className="my-4" />

        <Text className="text-xs uppercase">Capacités</Text>
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

        <Text className="mt-4 text-xs">
          Datasets, évaluations par lot, jobs d’entraînement et registre de modèles vivront derrière ce
          contrat, dans un moteur séparé. Tant qu’il n’est pas branché, ces capacités n’ont pas d’écran dans
          Aigent — les décrire ici est honnête, leur donner une page vide ne le serait pas.
        </Text>
      </Panel>
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
    // DEUX CHOIX DE MISE EN PAGE, TOUS DEUX MESURÉS
    // ---------------------------------------------
    // 1. `min-h-svh`, PAS `h-svh`. Cette page est un document : ses quatre
    //    zones s'empilent et défilent avec la page. Une hauteur FIXE la
    //    bornerait au viewport et couperait tout ce qui suit — constaté en
    //    capture : la page s'arrêtait au milieu de « File de revue ».
    //    (`/actions` fait l'inverse, et pour une bonne raison : sa file est une
    //    boîte bornée dans laquelle la donnée défile.)
    // 2. `max-lg:pl-14` — GOUTTIÈRE DE CONTRÔLE FIXE, sur la COLONNE ENTIÈRE et
    //    pas sur le seul en-tête. Le shell pose un bouton de navigation
    //    `position: fixed` en (16,16), 37×36 px, z-30. « Fixe » veut dire qu'il
    //    ne défile PAS : réserver la place sous le titre ne protège que la
    //    position de scroll 0. Mesuré avant correction : à 3 positions de
    //    défilement sur 5, du contenu réel passait dessous — un compteur « 0 »,
    //    une ligne « Mission bloquée », le titre « Connaissance (Obsidian) ».
    //    Au-delà de `lg` le rail est permanent, le bouton n'existe plus, la
    //    gouttière non plus.
    <div className="min-h-svh p-4 max-lg:pl-14">
      <header className="pb-4">
        <Heading level={1}>{title}</Heading>
        <Text className="mt-1">{purpose}</Text>
        <Divider soft className="mt-4" />
      </header>

      <div className="flex flex-col gap-4 pb-4">
        <SupervisionZone overview={overview} />

        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <ReviewQueueZone overview={overview} />
          <EvaluationsZone overview={overview} />
        </div>

        <div>
          <Subheading level={2} className="sr-only">
            Connaissance et runtime
          </Subheading>
          <KnowledgeZone overview={overview} obsidian={obsidian} />
        </div>
      </div>
    </div>
  )
}
