import type { Metadata } from 'next'

import { TelemetryView } from '@/components/views/telemetry/telemetry-view'
import { getTelemetryPageData } from '@/lib/agent-mission-control/telemetry-page-data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Telemetry — Aigent',
}

export default async function TelemetryPage() {
  const data = await getTelemetryPageData()
  return <TelemetryView {...data} />
}
