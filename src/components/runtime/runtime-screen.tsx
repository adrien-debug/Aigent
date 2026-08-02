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
    // Le titre, la description et la gouttière mobile de cet écran étaient
    // recomposés à la main DANS le panneau ; `PageHeader` est la seule
    // implémentation du produit et porte déjà son sticky et son `max-lg:pl-16`.
    // La piste d'onglets descend dans `meta` : c'est le contexte de navigation
    // de la surface, pas une action.
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* La description de l'ONGLET descend dans la scène, avec son nom : la
          répéter ici la donnerait deux fois à quelques pixels d'écart. L'en-tête
          garde la description de la SURFACE, qui ne change pas d'un onglet à
          l'autre. */}
      <PageHeader
        title="Runtime"
        description="Ce qui est réellement câblé sous les agents : le canal de retour, l’Agent Server, les outils, les providers, les modèles, les dépôts et l’outillage."
        meta={<RuntimeTabBar current={current} />}
      />

      <PageBody className="min-h-0 flex-1 gap-0">
        {/* LA SCÈNE de la surface — l'onglet courant, nommé et situé.
         *
         * Avant, le contenu tombait dans un `aig-panel` anonyme, de rang égal à
         * tout ce qu'il contenait : rien ne disait « voici la section du
         * runtime que vous regardez ». La scène porte cette identité, et le
         * contenu descend dans un CREUX qui l'accueille — deux rangs au lieu
         * d'un aplat. Le contenu lui-même appartient aux onglets, il n'est pas
         * touché ici. */}
        <section
          className="aig-stage aig-accent-edge flex min-h-0 flex-1 flex-col overflow-hidden"
          aria-label={tab.name}
        >
          <div className="shrink-0 px-4 pt-4 pb-3 sm:px-5">
            <h2 className="aig-display text-xl font-semibold sm:text-2xl">{tab.name}</h2>
            <p className="aig-text-muted mt-1 max-w-3xl text-sm">{tab.purpose}</p>
          </div>

          <div className="aig-hairline mx-4 shrink-0 sm:mx-5" />

          {/* `overflow-y-auto`, PAS `overflow-hidden` : un onglet dense (LangGraph
           * en porte six) dépassait la hauteur disponible et ses derniers
           * panneaux étaient COUPÉS à zéro — « Assistants du serveur » et
           * « Threads récents » mesuraient 0 px, contenu inatteignable, sans que
           * rien ne l'indique. C'est ici, dans la zone bornée, que la donnée
           * doit défiler. */}
          {/* Le creux EST le scroller — pas un conteneur de plus autour de lui.
           * Une boîte intermédiaire (`m-3` + un enfant `h-full`) cassait la
           * chaîne de hauteur flex ; `min-h-0` sur la colonne parente est ce qui
           * autorise ce flex-enfant à descendre sous la taille de son contenu.
           *
           * LIMITE MESURÉE (2026-08-02, 1280x800) : la box n'est PAS encore
           * fixe. Le document défile toujours (4014 px) et le creux fait 3730 px
           * sans défiler. La cause est AU-DESSUS de cet écran : tout le shell
           * (`html` / `body` / `main`, app-shell.tsx) est en `min-h-svh`, qui
           * pose un plancher et jamais un plafond — donc les ancêtres grandissent
           * avec le contenu et ce `flex-1` remplit un parent non borné. Tenir un
           * zéro-scroll ici exige de passer le shell en `h-svh overflow-hidden`,
           * geste structurant sur toutes les routes, non fait ici.
           * Détail : docs/visual-reviews/aigent-visual-composition-004-r5/. */}
          <div className="aig-inset scroll-thin m-3 mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto p-3 sm:mx-4 sm:mb-4">
            <TabPanel payload={payload} />
          </div>
        </section>
      </PageBody>
    </div>
  )
}
