import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import type { Metadata } from 'next'

import { CommandCard } from '@/components/dashboard/command-card'
import { FleetCard } from '@/components/dashboard/fleet-card'
import { ProjectsCard } from '@/components/dashboard/projects-card'
import { RecentActivityCard } from '@/components/dashboard/recent-activity-card'
import { RecommendationsCard } from '@/components/dashboard/recommendations-card'
import { Rail } from '@/components/dashboard/shell/rail'
import { Topbar } from '@/components/dashboard/shell/topbar'
import { getAdminHomeData, type AdminHomeData } from '@/lib/dashboard/home-data'

/**
 * /admin — la home de la console Aigent.
 *
 * Composant SERVEUR asynchrone. Il fait exactement deux choses : il APPELLE le
 * collecteur une seule fois, et il DISTRIBUE le modèle de vue aux sections.
 * Aucune métrique n'est ici recalculée, arrondie, sommée ni coalescée : chaque
 * chiffre affiché sur cet écran a été mesuré une fois dans
 * `src/lib/dashboard/home-data.ts`, sur une seule et même fenêtre de 24 h, ce
 * qui est la raison pour laquelle deux blocs de la page ne peuvent pas se
 * contredire sur un même instant.
 *
 * TROIS ÉTATS, TROIS RENDUS DISTINCTS — c'est le cœur de ce fichier.
 *
 *  1. ERREUR. `getAdminHomeData()` lit une couche fail-closed : elle LÈVE plutôt
 *     que d'inventer une flotte. `src/app/admin/error.tsx` est interdit par
 *     `scripts/check-no-legacy-front.mjs`, donc l'échec est rattrapé ICI et rendu
 *     comme un état d'erreur explicite, en rôle rouge, AVEC le châssis (barre +
 *     rail) pour que l'opérateur puisse encore naviguer. Une panne de backend ne
 *     doit jamais ressembler à un tableau de bord vide en bonne santé.
 *  2. DÉGRADÉ. `degraded === true` signifie qu'au moins un collecteur a renoncé.
 *     Une bannière rouge s'affiche AU-DESSUS de la grille et énonce les
 *     avertissements remontés. Un backend partiel ne se rend jamais en flotte
 *     saine — et le badge de la barre supérieure bascule sur le même rôle.
 *  3. VIDE. Une flotte saine mais vide rend les cartes avec LEURS propres
 *     phrases (« Aucun run démarré sur cette période. », « Aucun projet
 *     enregistré pour le moment. »), jamais une page blanche.
 *
 * Les `warnings` et les libellés d'`ActionItem` sont des CHAÎNES DE DONNÉES
 * forgées par la couche domaine, aujourd'hui en anglais. Ils sont rendus tels
 * quels : les traduire ici reviendrait à réécrire une donnée dans une vue.
 */

export const metadata: Metadata = {
  title: 'Tableau de bord — Aigent',
}

/** La route que cette page occupe — la tuile que le rail doit marquer active. */
const ACTIVE_HREF = '/admin'

/**
 * Le plan rouge, écrit une fois : bannière dégradée et état d'erreur portent le
 * MÊME rôle parce qu'ils disent la même chose à des degrés différents. Rôles de
 * `theme.css`, jamais un hex littéral, et jamais l'accent vert sur une panne.
 */
const DANGER_PANEL =
  'rounded-2xl bg-[color-mix(in_oklab,var(--state-danger-solid)_14%,transparent)] p-4 ring-1 ring-(color:--state-danger-solid-line)'

/**
 * Le châssis de la console : barre supérieure, puis rail + contenu.
 *
 * Rendu par les DEUX sorties de cette page (succès et erreur) — c'est ce qui
 * garantit qu'un backend en panne laisse quand même une navigation utilisable.
 * L'ordre est imposé par `shell/rail.tsx` : la barre est un frère AU-DESSUS de
 * la rangée rail+contenu, car la bande de navigation mobile est collée sous ses
 * 56 px (`top-14`) et la colonne desktop mesure `100dvh - 3.5rem`.
 */
function ConsoleFrame({
  degraded,
  executableNow,
  executableTotal,
  children,
}: {
  degraded: boolean
  executableNow: number | null
  executableTotal: number | null
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <Topbar degraded={degraded} executableNow={executableNow} executableTotal={executableTotal} />

      <div className="flex min-w-0 flex-1 flex-col md:flex-row">
        <Rail activeHref={ACTIVE_HREF} />
        <main className="min-w-0 flex-1 p-4 sm:p-5">{children}</main>
      </div>
    </div>
  )
}

