/**
 * Roster des agents — page liste éditoriale, disclosure progressive.
 *
 * Server Component : il reçoit le contrat canonique déjà lu et le distribue. Il
 * ne lit rien lui-même et ne recalcule aucun statut — `AvailableAgent.status`
 * est la même dérivation que la garde d'exécution, et la recalculer ici est
 * exactement comme un écran a fini par promettre un lancement que l'API
 * refusait.
 *
 * La ligne de liste ne montre que le nécessaire : nom, état principal,
 * dernière activité et signal critique éventuel. Le détail complet vit au clic.
 */
import { PageBody, PageHeader } from '@/components/app-shell'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Subheading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import { Rail, SEVERITY, Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { RuntimeStatusBadge } from './atoms'
import { countRoster, isUnavailable, sortRoster, unresolvedToolsBadgeText } from './roster-model'

/** Le rail reprend la gravité du statut runtime — la même que le badge. */
const RAIL_COLOR: Record<AvailableAgent['status'], string> = {
  active: SEVERITY.good,
  inactive: SEVERITY.muted,
  degraded: SEVERITY.bad,
  unavailable: SEVERITY.warn,
}

function isoShort(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ')
}

function missingRequirement(agent: AvailableAgent): string | null {
  if (isUnavailable(agent, 'version')) return 'Version non résolue'
  if (isUnavailable(agent, 'provider')) return 'Provider non résolu'
  if (isUnavailable(agent, 'configuredModel')) return 'Modèle non résolu'
  if (isUnavailable(agent, 'runtime')) return 'Runtime non résolu'
  if (isUnavailable(agent, 'projectId')) return 'Projet non résolu'
  return null
}

function criticalSignal(agent: AvailableAgent): { tone: 'amber' | 'red'; text: string } | null {
  if (agent.unresolvedToolIds.length > 0) {
    return {
      tone: 'red',
      text: unresolvedToolsBadgeText(agent.unresolvedToolIds.length),
    }
  }
  if (agent.runtimeProvisioned === false) {
    return { tone: 'amber', text: 'Assistant LangGraph non provisionne' }
  }
  const missing = missingRequirement(agent)
  if (missing) {
    return { tone: 'amber', text: missing }
  }
  return null
}

/**
 * Un chiffre de flotte, à la taille de son importance.
 *
 * Ce sont des COMPTAGES dérivés de la liste rendue juste en dessous : ils ne
 * peuvent pas être `null`, contrairement à une mesure lue en base. Un `0` ici
 * est donc un vrai zéro — d'où l'absence de garde d'absence, qui serait
 * mensongère dans l'autre sens (prétendre douter d'un comptage local).
 */
function FleetFigure({
  value,
  label,
  hint,
  tone = 'default',
}: Readonly<{
  value: number
  label: string
  hint?: string
  tone?: 'default' | 'good' | 'warn' | 'bad'
}>) {
  // Variante ENCRE : ce chiffre est du TEXTE, pas un aplat ni un rail. Les
  // teintes nues de `SEVERITY` sont calibrées pour émettre sur graphite et
  // tombent sous 4.5:1 sur les surfaces claires (2.79:1 mesuré pour `warn`).
  const toneColor =
    tone === 'bad'
      ? 'var(--aig-severity-bad-ink)'
      : tone === 'warn'
        ? 'var(--aig-severity-warn-ink)'
        : tone === 'good'
          ? 'var(--aig-severity-good-ink)'
          : null

  return (
    <div className="min-w-0">
      <div className="aig-display text-3xl font-semibold tabular-nums sm:text-4xl" style={toneColor ? { color: toneColor } : undefined}>
        {value}
      </div>
      <Text className="aig-text-muted mt-1 truncate text-sm">{label}</Text>
      {hint ? <Text className="aig-text-faint mt-0.5 text-xs">{hint}</Text> : null}
    </div>
  )
}

/**
 * La SANTÉ DE LA FLOTTE — la zone dominante de cette route.
 *
 * Avant, ces chiffres n'existaient qu'en prose dans la description de l'en-tête
 * (« 12 agents au catalogue · 3 actifs · … ») : une information de premier rang
 * rendue à la taille d'une légende. Elle prend ici la scène, et les panneaux de
 * répartition descendent au second rang.
 */
function FleetStage({
  agents,
}: Readonly<{
  agents: readonly AvailableAgent[]
}>) {
  const counts = countRoster(agents)
  const attention = agents.filter((agent) => criticalSignal(agent) !== null).length

  return (
    <section className="aig-stage aig-accent-edge p-5 sm:p-6" aria-label="Santé de la flotte">
      <Text className="aig-text-faint text-2xs font-medium uppercase tracking-[0.18em]">
        Santé de la flotte
      </Text>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <FleetFigure value={counts.total} label="Au catalogue" />
        <FleetFigure
          value={counts.active}
          label="Actifs"
          tone={counts.active > 0 ? 'good' : 'default'}
          hint="run terminé, modèle prouvé"
        />
        <FleetFigure
          value={counts.degraded}
          label="Dégradés"
          tone={counts.degraded > 0 ? 'bad' : 'default'}
        />
        <FleetFigure
          value={attention}
          label="Signal critique"
          tone={attention > 0 ? 'warn' : 'default'}
          hint="outil non résolu, assistant, résolution"
        />
      </div>

      <div className="aig-hairline my-5" />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Text className="aig-text-muted text-sm">
          {counts.withProvenExecutedModel} agent(s) ont un modèle PROUVÉ par un run réel
        </Text>
        <Text className="aig-text-muted text-sm">
          {counts.inactive} inactif(s) · {counts.unavailable} indisponible(s)
        </Text>
        <Text className={counts.withUnresolvedTools > 0 ? 'text-sm' : 'aig-text-muted text-sm'} style={counts.withUnresolvedTools > 0 ? { color: 'var(--aig-severity-bad-ink)' } : undefined}>
          {counts.withUnresolvedTools} avec outil non résolu
        </Text>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <Text className="aig-text-faint text-2xs uppercase tracking-[0.14em]">Répartition runtime</Text>
          <div className="mt-2 space-y-2">
            {[
              { label: 'Actifs', value: counts.active, color: 'var(--aig-severity-good-ink)' },
              { label: 'Dégradés', value: counts.degraded, color: 'var(--aig-severity-bad-ink)' },
              { label: 'Inactifs', value: counts.inactive, color: SEVERITY.muted },
              { label: 'Indisponibles', value: counts.unavailable, color: 'var(--aig-severity-warn-ink)' },
            ].map((row) => (
              <div key={row.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <Text className="aig-text-muted">{row.label}</Text>
                  <span className="aig-display tabular-nums">{row.value}</span>
                </div>
                <div className="h-1 rounded-full bg-(--aig-line-soft)">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(row.value / Math.max(1, counts.total)) * 100}%`, backgroundColor: row.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Text className="aig-text-faint text-2xs uppercase tracking-[0.14em]">Provenance état</Text>
          <div className="sr-only">{agents.length} agents analysés</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Text className="aig-text-muted text-xs">Modèle prouvé</Text>
            <span className="text-right tabular-nums">{counts.withProvenExecutedModel}</span>
            <Text className="aig-text-muted text-xs">Assistant manquant</Text>
            <span className="text-right tabular-nums">
              {agents.filter((agent) => agent.runtimeProvisioned === false).length}
            </span>
            <Text className="aig-text-muted text-xs">Outils non résolus</Text>
            <span className="text-right tabular-nums">{counts.withUnresolvedTools}</span>
            <Text className="aig-text-muted text-xs">Donnée indisponible</Text>
            <span className="text-right tabular-nums">
              {agents.filter((agent) => agent.unavailableFields.length > 0).length}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

function AgentRosterRow({ agent }: Readonly<{ agent: AvailableAgent }>) {
  const activity = isoShort(agent.lastRunAt)
  const signal = criticalSignal(agent)

  return (
    <li className="relative">
      <Rail color={RAIL_COLOR[agent.status]} />
      <Link
        href={`/agents/${agent.copilotId}`}
        className="group flex items-start gap-4 px-5 py-4 transition hover:bg-(--aig-line-soft) focus-visible:bg-(--aig-line-soft)"
      >
        {/* L'avatar était peint pour un fond blanc (`bg-zinc-950/3`,
            `text-zinc-700`) : sur le graphite il disparaissait. `aig-raised`
            le pose au palier au-dessus du panneau — la même mécanique que le
            rail de navigation, donc une seule règle à retenir. */}
        <Avatar
          square
          initials={initialsOf(agent.name)}
          className="aig-raised size-10 shrink-0 outline-0"
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Strong className="truncate">{agent.name}</Strong>
            <RuntimeStatusBadge status={agent.status} />
          </div>
          <Text className="mt-1 truncate">
            {activity ? `Dernier run : ${activity} UTC` : 'Aucune activité enregistrée'}
          </Text>
          {/* Variante ENCRE des teintes de sévérité — voir `tokens.css`. La
              SÉVÉRITÉ ne change pas, seule sa lisibilité sur fond clair. */}
          {signal ? (
            <Text
              className="mt-1"
              style={{
                color:
                  signal.tone === 'red'
                    ? 'var(--aig-severity-bad-ink)'
                    : 'var(--aig-severity-warn-ink)',
              }}
            >
              {signal.text}
            </Text>
          ) : null}
        </div>

        {/* L'affordance d'ouverture s'éclaire au survol : `aig-text-faint` au
            repos, accent au survol — le seul accent du produit. */}
        <Text className="aig-text-faint hidden shrink-0 text-sm transition group-hover:text-(--aig-accent) sm:block">
          Ouvrir
        </Text>
      </Link>
    </li>
  )
}

export default function AgentRosterScreen({
  agents,
}: Readonly<{
  agents: AvailableAgent[]
}>) {
  const ranked = sortRoster(agents)

  return (
    <>
      {/* L'en-tête n'est plus recomposé ici : `PageHeader` porte le titre, la
          description, les actions, la gouttière mobile et le sticky pour les
          onze surfaces. Un écran qui redessine son propre en-tête est
          exactement la dérive que cette mission ferme. */}
      <PageHeader
        title="Agents"
        description="La flotte en tête, la liste en dessous : l’essentiel pour décider quoi ouvrir, pas tout ce que le contrat sait."
        actions={
          <Button className="aig-btn-accent" href="/builder">
            Nouveau copilot
          </Button>
        }
      />

      <PageBody className="gap-5">
        <FleetStage agents={ranked} />

        {/* Le roster n'est plus un panneau de plus dans une pile : c'est le
            CREUX qui accueille la liste, sous la scène. Il prend de la hauteur
            réelle et la donnée y défile — la boîte ne grandit pas avec elle. */}
        <section className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 pb-3">
            <Subheading level={2}>Liste des agents</Subheading>
            <Text className="aig-text-muted text-sm">
              Nom, état, dernière activité, signal critique. Le reste vient au clic.
            </Text>
          </div>

          <div className="aig-inset min-w-0">
            {ranked.length === 0 ? (
              <div className="px-5 py-10">
                <Unavailable
                  reason="no-data"
                  detail="Aucun agent n'est persisté dans le catalogue. La lecture a réussi — il n'y a réellement rien, ce n'est pas une panne."
                />
              </div>
            ) : (
              <ul className="divide-y divide-(--aig-line-soft)">
                {ranked.map((agent) => (
                  <AgentRosterRow key={agent.copilotId} agent={agent} />
                ))}
              </ul>
            )}
          </div>
        </section>
      </PageBody>
    </>
  )
}
