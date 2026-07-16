import clsx from 'clsx'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import type { DeliveryMatrixRow } from '@/lib/agent-mission-control/dashboard-overview'
import { formatTimestamp } from '@/lib/agent-mission-control/format'

function statusBadge(status: string | null): 'accent' | 'zinc' {
  if (!status) return 'zinc'
  if (status === 'passed' || status === 'merged_validated' || status === 'production' || status === 'completed') {
    return 'accent'
  }
  return 'zinc'
}

function formatStatus(status: string | null): string {
  if (!status) return '—'
  return status.replace(/_/g, ' ')
}

function isExternalHref(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://')
}

export function AgentDeliveryMatrix({ rows }: { rows: DeliveryMatrixRow[] }) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Agent Delivery Matrix" />
      {rows.length > 0 ? (
        <div className="overflow-x-auto no-scrollbar">
          <Table className="min-w-[960px]">
            <TableHead>
              <TableRow className="border-b border-white/5 bg-black/40">
                <TableHeader>Agent</TableHeader>
                <TableHeader>Target Repo</TableHeader>
                <TableHeader className="text-right">RepoFit</TableHeader>
                <TableHeader>Scorecard</TableHeader>
                <TableHeader>Sandbox</TableHeader>
                <TableHeader>Delivery</TableHeader>
                <TableHeader>Next Action</TableHeader>
                <TableHeader className="text-right">Updated</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody className="divide-y divide-white/5">
              {rows.map((row) => (
                <TableRow key={row.agentId} className="hover:bg-[var(--color-surface-interactive)] transition-colors">
                  <TableCell className="py-3">
                    <Link href={`/admin/agents/${row.agentId}`} className="text-sm font-medium text-white hover:underline">
                      {row.agentName}
                    </Link>
                  </TableCell>
                  <TableCell className="py-3 font-mono text-xs text-zinc-400">{row.targetRepo ?? '—'}</TableCell>
                  <TableCell className="py-3 text-right font-mono text-sm text-zinc-300">
                    {row.repoFit ?? '—'}
                  </TableCell>
                  <TableCell className="py-3">
                    {row.scorecardScore != null ? (
                      <span className="text-sm text-zinc-300">
                        <span className="font-mono">{row.scorecardScore}</span>
                        {row.scorecardLabel ? <span className="text-zinc-500"> {row.scorecardLabel}</span> : null}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    {row.sandboxStatus ? (
                      <Badge color={statusBadge(row.sandboxStatus)}>{formatStatus(row.sandboxStatus)}</Badge>
                    ) : (
                      <span className="text-xs text-zinc-400">No sandbox report yet</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    {row.deliveryStatus ? (
                      <Badge color={statusBadge(row.deliveryStatus)}>{formatStatus(row.deliveryStatus)}</Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    {isExternalHref(row.nextAction.href) ? (
                      <Button outline href={row.nextAction.href} target="_blank" rel="noreferrer" className="text-xs">
                        {row.nextAction.label}
                      </Button>
                    ) : (
                      <Button outline href={row.nextAction.href} className="text-xs">
                        {row.nextAction.label}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className={clsx('py-3 text-right font-mono text-xs text-zinc-500')}>
                    {row.updatedAt ? formatTimestamp(row.updatedAt).replace(' UTC', '') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No delivery matrix data" className="py-16" />
      )}
    </SurfaceCard>
  )
}
