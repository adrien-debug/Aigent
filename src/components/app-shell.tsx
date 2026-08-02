'use client'

/**
 * Shell applicatif Aigent — surface continue, graphite travaillé.
 *
 * CE QUI A CHANGÉ, ET POURQUOI. L'ancien shell juxtaposait un rail sombre et
 * une zone de travail CLAIRE. La couture entre les deux était la frontière la
 * plus visible du produit, et chaque page décidait ensuite seule de son propre
 * fond — d'où quatre langages sur onze écrans. Ici le document entier est
 * graphite (`layout.tsx`), le rail est un CREUX (`--aig-subtle`) et la zone de
 * travail monte d'un palier. La hiérarchie vient de la VALEUR, pas d'une
 * frontière de couleur.
 *
 * RÈGLE ABSOLUE INCHANGÉE : `src/components/ui/` ne se modifie pas (gate
 * `check:ui-kit-integrity`). Tout passe par la composition et les utilitaires
 * `aig-*` de `globals.css`. Catalyst reste la fondation ; il rend nativement
 * sombre grâce à la classe `dark` posée sur `<html>`.
 *
 * LE HEADER DE PAGE VIT ICI, PAS DANS CHAQUE ÉCRAN. Avant, chaque page
 * recomposait son titre, sa description et ses actions à sa manière — trois
 * hiérarchies typographiques différentes pour la même chose. `PageHeader` est
 * la seule, et le shell la place au bon endroit.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import * as Headless from '@headlessui/react'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'

import { NAVIGATION, activeNavHref } from '@/components/navigation'
import { Avatar } from '@/components/ui/avatar'
import {
  Sidebar,
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarHeading,
  SidebarItem,
  SidebarLabel,
  SidebarSection,
} from '@/components/ui/sidebar'

function Mark({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M12 2.2 21.8 12 12 21.8 2.2 12 12 2.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M12 7.4 16.6 12 12 16.6 7.4 12 12 7.4Z" fill="currentColor" fillOpacity="0.9" />
    </svg>
  )
}

function OpenMenuIcon() {
  return (
    <svg data-slot="icon" viewBox="0 0 20 20" aria-hidden="true" className="size-5 fill-current">
      <path d="M2 6.75C2 6.33579 2.33579 6 2.75 6H17.25C17.6642 6 18 6.33579 18 6.75C18 7.16421 17.6642 7.5 17.25 7.5H2.75C2.33579 7.5 2 7.16421 2 6.75ZM2 13.25C2 12.8358 2.33579 12.5 2.75 12.5H17.25C17.6642 12.5 18 12.8358 18 13.25C18 13.6642 17.6642 14 17.25 14H2.75C2.33579 14 2 13.6642 2 13.25Z" />
    </svg>
  )
}

function CloseMenuIcon() {
  return (
    <svg data-slot="icon" viewBox="0 0 20 20" aria-hidden="true" className="size-5 fill-current">
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  )
}

/**
 * Le rail de navigation.
 *
 * CE QUI CHANGE. `SidebarItem` de Catalyst marque l'entrée courante par un
 * simple fond — sur onze entrées graphite, la marque était presque invisible et
 * on ne savait pas où l'on était. On ajoute donc un LISERÉ CUIVRE à gauche de
 * l'entrée active : c'est le seul endroit du produit où l'accent signale une
 * position plutôt qu'une action, et c'est justifié — savoir où l'on se trouve
 * est le premier service que rend une navigation.
 *
 * Le kit n'est PAS modifié (gate `check:ui-kit-integrity`) : le liseré est un
 * `span` frère posé par la composition, pas une réécriture de `SidebarItem`.
 */
