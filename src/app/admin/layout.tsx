import { AgentControlShell } from '@/components/agent-ops/agent-control-shell'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AgentControlShell>{children}</AgentControlShell>
}
