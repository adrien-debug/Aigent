/**
 * Bare admin layout — P006 demolition.
 *
 * The visual shell (rail, topbar, command palette, page wrappers) was DELETED,
 * not hidden. What remains here is the one non-visual thing this segment still
 * needs: `dynamic = 'force-dynamic'`, so `next build` never prerenders a route
 * whose data layer is fail-closed and would throw without a backend.
 *
 * Authentication is NOT handled here and never was — `src/proxy.ts` gates
 * `/admin` and `/admin/**` before a request reaches this file.
 */
export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}
