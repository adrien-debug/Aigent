/**
 * Onglet « Outillage visuel » — l'état réel des sept outils.
 *
 * CE QUE CET ÉCRAN REFUSE DE DIRE. Le vocabulaire complet est disponible
 * (`INSTALLED` → `VERIFIED`), mais rien n'est promu au-delà de ce qui est
 * mesuré : une sonde HTTP mène au mieux à `CONNECTED`. Le seul `VERIFIED` de la
 * console est le Canvas, dont la preuve est produite dans la même application et
 * gardée par un harnais qui échoue si le graphe manque.
 *
 * DENSE, PAS DÉCORATIF. Une ligne par outil, sur une grille alignée : statut,
 * nom, fonction, endpoint, dernier contrôle, action. Les sept tiennent dans le
 * premier viewport à 1440×900. Ce qui est long — détail de l'erreur, marche à
 * suivre — vit dans un `<details>` et n'occupe la place que si on le demande.
 */
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { Panel } from '@/components/cockpit/primitives'
import type { ToolProbe, ToolStatus, VisualToolingData } from './visual-tooling'

/**
 * Une couleur par état — mais l'état est TOUJOURS écrit en toutes lettres à
 * côté : la couleur seule n'est pas une information accessible.
 */
const STATUS_COLOR: Record<ToolStatus, 'lime' | 'emerald' | 'amber' | 'sky' | 'zinc' | 'red'> = {
  VERIFIED: 'emerald',
  CONNECTED: 'lime',
  RUNNING: 'lime',
  CONFIGURED: 'amber',
  INSTALLED: 'sky',
  NOT_CONFIGURED: 'zinc',
  UNAVAILABLE: 'zinc',
  ERROR: 'red',
}

/** Ce que chaque état signifie, dit à l'écran plutôt que supposé connu. */
const STATUS_MEANING: Record<ToolStatus, string> = {
  VERIFIED: 'fait démontrablement son travail',
  CONNECTED: 'a répondu et accepté l’appel',
  RUNNING: 'a répondu',
  CONFIGURED: 'adresse connue, sans réponse',
  INSTALLED: 'présent, non contacté',
  // Deux absences DIFFÉRENTES, que la couleur seule confondrait : rien à
  // sonder (personne ne l'a installé) vs sondé et muet (il est cassé).
  NOT_CONFIGURED: 'aucune adresse — jamais sondé',
  UNAVAILABLE: 'non mesurable depuis le serveur',
  ERROR: 'adresse connue, sonde en échec',
}

