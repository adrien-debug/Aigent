export const dynamic = 'force-dynamic'

/**
 * Pass-through, on purpose.
 *
 * This layout used to mount `<ConsoleShell>` itself. It cannot: a server layout
 * has no pathname (`usePathname` would force `'use client'` onto the whole
 * frame), so it could never pass `activeHref`, `title` or `degraded` — the rail
 * rendered with no active pill and the topbar with no state on every screen.
 *
 * Every page under `src/app/admin/**` now mounts the shell itself with those
 * props. Keeping the mount here as well would render TWO frames — two sidebars,
 * two topbars — so it is deleted, not hidden behind a flag.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}
