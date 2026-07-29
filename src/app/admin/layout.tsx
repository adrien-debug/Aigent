/**
 * Admin segment layout — deliberately non-visual.
 *
 * The console chrome (rail, top bar, content plate) is assembled in
 * `./page.tsx`, not here, for one concrete reason: `Rail` needs the CURRENT
 * pathname to mark its active tile, and a server layout cannot read one without
 * turning into a client component. Each admin route therefore mounts the frame
 * itself and passes its own `activeHref` — one `'use client'` avoided, and no
 * route inherits a rail that highlights someone else's tile.
 *
 * What DOES belong here is the one thing the whole segment shares and that no
 * single page can declare for its siblings: `dynamic = 'force-dynamic'`. The
 * data layer under `/admin` is fail-closed — it throws rather than invent a
 * fleet — so `next build` must never prerender these routes without a backend.
 *
 * Authentication is NOT handled here and never was: `src/proxy.ts` gates
 * `/admin` and `/admin/**` before a request reaches this file.
 */
export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}
