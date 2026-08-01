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

function NavigationSidebar({ pathname }: Readonly<{ pathname: string }>) {
  const current = activeNavHref(pathname)

  return (
    <Sidebar>
      <SidebarHeader className="aig-line-soft border-b">
        <div className="flex items-center gap-2.5">
          <Mark className="aig-accent size-5 shrink-0" />
          <SidebarLabel className="font-semibold tracking-[0.22em]">AIGENT</SidebarLabel>
        </div>
        <p className="aig-text-faint mt-1 text-3xs uppercase tracking-[0.18em]">Plan de contrôle</p>
      </SidebarHeader>

      <SidebarBody>
        <SidebarSection>
          <SidebarHeading className="aig-text-faint">Surfaces</SidebarHeading>
          {NAVIGATION.map((entry) => (
            <SidebarItem key={entry.href} href={entry.href} current={current === entry.href}>
              <entry.icon data-slot="icon" aria-hidden="true" />
              <SidebarLabel>{entry.name}</SidebarLabel>
            </SidebarItem>
          ))}
        </SidebarSection>
      </SidebarBody>

      <SidebarFooter className="aig-line-soft border-t">
        <div className="aig-panel flex items-center gap-3 p-3">
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
}: Readonly<{
  title: string
  description?: string
  /** Actions principales de la surface. Jamais un bouton inerte. */
  actions?: ReactNode
  /** Contexte chiffré de la page (fenêtre, plafond, provenance). */
  meta?: ReactNode
}>) {
  return (
    // `shrink-0` : les écrans BORNÉS (`/actions`, `/projects`, `/builder`) sont
    // des colonnes flex en `h-svh overflow-hidden`. Sans lui, l'en-tête est le
    // premier à céder quand la donnée pousse — le titre de la surface se
    // comprimerait pour laisser de la place à une liste qui a déjà son propre
    // scroll. `sticky` reste inoffensif dans ce cas : sans scroll de document,
    // il n'a simplement rien à faire.
    <header className="aig-overlay aig-line-soft sticky top-0 z-20 shrink-0 border-b px-4 py-4 sm:px-6 max-lg:pl-16">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
          {description ? (
            <p className="aig-text-muted mt-1 max-w-3xl text-sm">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {meta ? <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">{meta}</div> : null}
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
  return <div className={clsx('flex flex-col gap-4 px-4 py-4 sm:px-6', className)}>{children}</div>
}

function MobileNavButton({ onOpen }: Readonly<{ onOpen: () => void }>) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Ouvrir la navigation"
      className="aig-panel-raised fixed left-4 top-4 z-30 inline-flex size-10 items-center justify-center lg:hidden"
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
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity data-closed:opacity-0"
        />
        <Headless.DialogPanel
          transition
          className="fixed inset-y-0 left-0 z-50 w-full max-w-80 p-2 transition duration-300 ease-in-out data-closed:-translate-x-full"
        >
          <div className="aig-panel-raised flex h-full flex-col">
            <div className="flex justify-end px-4 pt-3">
              <Headless.CloseButton
                type="button"
                aria-label="Fermer la navigation"
                className="aig-text-muted rounded-lg p-2 transition hover:bg-white/8 hover:text-white"
              >
                <CloseMenuIcon />
              </Headless.CloseButton>
            </div>
            <NavigationSidebar pathname={pathname} />
          </div>
        </Headless.DialogPanel>
      </Headless.Dialog>

      {/* Rail permanent — un CREUX à gauche, pas une bande étrangère collée au
          produit. Le liseré suffit à le séparer de la zone de travail. */}
      <div className="aig-subtle aig-line-soft hidden w-64 shrink-0 border-r lg:sticky lg:top-0 lg:block lg:h-svh lg:max-h-svh lg:self-start">
        <NavigationSidebar pathname={pathname} />
      </div>

      {/* Zone de travail — elle monte d'un palier sur le rail. */}
      <main className="aig-base min-w-0 flex-1">
        <MobileNavButton onOpen={() => setShowSidebar(true)} />
        {children}
      </main>
    </div>
  )
}