function NavigationSidebar({ pathname }: Readonly<{ pathname: string }>) {
  const current = activeNavHref(pathname)

  return (
    <Sidebar>
      <SidebarHeader className="aig-line-soft border-b">
        <div className="flex items-center gap-2.5">
          <Mark className="aig-accent size-5 shrink-0" />
          <div className="min-w-0">
            <SidebarLabel className="aig-display font-semibold tracking-[0.24em]">
              AIGENT
            </SidebarLabel>
            <p className="aig-text-faint text-3xs uppercase tracking-[0.18em]">Plan de contrôle</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarBody>
        <SidebarSection>
          <SidebarHeading className="aig-text-faint">Surfaces</SidebarHeading>
          {NAVIGATION.map((entry) => {
            const isCurrent = current === entry.href
            return (
              <div key={entry.href} className="relative">
                {isCurrent ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-1 left-0 z-10 w-0.5 rounded-full bg-[var(--aig-accent)]"
                  />
                ) : null}
                <SidebarItem href={entry.href} current={isCurrent}>
                  <entry.icon
                    data-slot="icon"
                    aria-hidden="true"
                    className={clsx(isCurrent && 'text-[var(--aig-accent)]')}
                  />
                  <SidebarLabel className={clsx(isCurrent && 'font-semibold')}>
                    {entry.name}
                  </SidebarLabel>
                </SidebarItem>
              </div>
            )
          })}
        </SidebarSection>
      </SidebarBody>

      <SidebarFooter className="aig-line-soft border-t">
        <div className="flex items-center gap-3 px-1 py-1">
          <Avatar square initials="A" className="aig-raised size-9 outline-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Session locale</p>
            <p className="aig-text-faint truncate text-xs">Opérateur Aigent</p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

/**
 * L'en-tête de page — titre, contexte, actions. UNE seule implémentation.
 *
 * `sticky` + `aig-overlay` : en défilant dans une longue table de runs, on perd
 * sinon le nom de la surface qu'on regarde et les actions qui s'y rapportent.
 * L'overlay est le seul rôle autorisé à se superposer, et il ne passe jamais
 * au-dessus d'un graphique — seulement au-dessus du flux du document.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  eyebrow,
}: Readonly<{
  title: string
  description?: string
  /** Actions principales de la surface. Jamais un bouton inerte. */
  actions?: ReactNode
  /** Contexte chiffré de la page (fenêtre, plafond, provenance). */
  meta?: ReactNode
  /** Le rang de la surface dans le produit — situe avant de nommer. */
  eyebrow?: string
}>) {
  return (
    // `shrink-0` : les écrans BORNÉS (`/actions`, `/projects`, `/builder`) sont
    // des colonnes flex en `h-svh overflow-hidden`. Sans lui, l'en-tête est le
    // premier à céder quand la donnée pousse — le titre de la surface se
    // comprimerait pour laisser de la place à une liste qui a déjà son propre
    // scroll. `sticky` reste inoffensif dans ce cas : sans scroll de document,
    // il n'a simplement rien à faire.
    //
    // LA DESCRIPTION EST DESCENDUE D'UN RANG. Elle occupait la même ligne
    // typographique que le titre et pesait autant que lui ; sur onze surfaces,
    // l'en-tête ressemblait à un paragraphe de documentation posé au-dessus du
    // produit. Le titre monte (`text-2xl`, blanc métallique), la description
    // passe en `text-2xs` et se tronque à une ligne : elle situe, elle ne
    // raconte plus.
    <header className="aig-overlay aig-line-soft sticky top-0 z-20 shrink-0 border-b px-4 py-3.5 sm:px-6 max-lg:pl-16">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <p className="aig-text-faint text-3xs font-medium uppercase tracking-[0.2em]">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="aig-display truncate text-xl font-semibold sm:text-2xl">{title}</h1>
          {description ? (
            <p className="aig-text-muted mt-0.5 max-w-4xl truncate text-2xs">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {meta ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">{meta}</div>
      ) : null}
    </header>
  )
}

/**
 * Le corps d'une surface — la gouttière commune, et rien d'autre.
 *
 * Pas de `max-width` : une console d'opérateur qui centre son contenu dans une
 * colonne de 1200px sur un écran de 2560px gaspille la moitié de la surface
 * utile, précisément là où une table de runs en profiterait. On respire par
 * l'espacement interne, pas en rétrécissant le champ.
 */
export function PageBody({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  // `gap-5` plutôt que `gap-4` : la respiration entre deux zones de RANG
  // différent doit être plus large que celle entre deux éléments d'une même
  // zone, sinon la page se lit comme une liste uniforme — c'est l'espacement,
  // autant que la matière, qui construit la hiérarchie.
  return (
    <div className={clsx('flex min-w-0 flex-col gap-5 px-4 pb-6 pt-5 sm:px-6', className)}>
      {children}
    </div>
  )
}

function MobileNavButton({ onOpen }: Readonly<{ onOpen: () => void }>) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Ouvrir la navigation"
      // `aig-overlay` et non `aig-panel-raised` : le bouton flotte AU-DESSUS du
      // contenu qui défile dessous. Un panneau opaque s'y confondait avec une
      // carte de la page ; l'overlay est le seul rôle qui dit « je surnage ».
      className="aig-overlay aig-line-soft fixed left-4 top-3 z-30 inline-flex size-10 items-center justify-center rounded-lg border lg:hidden"
    >
      <OpenMenuIcon />
    </button>
  )
}

