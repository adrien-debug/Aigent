/**
 * Jointure des runs et des agents vers des NOMS lisibles.
 *
 * `windowRuns` ne porte que des ids (`copilotId`, `projectId`) : afficher
 * « run-a3f… · completed » ne renseigne personne. Les copilots et les projets
 * sont DÉJÀ chargés par `getDashboardOverview` — cette jointure est purement en
 * mémoire, elle ne déclenche aucune lecture supplémentaire.
 *
 * DOCTRINE : un id qu'on ne sait pas résoudre ne devient pas un nom inventé. Il
 * reste `null`, et l'écran dit qu'il est inconnu. Un nom fabriqué serait pire
 * qu'un id brut — il aurait l'air vrai.
 */
import type { AgentRun, Copilot, Project } from '@/lib/agent-mission-control/types'

export type NamedRun = {
  id: string
  /** Nom du copilot, ou `null` si l'id ne résout pas. Jamais inventé. */
  copilotName: string | null
  copilotId: string
  projectName: string | null
  status: AgentRun['status']
  startedAtMs: number
  /** Durée mesurée, `null` si non mesurable. */
  latencyMs: number | null
  /** Coût mesuré, `null` si le run n'a pas porté de coût mesurable. */
  costUsd: number | null
  toolCallCount: number
}

export type AgentCard = {
  copilotId: string
  name: string | null
  projectName: string | null
  status: Copilot['status']
  runs24h: number
  failures24h: number
  /** Instant du dernier run sur la fenêtre, `null` si aucun. */
  lastRunMs: number | null
  /** Somme des coûts MESURÉS ; `null` si aucun run n'a porté de coût. */
  costUsd: number | null
}

export type ProjectCard = {
  id: string
  name: string
  repoFullName: string | null
  copilotCount: number
  activeCount: number
  runs24h: number | null
  costLast24hUsd: number | null
  passRate: number | null
}

/**
 * Index de résolution id → entité, construit une fois et partagé par les deux
 * dérivations ci-dessous (elles le bâtissaient chacune de leur côté).
 */
function buildIndex(copilots: Copilot[], projects: Project[]) {
  return {
    copilotById: new Map(copilots.map((c) => [c.id, c])),
    projectById: new Map(projects.map((p) => [p.id, p])),
  }
}

/** Les N runs les plus récents de la fenêtre, nommés. `null` si non lue. */
export function buildNamedRuns(
  windowRuns: AgentRun[] | null,
  copilots: Copilot[],
  projects: Project[],
  limit = 40,
): NamedRun[] | null {
  if (windowRuns === null) return null

  const { copilotById, projectById } = buildIndex(copilots, projects)

  return [...windowRuns]
    .map((run) => {
      const copilot = copilotById.get(run.copilotId) ?? null
      const project = projectById.get(run.projectId) ?? null
      const startedAtMs = Date.parse(run.startedAt)
      return {
        id: run.id,
        copilotId: run.copilotId,
        copilotName: copilot?.name ?? null,
        projectName: project?.name ?? null,
        status: run.status,
        startedAtMs: Number.isNaN(startedAtMs) ? 0 : startedAtMs,
        latencyMs: typeof run.latencyMs === 'number' ? run.latencyMs : null,
        costUsd: run.costUsd ?? null,
        toolCallCount: run.toolCallCount,
      }
    })
    .sort((a, b) => b.startedAtMs - a.startedAtMs)
    .slice(0, limit)
}

/**
 * Une carte par agent AYANT TOURNÉ sur la fenêtre — un cockpit montre ce qui
 * bouge, pas un annuaire. `null` si la fenêtre n'a pas été lue.
 */
export function buildAgentCards(
  windowRuns: AgentRun[] | null,
  copilots: Copilot[],
  projects: Project[],
): AgentCard[] | null {
  if (windowRuns === null) return null

  const { copilotById, projectById } = buildIndex(copilots, projects)
  const byCopilot = new Map<string, AgentCard>()

  for (const run of windowRuns) {
    let card = byCopilot.get(run.copilotId)
    if (!card) {
      const copilot = copilotById.get(run.copilotId) ?? null
      const project = copilot?.projectId ? (projectById.get(copilot.projectId) ?? null) : null
      card = {
        copilotId: run.copilotId,
        name: copilot?.name ?? null,
        projectName: project?.name ?? null,
        status: copilot?.status ?? 'draft',
        runs24h: 0,
        failures24h: 0,
        lastRunMs: null,
        costUsd: null,
      }
      byCopilot.set(run.copilotId, card)
    }
    card.runs24h += 1
    if (run.status === 'failed' || run.status === 'blocked') card.failures24h += 1

    const startedAtMs = Date.parse(run.startedAt)
    if (!Number.isNaN(startedAtMs) && (card.lastRunMs === null || startedAtMs > card.lastRunMs)) {
      card.lastRunMs = startedAtMs
    }
    // Un coût non mesurable n'est pas 0 : il n'entre pas dans la somme, et si
    // AUCUN run n'a porté de coût la carte reste `null` plutôt que d'afficher $0.
    if (run.costUsd !== null && run.costUsd !== undefined) {
      card.costUsd = (card.costUsd ?? 0) + run.costUsd
    }
  }

  return [...byCopilot.values()].sort((a, b) => (b.lastRunMs ?? 0) - (a.lastRunMs ?? 0))
}

/**
 * Heure murale d'un instant, `HH:MM:SS`.
 *
 * Calculée côté serveur comme `timeAgo` et comme les libellés d'heure des
 * buckets : un flux d'exécution doit lire la même horloge que l'histogramme
 * posé au-dessus de lui.
 */
const pad2 = (n: number) => String(n).padStart(2, '0')

export function clockTime(atMs: number): string {
  const d = new Date(atMs)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/** Libellé relatif court : « il y a 4 min ». */
export function timeAgo(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000))
  if (s < 60) return `il y a ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `il y a ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h} h`
  return `il y a ${Math.round(h / 24)} j`
}