/**
 * Le message d'une exception, tel qu'il a été levé.
 *
 * On montre le texte réel plutôt qu'une phrase générique : « une erreur est
 * survenue » n'aide personne à savoir si PostgREST est injoignable ou si une
 * variable d'environnement manque. Aucune valeur de repli n'est fabriquée.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return String(error)
}

export default async function AdminHomePage() {
  let data: AdminHomeData

  try {
    data = await getAdminHomeData()
  } catch (error) {
    // Couche fail-closed : rien n'a pu être lu, donc RIEN n'est affirmé. Le
    // badge de la barre part en rôle rouge et les deux compteurs partent en
    // `null` — ils ne sont pas à zéro, ils n'ont pas été mesurés.
    return (
      <ConsoleFrame degraded executableNow={null} executableTotal={null}>
        <h1 className="sr-only">Tableau de bord</h1>

        <section aria-labelledby="console-error-title" className={`flex min-w-0 items-start gap-3 ${DANGER_PANEL}`}>
          <ExclamationTriangleIcon
            aria-hidden="true"
            className="size-5 shrink-0 text-[var(--state-danger-text)]"
          />

          <div className="flex min-w-0 flex-col gap-2">
            <h2 id="console-error-title" className="text-sm font-semibold text-white">
              La console n&apos;a pas pu être chargée.
            </h2>
            <p className="text-xs text-zinc-300">
              La couche de données a échoué : aucune mesure de la flotte n&apos;est disponible. Cet
              écran affiche l&apos;échec plutôt qu&apos;un tableau de bord vide, qui se lirait comme
              une flotte saine et inactive.
            </p>
            {/* `wrap-break-word` et non `break-words` : ce dernier n'est plus
                une utilitaire Tailwind v4 (il ne survit que dans la table de
                migration), donc il ne produirait aucune règle et un message
                d'erreur d'un seul tenant déborderait la page. */}
            <p className="min-w-0 font-mono text-xs wrap-break-word text-zinc-400">
              {errorMessage(error)}
            </p>
            <p className="text-xs text-zinc-500">
              La navigation reste utilisable : le rail et la console des runs sont accessibles.
            </p>
          </div>
        </section>
      </ConsoleFrame>
    )
  }

  const { kpis } = data

  return (
    <ConsoleFrame
      degraded={data.degraded}
      executableNow={kpis.executableNow}
      executableTotal={kpis.executableTotal}
    >
      <h1 className="sr-only">Tableau de bord</h1>

      <div className="flex min-w-0 flex-col gap-4">
        {data.degraded ? (
          <section aria-labelledby="console-degraded-title" className={`flex min-w-0 items-start gap-3 ${DANGER_PANEL}`}>
            <ExclamationTriangleIcon
              aria-hidden="true"
              className="size-5 shrink-0 text-[var(--state-danger-text)]"
            />

            <div className="flex min-w-0 flex-col gap-2">
              <h2 id="console-degraded-title" className="text-sm font-semibold text-white">
                Console dégradée — certains chiffres de cet écran sont incomplets.
              </h2>
              <p className="text-xs text-zinc-300">
                Au moins un collecteur n&apos;a pas répondu. Les blocs concernés le disent
                eux-mêmes ; ne lisez pas cet écran comme une image complète de la flotte.
              </p>

              {data.warnings.length > 0 ? (
                // Les avertissements sont des chaînes remontées par la couche
                // domaine : rendues verbatim, sans traduction ni reformulation.
                <ul className="flex min-w-0 flex-col gap-1">
                  {data.warnings.map((warning) => (
                    <li key={warning} className="min-w-0 font-mono text-xs wrap-break-word text-zinc-400">
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* La grille du cadre de référence.
            · < 768 px  : une colonne, tout empilé.
            · 768–1279  : DEUX colonnes — bloc de gauche | carte centrale, et le
              panneau d'activité repositionné EN DESSOUS, pleine largeur
              (`md:col-span-2`).
            · ≥ 1280 px : douze colonnes — 4 | 5 | 3.
            `min-w-0` sur les enfants qui portent du texte ou un tableau : c'est
            la correction classique du débordement horizontal en grille. */}
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
          {/* Colonne de gauche (4/12) : la carte de synthèse, puis les deux
              cartes latérales. Elles se mettent côte à côte dès `sm`, où la page
              est encore sur une seule colonne et leur laisse ~300 px chacune ;
              à partir de `md` la colonne devient un enfant de grille de 330 à
              450 px, où deux cartes de 160-200 px rogneraient leurs propres
              lignes (« Indisponible » seul demande ~220 px de contenu). Elles
              reprennent donc toute la largeur de la colonne. */}
          <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
            <CommandCard
              success24h={kpis.success24h}
              runs24h={kpis.runs24h}
              cost24h={kpis.cost24h}
              needsAction={kpis.needsAction}
              // Passe-plat intégral : le total EST `executableTotal`, la part
              // EST `executableNow`. Aucune arithmétique ici — et si l'une des
              // deux moitiés manque, la bande cède la place au mot, sans
              // inventer un dénominateur.
              distribution={
                kpis.executableNow === null || kpis.executableTotal === null
                  ? null
                  : {
                      caption: 'Agents exécutables',
                      total: kpis.executableTotal,
                      shares: [
                        {
                          key: 'executable',
                          label: 'Exécutables',
                          count: kpis.executableNow,
                          tone: 'accent',
                        },
                      ],
                    }
              }
              actions={data.actionItems}
            />

            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-1">
              <RecommendationsCard
                // `.at(0)` plutôt qu'un index : sans
                // `noUncheckedIndexedAccess`, `actionItems[0]` est typé
                // non-optionnel et la branche « file vide » deviendrait une
                // comparaison que le compilateur juge impossible.
                featured={data.actionItems.at(0) ?? null}
                projects={data.topProjects}
              />

              <ProjectsCard
                projects={data.projects}
                executableNow={kpis.executableNow}
                executableTotal={kpis.executableTotal}
                productionAgents={kpis.productionAgents}
              />
            </div>
          </div>

          {/* Colonne centrale (5/12) — volume de runs + tableau dense. */}
          <FleetCard
            hourlyBuckets={data.hourlyBuckets}
            recentRunRows={data.recentRunRows}
            className="min-w-0 xl:col-span-5"
          />

          {/* Colonne de droite (3/12) — passe SOUS les deux blocs sur tablette. */}
          <RecentActivityCard
            recentRuns={data.recentRuns}
            availableAgents={data.availableAgents}
            availableAgentTotal={data.availableAgentTotal}
            className="min-w-0 md:col-span-2 xl:col-span-3"
          />
        </div>
      </div>
    </ConsoleFrame>
  )
}