export default function AppShell({ children }: Readonly<{ children?: ReactNode }>) {
  const [showSidebar, setShowSidebar] = useState(false)
  const pathname = usePathname() ?? '/'

  return (
    <div className="aig-subtle flex min-h-svh">
      <Headless.Dialog open={showSidebar} onClose={setShowSidebar} className="lg:hidden">
        <Headless.DialogBackdrop
          transition
          className="fixed inset-0 z-40 bg-(--aig-scrim) backdrop-blur-sm transition-opacity data-closed:opacity-0"
        />
        <Headless.DialogPanel
          transition
          className="fixed inset-y-0 left-0 z-50 w-full max-w-80 p-2 transition duration-300 ease-in-out data-closed:-translate-x-full"
        >
          {/* `overflow-y-auto` ici aussi : sur un téléphone en paysage (375×812
              couché, ou tout appareil sous ~640 px de haut), les onze entrées
              débordaient du panneau sans moyen d'y accéder. */}
          <div className="aig-panel-raised scroll-thin flex h-full flex-col overflow-y-auto">
            <div className="flex shrink-0 justify-end px-3 pt-3">
              <Headless.CloseButton
                type="button"
                aria-label="Fermer la navigation"
                // Cible tactile pleine (44 px) et contraste réel : l'icône
                // était un glyphe gris de 20 px sans surface propre, quasi
                // invisible sur le graphite du panneau.
                className="aig-panel aig-text-muted inline-flex size-10 items-center justify-center transition hover:bg-(--aig-line-soft) hover:text-(--aig-text)"
              >
                <CloseMenuIcon />
              </Headless.CloseButton>
            </div>
            <NavigationSidebar pathname={pathname} />
          </div>
        </Headless.DialogPanel>
      </Headless.Dialog>

      {/* Rail permanent — un CREUX à gauche, pas une bande étrangère collée au
          produit. Le liseré suffit à le séparer de la zone de travail.

          `overflow-y-auto` sur le rail : en FAIBLE HAUTEUR (fenêtre de 600 px,
          écran 13" avec inspecteur ouvert), onze entrées + en-tête + pied
          dépassent `h-svh`. Sans scroll propre, les dernières surfaces et le
          bloc de session devenaient inatteignables — la navigation cessait de
          naviguer. */}
      <div className="aig-subtle aig-line-soft scroll-thin hidden w-64 shrink-0 border-r lg:sticky lg:top-0 lg:block lg:h-svh lg:max-h-svh lg:self-start lg:overflow-y-auto">
        <NavigationSidebar pathname={pathname} />
      </div>

      {/* Zone de travail — elle monte d'un palier sur le rail.

          `min-h-svh` + `flex-col` : les écrans qui veulent occuper la hauteur
          (une scène dominante, un flux qui respire) peuvent le faire avec
          `flex-1`, au lieu de flotter en haut d'un viewport à moitié vide. */}
      <main className="aig-base flex min-h-svh min-w-0 flex-1 flex-col">
        <MobileNavButton onOpen={() => setShowSidebar(true)} />
        {children}
      </main>
    </div>
  )
}
