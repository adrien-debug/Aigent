import { AgentControlShell } from '@/components/agent-ops/agent-control-shell'
import { AdminRouteViewport } from '@/components/agent-ops/admin-route-viewport'

// Live-only: every /admin route renders per-request against the gpu1 data layer.
// Force dynamic so `next build` never prerenders them (the fail-closed data layer
// would throw without a backend, e.g. in CI).
export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AgentControlShell>
      <AdminRouteViewport>{children}</AdminRouteViewport>
    </AgentControlShell>
  )
}
