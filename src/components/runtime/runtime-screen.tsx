/**
 * L'écran `/runtime` — l'en-tête, les six onglets, et le panneau courant.
 *
 * Server Component. Il ne lit RIEN lui-même : la page a déjà lu l'onglet demandé
 * et lui passe la donnée.
 */
import { PageBody, PageHeader } from '@/components/app-shell'
import { runtimeTab, type RuntimeTabId } from './model'
import RuntimeTabBar from './tab-bar'
import LangGraphTab from './tab-langgraph'
import ModelsTab from './tab-models'
import ProvidersTab from './tab-providers'
import RepositoriesTab from './tab-repositories'
import TelemetryTab from './tab-telemetry'
import ToolsTab from './tab-tools'
import VisualToolingTab from './tab-visual-tooling'
import type { VisualToolingData } from './visual-tooling'
import type {
  LangGraphTabData,
  ModelsTabData,
  ProvidersTabData,
  RepositoriesTabData,
  TelemetryTabData,
  ToolsTabData,
} from './server-reads'

export type RuntimeScreenData =
  | { tab: 'telemetry'; data: TelemetryTabData }
  | { tab: 'langgraph'; data: LangGraphTabData }
  | { tab: 'tools'; data: ToolsTabData }
  | { tab: 'providers'; data: ProvidersTabData }
  | { tab: 'models'; data: ModelsTabData }
  | { tab: 'repositories'; data: RepositoriesTabData }
  | { tab: 'visual-tooling'; data: VisualToolingData }

function TabPanel({ payload }: Readonly<{ payload: RuntimeScreenData }>) {
  switch (payload.tab) {
    case 'telemetry':
      return <TelemetryTab data={payload.data} />
    case 'langgraph':
      return <LangGraphTab data={payload.data} />
    case 'tools':
      return <ToolsTab data={payload.data} />
    case 'providers':
      return <ProvidersTab data={payload.data} />
    case 'models':
      return <ModelsTab data={payload.data} />
    case 'repositories':
      return <RepositoriesTab data={payload.data} />
    case 'visual-tooling':
      return <VisualToolingTab data={payload.data} />
  }
}

export default function RuntimeScreen({
  current,
  payload,
}: Readonly<{
  current: RuntimeTabId
  payload: RuntimeScreenData
}>) {
  const tab = runtimeTab(current)

  return (
    <>
      <PageHeader
        title="Runtime"
        description="Ce qui est réellement câblé sous les agents : le canal de retour, l’Agent Server, les outils, les providers, les modèles, les dépôts et l’outillage."
        meta={<RuntimeTabBar current={current} />}
      />

      <PageBody>
        <section
          className="aig-stage aig-accent-edge flex flex-col p-4 sm:p-5"
          aria-label={tab.name}
        >
          <div className="pb-3">
            <h2 className="aig-display text-xl font-semibold sm:text-2xl">{tab.name}</h2>
            <p className="aig-text-muted mt-1 max-w-3xl text-sm">{tab.purpose}</p>
          </div>

          <div className="aig-hairline" />

          <div className="aig-inset flex min-w-0 flex-col p-3">
            <TabPanel payload={payload} />
          </div>
        </section>
      </PageBody>
    </>
  )
}
