import 'server-only'

import { notFound } from 'next/navigation'
import { getProject } from './data'

export type ProjectBuilderPageData = {
  projectId: string
  projectName: string
  repoFullName: string | null
  seedInput: string | undefined
}

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
