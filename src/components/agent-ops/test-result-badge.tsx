import { CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon } from '@heroicons/react/16/solid'

import { Badge } from '@/components/catalyst/badge'
import type { TestResultStatus } from '@/lib/agent-mission-control/types'

/**
 * Monochrome states need a SECOND axis beyond fill intensity so they read
 * without parsing the label: pass/fail/error carry a shape (icon). The color
 * stays a single accent hue; the icon + label carry the meaning.
 */
const resultConfig: Record<
  TestResultStatus,
  { label: string; color: 'accent' | 'accentStrong' | 'accentSolid' | 'zinc'; Icon?: typeof CheckCircleIcon }
> = {
  pass: { label: 'Pass', color: 'accent', Icon: CheckCircleIcon },
  fail: { label: 'Fail', color: 'accentSolid', Icon: XCircleIcon },
  error: { label: 'Error', color: 'accentStrong', Icon: ExclamationTriangleIcon },
  skip: { label: 'Skip', color: 'zinc' },
  running: { label: 'Running', color: 'zinc' },
}

/** Test result badge — icon + always-visible text label, never color alone. */
export function TestResultBadge({ result }: { result: TestResultStatus }) {
  const config = resultConfig[result]

  return (
    <Badge color={config.color}>
      {config.Icon ? <config.Icon aria-hidden="true" className="-ml-0.5 size-3.5 shrink-0" /> : null}
      {config.label}
    </Badge>
  )
}
