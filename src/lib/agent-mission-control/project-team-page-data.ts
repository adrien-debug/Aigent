import 'server-only'

import { notFound } from 'next/navigation'

import { getProject } from './data'
import { isPgrestTimeout } from './postgrest'
import { getProjectTeamGraph, isProjectId } from './project-team/data'
import type { Project } from './types'
import type { ProjectTeamGraph } from './project-team/types'

export type ProjectTeamPageData = {
  project: Project
  graph: ProjectTeamGraph | null
  loadError: string | null
}

/**
 * `/admin/projects/:id/team` data-fetch, extracted so `page.tsx` stays a pure
 * `data + <View />` shell (see `scripts/check-views.mjs`).
 *
 * Fail-closed: the graph is loaded and contract-validated server-side. If the
 * backend cannot answer, the caller renders an explicit UNAVAILABLE state
 * with the operator-facing reason — never a locally reconstructed graph.
 *
 * Calls `notFound()` (throws) for an invalid id, a missing project, or a
 * "no graph, no error" state — never inside the try/catch below, so a
 * project deleted between the two reads renders 404, not "backend
 * unreachable" (see the inline comment at the `!graph && !loadError` check).
 */
export async function getProjectTeamPageData(id: string): Promise<ProjectTeamPageData> {
  // Entry-point symmetry with the API route: the route rejects an id that
  // fails PROJECT_ID_RE with a 400 before touching the backend, so this page
  // must not hand the same function an unvalidated route param. A shape the
  // route calls invalid is not a project — it is a 404 here.
  if (!isProjectId(id)) notFound()

  const project = await getProject(id)
  if (!project) notFound()

  let graph: ProjectTeamGraph | null = null
  let loadError: string | null = null
  try {
    graph = (await getProjectTeamGraph(id)) ?? null
  } catch (err) {
    // Detail stays server-side; the operator gets a precise but non-leaking
    // reason so they know whether to retry or to page someone.
    console.error('[admin/projects/team] graph load failed:', err)
    loadError = isPgrestTimeout(err)
      ? 'The data backend did not answer in time (gateway timeout). The team graph could not be built. Retry in a moment; if it persists, check the PostgREST service on gpu1.'
      : 'The data backend is unreachable, so this project’s team graph could not be built. No graph is shown rather than an approximate one. Check the agent-ops backend, then refresh.'
  }

  // OUTSIDE the try on purpose. notFound() signals by THROWING
  // (NEXT_HTTP_ERROR_FALLBACK;404); inside the catch above it would be
  // swallowed and a project deleted between the two reads would render
  // "backend unreachable" — and log a backend failure that never happened.
  if (!graph && !loadError) notFound()

  return { project, graph, loadError }
}
