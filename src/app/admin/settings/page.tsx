import type { Metadata } from 'next'

import { SettingsView } from '@/components/views/settings/settings-view'
import { isLangfuseConfigured } from '@/lib/agent-mission-control/langfuse'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Settings — Aigent',
}

export default function SettingsPage() {
  const backendConfigured = process.env.AMC_DATA_SOURCE === 'gpu1' && Boolean(process.env.AMC_SUPABASE_URL)
  return <SettingsView backendConfigured={backendConfigured} tracesConfigured={isLangfuseConfigured()} />
}
