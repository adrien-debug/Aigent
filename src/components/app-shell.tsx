'use client'

/**
 * Cadre du poste de contrôle, bâti sur les composants Catalyst officiels :
 * `Sidebar` et ses sections pour la navigation, `Navbar` pour la barre d'état,
 * `Dialog` Headless pour le tiroir mobile (le même que celui qu'utilise
 * `SidebarLayout`).
 *
 * `SidebarLayout` lui-même n'est PAS utilisé : il impose `min-h-svh`, des
 * paddings de page (`p-6`/`lg:p-10`), un `max-w-6xl` et un `<main>` qui grandit
 * avec son contenu. Le cockpit, lui, tient dans le viewport sans jamais
 * scroller au niveau de la page et porte une colonne de décision à droite. On
 * compose donc les mêmes composants Catalyst dans une coquille dont la hauteur
 * est bornée — c'est de la composition, pas un layout concurrent.
 *
 * `h-full overflow-hidden` : seules les listes scrollent, dans leur box.
 */
import { useState } from 'react'
import type { ComponentType, ReactNode, SVGProps } from 'react'
import * as Headless from '@headlessui/react'
import clsx from 'clsx'
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
  SidebarItem,
  SidebarLabel,
  SidebarSection,
} from '@/components/ui/sidebar'

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
 * sans `href` rend un `<button disabled>` — la carte du produit s'annonce sans
 * jamais feindre une navigation qui n'existe pas.
 */
const navigation: NavEntry[] = [
  { name: 'Cockpit', href: '/', icon: Squares2X2Icon, current: true },
  { name: 'Agents', icon: CpuChipIcon },
  { name: 'Projets', icon: FolderIcon },
  { name: 'Runs', icon: BoltIcon },
  { name: 'Livraisons', icon: RocketLaunchIcon },
  { name: 'Télémétrie', icon: SignalIcon },
]

/** Marque Aigent — un losange creux traversé d'un éclat. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M12 2.2 21.8 12 12 21.8 2.2 12 12 2.2Z"
        stroke="var(--accent-main)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M12 7.4 16.6 12 12 16.6 7.4 12 12 7.4Z" fill="var(--accent-main)" fillOpacity="0.9" />
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

/** Une entrée de nav — lien réel, ou bouton inerte quand l'écran n'existe pas. */
function NavEntryItem({ entry, iconOnly = false }: { entry: NavEntry; iconOnly?: boolean }) {
  const label = entry.href ? entry.name : `${entry.name} — écran à venir`
  const icon = <entry.icon data-slot="icon" aria-hidden="true" />

  if (!entry.href) {
    return (
      <SidebarItem disabled title={label} className={iconOnly ? 'justify-center' : undefined}>
        {icon}
        {iconOnly ? <span className="sr-only">{label}</span> : <SidebarLabel>{entry.name}</SidebarLabel>}
      </SidebarItem>
    )
  }

  return (
    <SidebarItem
      href={entry.href}
      current={entry.current}
      title={label}
      className={iconOnly ? 'justify-center' : undefined}
    >
      {icon}
      {iconOnly ? <span className="sr-only">{entry.name}</span> : <SidebarLabel>{entry.name}</SidebarLabel>}
    </SidebarItem>
  )
}

function NavigationSidebar({ iconOnly = false }: { iconOnly?: boolean }) {
  return (
    <Sidebar>
      {/* `h-12` : la marque s'aligne exactement sur la barre d'état voisine. */}
      <SidebarHeader
        className={clsx('h-12 justify-center py-0', iconOnly ? 'items-center px-0' : 'px-3')}
      >
        <div className="flex items-center gap-2.5">
          <Mark className="size-5 shrink-0" />
          {iconOnly ? null : (
            <span className="text-[13px] font-semibold tracking-[0.26em] text-ink">AIGENT</span>
          )}
        </div>
      </SidebarHeader>

      <SidebarBody>
        <SidebarSection>
          {navigation.map((entry) => (
            <NavEntryItem key={entry.name} entry={entry} iconOnly={iconOnly} />
          ))}
        </SidebarSection>
      </SidebarBody>

      <SidebarFooter className={iconOnly ? 'items-center' : undefined}>
        <span
          aria-hidden
          title="Interface en ligne"
          className="pulse-live size-1.5 rounded-full bg-accent"
        />
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
    <div className="flex h-full overflow-hidden bg-base">
      {/* Tiroir mobile — même mécanique que le `MobileSidebar` de Catalyst */}
      <Headless.Dialog open={showSidebar} onClose={setShowSidebar} className="lg:hidden">
        <Headless.DialogBackdrop
          transition
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm transition data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in"
        />
        <Headless.DialogPanel
          transition
          className="fixed inset-y-0 z-50 w-full max-w-64 border-r border-edge bg-raised transition duration-300 ease-in-out data-closed:-translate-x-full"
        >
          <div className="flex h-full flex-col">
            <div className="absolute top-2.5 right-2 z-10">
              <Headless.CloseButton as={NavbarItem} aria-label="Fermer la navigation">
                <CloseMenuIcon />
              </Headless.CloseButton>
            </div>
            <NavigationSidebar />
          </div>
        </Headless.DialogPanel>
      </Headless.Dialog>

      {/* Rail desktop — la même `Sidebar` Catalyst, en mode icônes */}
      <div className="hidden w-16 border-r border-edge lg:block">
        <NavigationSidebar iconOnly />
      </div>

      {/* Colonne principale */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center border-b border-edge">
          <div className="pl-2 lg:hidden">
            <NavbarItem onClick={() => setShowSidebar(true)} aria-label="Ouvrir la navigation">
              <OpenMenuIcon />
            </NavbarItem>
          </div>
          <div className="min-w-0 flex-1">{topbar}</div>
        </div>

        <div className="flex min-h-0 flex-1">
          <main className="cockpit-substrate min-w-0 flex-1 overflow-hidden">{children}</main>
          <aside className="hidden w-80 border-l border-edge bg-base xl:block">{aside}</aside>
        </div>
      </div>
    </div>
  )
}
