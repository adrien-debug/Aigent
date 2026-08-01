'use client'

/**
 * Shell applicatif — sidebar sombre premium, zone de travail claire.
 *
 * RÈGLE ABSOLUE : `src/components/ui/` ne se modifie pas (gate
 * `check:ui-kit-integrity`). Tout le style passe par la composition, les
 * utilitaires du shell et un scope `dark` local sur la navigation.
 *
 * Pas de bandeau horizontal, pas de colonne droite : le contenu commence dans
 * la zone principale. La navigation mobile est un tiroir ; desktop = rail
 * sticky glossy noir.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import * as Headless from '@headlessui/react'
import { usePathname } from 'next/navigation'

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
    <svg data-slot="icon" viewBox="0 0 20 20" aria-hidden="true" className="fill-current">
      <path d="M2 6.75C2 6.33579 2.33579 6 2.75 6H17.25C17.6642 6 18 6.33579 18 6.75C18 7.16421 17.6642 7.5 17.25 7.5H2.75C2.33579 7.5 2 7.16421 2 6.75ZM2 13.25C2 12.8358 2.33579 12.5 2.75 12.5H17.25C17.6642 12.5 18 12.8358 18 13.25C18 13.6642 17.6642 14 17.25 14H2.75C2.33579 14 2 13.6642 2 13.25Z" />
    </svg>
  )
}

function CloseMenuIcon() {
  return (
    <svg data-slot="icon" viewBox="0 0 20 20" aria-hidden="true" className="fill-current">
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  )
}

function NavigationSidebar({ pathname }: Readonly<{ pathname: string }>) {
  const current = activeNavHref(pathname)

  return (
    <Sidebar className="text-white">
      <SidebarHeader className="border-white/10">
        <div className="flex items-center gap-2.5">
          <Mark className="size-5 shrink-0 text-white" />
          <SidebarLabel className="font-semibold tracking-[0.22em] text-white">
            AIGENT
          </SidebarLabel>
        </div>
      </SidebarHeader>

      <SidebarBody>
        <SidebarSection>
          <SidebarHeading className="text-white/45">Plan de contrôle</SidebarHeading>
          {NAVIGATION.map((entry) => (
            <SidebarItem key={entry.href} href={entry.href} current={current === entry.href}>
              <entry.icon data-slot="icon" aria-hidden="true" />
              <SidebarLabel>{entry.name}</SidebarLabel>
            </SidebarItem>
          ))}
        </SidebarSection>
      </SidebarBody>

      <SidebarFooter className="border-white/10">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <div className="flex items-center gap-3">
            <Avatar square initials="A" className="size-9 bg-white/10 text-white outline-white/10" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">Session locale</p>
              <p className="truncate text-xs text-white/55">Opérateur Aigent</p>
            </div>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function MobileNavButton({ onOpen }: Readonly<{ onOpen: () => void }>) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Ouvrir la navigation"
      className="shell-sidebar-surface dark fixed left-4 top-4 z-30 rounded-lg p-2.5 text-white shadow-lg ring-1 ring-white/10 transition hover:ring-white/20 lg:hidden"
    >
      <OpenMenuIcon />
    </button>
  )
}

export default function AppShell({ children }: Readonly<{ children?: ReactNode }>) {
  const [showSidebar, setShowSidebar] = useState(false)
  const pathname = usePathname() ?? '/'

  return (
    <div className="flex min-h-svh bg-white">
      <Headless.Dialog open={showSidebar} onClose={setShowSidebar} className="lg:hidden">
        <Headless.DialogBackdrop
          transition
          className="fixed inset-0 z-40 bg-black/40 transition-opacity data-closed:opacity-0"
        />
        <Headless.DialogPanel
          transition
          className="fixed inset-y-0 left-0 z-50 w-full max-w-80 p-2 transition duration-300 ease-in-out data-closed:-translate-x-full"
        >
          <div className="shell-sidebar-surface dark flex h-full flex-col rounded-lg shadow-2xl ring-1 ring-white/10">
            <div className="flex justify-end px-4 pt-3">
              <Headless.CloseButton
                type="button"
                aria-label="Fermer la navigation"
                className="rounded-lg p-2 text-white/80 transition hover:bg-white/8 hover:text-white"
              >
                <CloseMenuIcon />
              </Headless.CloseButton>
            </div>
            <NavigationSidebar pathname={pathname} />
          </div>
        </Headless.DialogPanel>
      </Headless.Dialog>

      <div
        className="shell-sidebar-surface dark hidden w-64 shrink-0 lg:sticky lg:top-0 lg:self-start lg:block lg:h-svh lg:max-h-svh"
      >
        <NavigationSidebar pathname={pathname} />
      </div>

      <main className="min-w-0 flex-1 bg-white">
        <MobileNavButton onOpen={() => setShowSidebar(true)} />
        {children}
      </main>
    </div>
  )
}
