import { ProjectBuilderModal } from '@/components/agent-ops/project-builder-modal'
import { PageLayout } from '@/components/shell/page-layout'

/**
 * /admin/projects/[id]/builder — the repo-aware Agent Builder for a project,
 * rendered as a full-screen MODAL over the project overview.
 *
 * The builder scans the project's linked GitHub repo (read-only) and drafts
 * an agent contextualized to it. Repo intelligence is auto-scanned on the
 * project overview; here the workbench still exposes an explicit "Scan repo"
 * action (bottom bar) for the builder's own bounded summary. A `?seed=<title>`
 * query (from a "Discuss in builder" recommendation link) pre-fills the
 * request box. Nothing is created before the human approves the drafted spec.
 *
 * This route stays a real page (so links/back-nav/refresh keep working) but
 * its content is a Dialog overlay: closing it (Escape or the corner cross)
 * navigates back to `/admin/projects/[id]` — the project underneath, not a
 * blank page.
 *
 * `ProjectBuilderModal` renders a `fixed inset-0` full-screen dialog, so
 * `PageLayout`'s flex column below is visually inert (a fixed-position child
 * escapes the parent's layout box) — it's kept only so this view uses the
 * shared layout primitive like every other route, per the migration gate.
 */
export function ProjectBuilderView({
  projectId,
  projectName,
  repoFullName,
  seedInput,
}: {
  projectId: string
  projectName: string
  repoFullName: string | null
  seedInput: string | undefined
}) {
  return (
    <PageLayout>
      <ProjectBuilderModal
        projectId={projectId}
        projectName={projectName}
        repoFullName={repoFullName}
        seedInput={seedInput}
      />
    </PageLayout>
  )
}