/** Un lien externe s'ouvre dans un onglet neuf ; un lien interne, non. */
function isExternal(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

/**
 * Le disclosure de détail — même contenu aux deux compositions.
 *
 * Le déclencheur est un texte secondaire qui monte au survol : la grammaire
 * porte les deux niveaux (`aig-text-muted` au repos, texte plein au survol), là
 * où la paire `text-zinc-500 / dark:hover:text-zinc-100` dosait une moitié
 * claire qui ne se rendait jamais sous un document sombre.
 */
function ToolDetail({ tool }: Readonly<{ tool: ToolProbe }>) {
  return (
    <details className="group shrink-0">
      <summary className="aig-text-muted cursor-pointer list-none text-2xs select-none hover:text-[color:var(--aig-text)]">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span> Détail
      </summary>
      <div className="aig-line-soft mt-1 flex flex-col gap-1 border-l pl-2">
        <Text className="aig-text-muted text-2xs">{tool.detail}</Text>
        {tool.remediation ? (
          // L'ambre est une SÉVÉRITÉ (« il manque quelque chose à faire »), pas
          // une surface : elle reste, remontée en `-500` — la teinte `-600` avait
          // été calibrée pour un fond blanc et s'éteignait sur graphite.
          <Text className="text-2xs text-(--aig-severity-warn)">
            Pour l’activer : {tool.remediation}
          </Text>
        ) : null}
      </div>
    </details>
  )
}

/**
 * Les actions d'un outil.
 *
 * PAS DE BOUTON QUI NE FAIT RIEN. « Ouvrir » est un vrai lien et n'apparaît que
 * si une URL existe. Là où il n'y a rien à cliquer, on affiche une MENTION, pas
 * un bouton désactivé : un bouton grisé promet une action et invite au clic,
 * puis ne fait rien — le `title` qui portait la procédure était invisible au
 * tactile, précisément là où l'écran est le plus contraint. La procédure vit
 * désormais dans le disclosure « Détail », atteignable partout.
 */
function ToolActions({ tool }: Readonly<{ tool: ToolProbe }>) {
  if (tool.url) {
    return (
      <Button
        href={tool.url}
        plain
        className="!text-xs"
        {...(isExternal(tool.url)
          ? // `noreferrer` : l'URL d'Aigent ne part pas dans le Referer d'un tiers.
            { target: '_blank', rel: 'noreferrer noopener' }
          : {})}
      >
        Ouvrir
      </Button>
    )
  }

  if (tool.remediation) {
    return (
      <span className="aig-text-muted text-2xs whitespace-nowrap italic">Configuration externe</span>
    )
  }

  return null
}

function ToolRow({ tool }: Readonly<{ tool: ToolProbe }>) {
  return (
    /*
      DEUX COMPOSITIONS, PAS UNE GRILLE RÉTRÉCIE.

      À 375 px, la grille `6.5rem / contenu / actions` laissait ~120 px à la
      colonne centrale : « LangGraph Agent Server » se cassait en trois lignes,
      « adresse connue, sonde en échec » tombait un mot par ligne, et le bouton
      sortait du panneau. Rien de tout cela ne produit d'overflow au niveau du
      document — la page ne débordait pas, elle était simplement illisible.

      Mobile empile donc verticalement : identité, puis fonction, puis les faits
      de sonde et l'action. La grille dense reprend à partir de `sm:`, où la
      largeur la rend lisible.

      LA COLONNE DE STATUT SE MESURE, ELLE NE SE DEVINE PAS. Elle a valu
      `6.5rem` — 104 px, une constante posée à la main. `NOT_CONFIGURED` rend
      123 px : le badge débordait sa piste de 19 px et venait chevaucher le nom
      de l'outil (mesuré à 1440×900 : bord droit du badge à x=449, début du nom
      à x=442, soit -7 px). « NOT_CONFIGUREDGrafana » se lisait comme un seul
      mot. `auto` laisse le PLUS LARGE des badges dimensionner la piste : le
      `gap-x-3` redevient une gouttière réelle au lieu d'un reliquat, et aucun
      libellé de statut futur ne pourra plus manger la colonne voisine.
    */
    <li
      className="aig-line-soft flex flex-col gap-1.5 border-b py-2 last:border-0 sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-baseline sm:gap-x-3 sm:gap-y-0 sm:py-1.5"
      data-testid="visual-tool-row"
      data-tool={tool.id}
      data-status={tool.status}
    >
      {/* Ligne 1 mobile : statut + identité côte à côte. */}
      <div className="flex min-w-0 items-center gap-2 sm:contents">
        <Badge color={STATUS_COLOR[tool.status]} className="shrink-0 sm:justify-self-start">
          {tool.status}
        </Badge>

        <div className="flex min-w-0 flex-1 flex-col sm:flex-none">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {/* Le nom est le texte PLEIN de la grammaire — il n'a plus besoin
                d'être repeint, `aig-panel` porte déjà la couleur de texte. */}
            <span className="text-sm font-semibold">{tool.name}</span>
            {tool.version ? <Badge color="zinc">v{tool.version}</Badge> : null}
            <Text className="aig-text-muted text-2xs">{STATUS_MEANING[tool.status]}</Text>
            {tool.url ? (
              <code className="aig-text-muted hidden truncate font-mono text-2xs sm:inline">
                {tool.url}
              </code>
            ) : null}
          </div>

          {/* Fonction et faits de sonde — sur une seule ligne dès `sm:`. */}
          <div className="hidden min-w-0 flex-wrap items-baseline gap-x-2 sm:flex">
            <Text className="aig-text-muted min-w-0 flex-1 truncate text-xs">
              {tool.purpose}
            </Text>
            <span className="aig-text-muted shrink-0 text-2xs">
              {tool.latencyMs !== null ? `${tool.latencyMs} ms · ` : ''}
              {tool.checkedAt === null ? 'jamais sondé' : `contrôlé ${tool.checkedAt.slice(11, 19)} UTC`}
            </span>
            <ToolDetail tool={tool} />
          </div>
        </div>
      </div>

      {/* Région 2 mobile : la fonction, pleine largeur, sans troncature. */}
      <Text className="aig-text-muted text-xs sm:hidden">{tool.purpose}</Text>

      {/* Ligne 3 mobile : contrôle, détail et action. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:hidden">
        <span className="aig-text-muted text-2xs">
          {/*
            Jamais de « 0 ms » ni de date fabriquée quand rien n'a été sondé :
            l'absence de contrôle est dite, pas coercée en zéro.
          */}
          {tool.latencyMs !== null ? `${tool.latencyMs} ms · ` : ''}
          {tool.checkedAt === null ? 'jamais sondé' : `contrôlé ${tool.checkedAt.slice(11, 19)} UTC`}
        </span>
        <ToolDetail tool={tool} />
        <div className="ml-auto shrink-0">
          <ToolActions tool={tool} />
        </div>
      </div>

      {/* Colonne d'actions — desktop uniquement, la version mobile est ci-dessus. */}
      <div className="hidden items-center gap-1.5 sm:flex sm:justify-self-end">
        <ToolActions tool={tool} />
      </div>
    </li>
  )
}

export default function VisualToolingTab({ data }: Readonly<{ data: VisualToolingData }>) {
  return (
    <div className="flex flex-col gap-3" data-testid="visual-tooling">
      <Panel
        title="Outillage visuel"
        // Court exprès : le hint de `Panel` est `shrink-0 truncate`, donc à
        // 375px « … au dernier passage » se coupait en « au dernier passa ».
        // Un texte tronqué ne dit pas ce qu'il prétend dire — mieux vaut une
        // formulation qui tient. Le détail temporel reste sur chaque ligne
        // (« contrôlé HH:MM:SS UTC »).
        hint={`${data.runningCount}/${data.tools.length} joignables`}
      >
        <Text className="aig-text-muted mb-1 text-2xs">
          Une sonde prouve qu’un service répond — pas qu’il fait son travail. Le
          seul « VERIFIED » est le Canvas, prouvé par un harnais qui échoue si le
          graphe manque.
        </Text>
        <ul className="flex flex-col">
          {data.tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </ul>
      </Panel>
    </div>
  )
}
