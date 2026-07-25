import 'server-only'

import { notFound } from 'next/navigation'

import { getProject } from './data'

export type ProjectBuilderPageData = {
  projectId: string
  projectName: string
  repoFullName: string | null
  seedInput: string | undefined
}

/**
 * `/admin/projects/:id/builder` data-fetch, extracted so `page.tsx` stays a
 * pure `data + <View />` shell (see `scripts/check-views.mjs`).
 *
 * The `seed` query param (from a "Discuss in builder" recommendation link)
 * is clamped to 200 chars here — same trust boundary as the old inline page.
 */
export async function getProjectBuilderPageData(
  id: string,
  seed: string | undefined
): Promise<ProjectBuilderPageData> {
  const project = await getProject(id)
  if (!project) notFound()

  return {
    projectId: id,
    projectName: project.name,
    repoFullName: project.repoFullName ?? null,
    seedInput: typeof seed === 'string' ? seed.slice(0, 200) : undefined,
  }
}
