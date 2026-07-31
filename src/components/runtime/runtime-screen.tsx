/**
 * L'écran `/runtime` — l'en-tête, les six onglets, et le panneau courant.
 *
 * Server Component. Il ne lit RIEN lui-même : la page a déjà lu l'onglet demandé
 * et lui passe la donnée. Chaque onglet ne lit que la sienne — changer d'onglet
 * est une navigation, donc une surface qui interroge six backends pour n'en
 * afficher qu'un sixième paierait six fois le prix d'une panne.
 *
 * ZÉRO-SCROLL : la page ne pousse jamais le shell hors du viewport. La boîte est
 * à hauteur bornée et c'est la donnée qui défile à l'intérieur.
 */
import { Divider } from '@/components/ui/divider'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
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

/**
 * La donnée d'UN onglet — l'union discriminée par `tab`.
 *
 * Un objet portant les six charges à la fois autoriserait la page à lire six
 * backends pour en afficher un. L'union rend cette dérive impossible à écrire :
 * il n'y a jamais qu'une charge en main.
 */
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
    <div className="h-full overflow-hidden p-4">
      <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
        <header className="shrink-0">
          <div className="flex flex-col gap-3 px-6 py-4">
            <div className="min-w-0">
              <Heading level={1}>Runtime</Heading>
              <Text className="mt-1">{tab.purpose}</Text>
            </div>
            <RuntimeTabBar current={current} />
          </div>
          <Divider soft />
        </header>

        {/* `overflow-y-auto`, PAS `overflow-hidden` : un onglet dense (LangGraph
         * en porte six) dépassait la hauteur disponible et ses derniers
         * panneaux étaient COUPÉS à zéro — « Assistants du serveur » et
         * « Threads récents » mesuraient 0 px, contenu inatteignable, sans que
         * rien ne l'indique. Le zéro-scroll de la PAGE est tenu par le `h-full
         * overflow-hidden` du parent ; c'est ici, dans la zone bornée, que la
         * donnée doit défiler. Box fixe, data qui scrolle dedans. */}
        <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
          <TabPanel payload={payload} />
        </div>
      </section>
    </div>
  )
}
