'use client'

/**
 * Cadre du poste de contrôle — composants Catalyst officiels, apparence
 * Catalyst native (voie A, décision du 2026-07-31).
 *
 * RÈGLE ABSOLUE : `src/components/ui/` ne se modifie pas (gate
 * `check:catalyst-integrity`). Tout ce qui est réglé ici l'est par la
 * COMPOSITION et le layout, jamais en repeignant le kit.
 *
 * `SidebarLayout` n'est pas utilisé : il pose `min-h-svh` et un `<main>` qui
 * grandit avec son contenu, deux choses incompatibles avec un cockpit qui tient
 * dans le viewport et porte une colonne de décision à droite. On assemble donc
 * les mêmes composants (`Sidebar*`, `NavbarItem`, `Headless.Dialog` — exactement
 * ceux que `SidebarLayout` utilise en interne) dans une coquille dont la hauteur
 * est bornée. Le zéro-scroll vient de ce layout, pas d'une retouche du kit.
 */
import { useState } from 'react'
import type { ComponentType, ReactNode, SVGProps } from 'react'
import * as Headless from '@headlessui/react'
import {
  BoltIcon,
  CpuChipIcon,
  FolderIcon,
  RocketLaunchIcon,
  SignalIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline'

import { NavbarItem } from '@/components/ui/navbar'
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
import { Text } from '@/components/ui/text'

type NavEntry = {
  name: string
  /** `undefined` = écran non construit : l'entrée est inerte, jamais un `#`. */
  href?: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  current?: boolean
}

/**
 * Le cockpit est le seul écran construit à ce jour. Les autres entrées nomment
 * les domaines réels d'Aigent et restent VISIBLEMENT inactives : `SidebarItem`
 * sans `href` rend un `<button>` — on le passe `disabled`, ce qui annonce la
 * carte du produit sans jamais feindre une navigation qui n'existe pas.
 */
const navigation: NavEntry[] = [
  { name: 'Cockpit', href: '/', icon: Squares2X2Icon, current: true },
  { name: 'Agents', icon: CpuChipIcon },
  { name: 'Projets', icon: FolderIcon },
  { name: 'Runs', icon: BoltIcon },
  { name: 'Livraisons', icon: RocketLaunchIcon },
  { name: 'Télémétrie', icon: SignalIcon },
]

/** Marque Aigent — visualisation d'identité, hors périmètre du kit. */
function Mark({ className }: { className?: string }) {
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
    <svg data-slot="icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2 6.75C2 6.33579 2.33579 6 2.75 6H17.25C17.6642 6 18 6.33579 18 6.75C18 7.16421 17.6642 7.5 17.25 7.5H2.75C2.33579 7.5 2 7.16421 2 6.75ZM2 13.25C2 12.8358 2.33579 12.5 2.75 12.5H17.25C17.6642 12.5 18 12.8358 18 13.25C18 13.6642 17.6642 14 17.25 14H2.75C2.33579 14 2 13.6642 2 13.25Z" />
    </svg>
  )
}

function CloseMenuIcon() {
  return (
    <svg data-slot="icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  )
}

function NavigationSidebar() {
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2.5">
          <Mark className="size-5 shrink-0 text-zinc-950 dark:text-white" />
          <SidebarLabel className="font-semibold tracking-[0.22em] text-zinc-950 dark:text-white">
            AIGENT
          </SidebarLabel>
        </div>
      </SidebarHeader>

      <SidebarBody>
        <SidebarSection>
          <SidebarHeading>Plan de contrôle</SidebarHeading>
          {navigation.map((entry) =>
            entry.href ? (
              <SidebarItem key={entry.name} href={entry.href} current={entry.current}>
                <entry.icon data-slot="icon" aria-hidden="true" />
                <SidebarLabel>{entry.name}</SidebarLabel>
              </SidebarItem>
            ) : (
              <SidebarItem key={entry.name} disabled title={`${entry.name} — écran à venir`}>
                <entry.icon data-slot="icon" aria-hidden="true" />
                <SidebarLabel>{entry.name}</SidebarLabel>
              </SidebarItem>
            ),
          )}
        </SidebarSection>
      </SidebarBody>

      <SidebarFooter>
        <Text>Écrans à venir désactivés</Text>
      </SidebarFooter>
    </Sidebar>
  )
}

export default function AppShell({
  children,
  aside,
  topbar,
}: {
  children?: ReactNode
  aside?: ReactNode
  topbar?: ReactNode
}) {
  const [showSidebar, setShowSidebar] = useState(false)

  return (
    <div className="flex h-full overflow-hidden bg-white dark:bg-zinc-900">
      {/* Tiroir mobile — la mécanique du `MobileSidebar` de Catalyst */}
      <Headless.Dialog open={showSidebar} onClose={setShowSidebar} className="lg:hidden">
        <Headless.DialogBackdrop
          transition
          className="fixed inset-0 z-40 bg-black/30 transition data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in"
        />
        <Headless.DialogPanel
          transition
          className="fixed inset-y-0 z-50 w-full max-w-80 p-2 transition duration-300 ease-in-out data-closed:-translate-x-full"
        >
          <div className="flex h-full flex-col rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
            <div className="-mb-3 px-4 pt-3">
              <Headless.CloseButton as={NavbarItem} aria-label="Fermer la navigation">
                <CloseMenuIcon />
              </Headless.CloseButton>
            </div>
            <NavigationSidebar />
          </div>
        </Headless.DialogPanel>
      </Headless.Dialog>

      {/* Sidebar desktop */}
      {/* `h-full min-h-0` : c'est cette borne qui fait défiler `SidebarBody`
          dans la colonne au lieu de pousser le shell hors du viewport. */}
      <div className="hidden h-full min-h-0 w-64 shrink-0 border-r border-zinc-950/5 lg:block dark:border-white/5">
        <NavigationSidebar />
      </div>

      {/* Colonne principale — hauteur bornée, c'est elle qui tient le zéro-scroll */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-zinc-950/5 px-4 dark:border-white/5">
          <div className="lg:hidden">
            <NavbarItem onClick={() => setShowSidebar(true)} aria-label="Ouvrir la navigation">
              <OpenMenuIcon />
            </NavbarItem>
          </div>
          <div className="min-w-0 flex-1">{topbar}</div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
          <aside className="hidden w-80 shrink-0 border-l border-zinc-950/5 xl:block dark:border-white/5">
            {aside}
          </aside>
        </div>
      </div>
    </div>
  )
}
