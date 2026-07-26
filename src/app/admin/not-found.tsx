import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { surfaceRaised } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'

/**
 * Dashboard-scoped 404 boundary.
 *
 * WHY THIS FILE EXISTS — measured, not assumed. Before it, the ONLY not-found
 * boundary under /admin was `admin/agents/not-found.tsx`. Every other 404 in
 * the dashboard therefore fell through to the ROOT `src/app/not-found.tsx`,
 * which sits ABOVE `admin/layout.tsx` and so renders without the shell. Counted
 * in a real browser at 1440x900 (visible <a> inside `nav[aria-label="Main"]`):
 *
 *   /admin/agents/<retired id>      -> 8 shell nav links   (agents boundary)
 *   /admin/nope                     -> 0 shell nav links   (root boundary)
 *   /admin/projects/promotion       -> 0 shell nav links   (root boundary)
 *   /admin/projects/<id>/nope       -> 0 shell nav links   (root boundary)
 *
 * A 404 with zero navigation is a dead end: the operator who mistypes a URL, or
 * follows one of the stale deep links out of /admin/telemetry, loses the whole
 * console and gets exactly one escape hatch. Next.js resolves the NEAREST
 * boundary, so placing this file at the `admin` segment puts every dashboard
 * 404 back inside `admin/layout.tsx` — sidebar, command palette and account nav
 * all present — while `src/app/not-found.tsx` keeps serving genuinely
 * off-dashboard URLs like `/nope`, where the shell would be wrong.
 *
 * NOT a `loading.tsx`. The long comment in `admin/layout.tsx` forbids a Suspense
 * boundary above a dynamic segment because it flushes a 200 shell and locks the
 * status line. A `not-found.tsx` is NOT a Suspense boundary: it renders only
 * after `notFound()` has already thrown, so the 404 status is emitted first.
 * Verified rather than reasoned — all four routes above still answer HTTP 404
 * with this file in place.
 *
 * No `<main>` here: `SidebarLayout` already owns that landmark, and a second
 * one would give the page two `main` regions. Same reason `agents/not-found.tsx`
 * renders a bare `<div>`.
 */
export default function AdminNotFound() {
  return (
    <div className={`mx-auto mt-12 w-full max-w-md p-6 text-center ${surfaceRaised}`}>
      {/* `dark:text-zinc-400` for the status code, exactly as in
          `agents/not-found.tsx`: 12px zinc-500 measures 3.59:1 on the raised
          plane (rgb(26,26,30)) against the 4.5:1 AA floor, and the error code
          is the one string that tells the reader WHICH failure this is. */}
      <p className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">Error 404</p>
      <Heading className="mt-4">Page not found</Heading>
      <Text className="mt-2">
        No dashboard route matches this URL. It may have been renamed, or the record it pointed to
        is no longer in the registry.
      </Text>
      <div className="mt-6">
        <Button href="/admin">Back to dashboard</Button>
      </div>
    </div>
  )
}
