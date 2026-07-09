import { Badge } from '@/components/catalyst/badge'
import type { TestResultStatus } from '@/lib/agent-mission-control/types'

const resultConfig: Record<TestResultStatus, { label: string; color: 'green' | 'rose' | 'orange' | 'zinc' | 'blue' }> =
  {
    pass: { label: 'Pass', color: 'green' },
    fail: { label: 'Fail', color: 'rose' },
    error: { label: 'Error', color: 'orange' },
    skip: { label: 'Skip', color: 'zinc' },
    running: { label: 'Running', color: 'blue' },
  }

/** Test result badge — always-visible text label, never color alone. */
export function TestResultBadge({ result }: { result: TestResultStatus }) {
  const config = resultConfig[result]

  return <Badge color={config.color}>{config.label}</Badge>
}
