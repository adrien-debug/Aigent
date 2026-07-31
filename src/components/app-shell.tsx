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
 *
 * TROIS CHOSES QUE CE FICHIER TIENT
 * ---------------------------------
 * 1. **Aucune entrée inerte.** Les `<SidebarItem disabled>` ont disparu : ils
 *    rendaient des `<button disabled>` qui nommaient une surface sans y mener.
 *    Les dix entrées de `NAVIGATION` sont des liens vers des routes réelles ; ce
 *    sont les PAGES qui annoncent honnêtement ce qui n'est pas branché.
 * 2. **L'item courant est DÉRIVÉ du pathname**, pas codé en dur. Un `current`
 *    figé sur l'aperçu survivait à la navigation et désignait la mauvaise
 *    surface dès le premier deep link.
 * 3. **La colonne de décision reste atteignable sous 1280 px.** Elle était en
 *    `hidden xl:block` : à 1280×800 — taille de contrôle — la valeur de décision
 *    de l'écran était purement invisible, sans repli. Sous `xl` elle passe dans
 *    un tiroir `Headless.Dialog`, ouvert par un bouton du header qui n'apparaît
 *    QUE lorsqu'il y a réellement un `aside` à montrer.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import * as Headless from '@headlessui/react'
import { usePathname } from 'next/navigation'

import { NAVIGATION, activeNavHref } from '@/components/navigation'
import { NavbarItem } from '@/components/ui/navbar'
import {
  Sidebar,
  SidebarBody,
  SidebarHeader,
  SidebarHeading,
  SidebarItem,
  SidebarLabel,
  SidebarSection,
} from '@/components/ui/sidebar'

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

/** L'icône du tiroir de décision — une pile, comme l'entrée « Actions ». */
function OpenQueueIcon() {
  return (
    <svg data-slot="icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 5.75C3 5.33579 3.33579 5 3.75 5H16.25C16.6642 5 17 5.33579 17 5.75C17 6.16421 16.6642 6.5 16.25 6.5H3.75C3.33579 6.5 3 6.16421 3 5.75ZM3 10C3 9.58579 3.33579 9.25 3.75 9.25H16.25C16.6642 9.25 17 9.58579 17 10C17 10.4142 16.6642 10.75 16.25 10.75H3.75C3.33579 10.75 3 10.4142 3 10ZM3 14.25C3 13.8358 3.33579 13.5 3.75 13.5H11.25C11.6642 13.5 12 13.8358 12 14.25C12 14.6642 11.6642 15 11.25 15H3.75C3.33579 15 3 14.6642 3 14.25Z" />
    </svg>
  )
}

function NavigationSidebar({ pathname }: { pathname: string }) {
  const current = activeNavHref(pathname)

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

      {/* `SidebarBody` défile déjà : les dix entrées restent atteignables même
          sur une hauteur de viewport courte, sans faire scroller la page. */}
      <SidebarBody>
        <SidebarSection>
          <SidebarHeading>Plan de contrôle</SidebarHeading>
          {NAVIGATION.map((entry) => (
            <SidebarItem key={entry.href} href={entry.href} current={current === entry.href}>
              <entry.icon data-slot="icon" aria-hidden="true" />
              <SidebarLabel>{entry.name}</SidebarLabel>
            </SidebarItem>
          ))}
        </SidebarSection>
      </SidebarBody>
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
  const [showQueue, setShowQueue] = useState(false)
  // `usePathname()` peut rendre `null` hors contexte de route (rendu isolé) :
  // on retombe sur la racine plutôt que de jeter.
  const pathname = usePathname() ?? '/'

  return (
    <div className="flex h-full overflow-hidden bg-white dark:bg-zinc-900">
      {/* Tiroir mobile de NAVIGATION — la mécanique du `MobileSidebar` de Catalyst.
          Il glisse depuis la GAUCHE. */}
      <Headless.Dialog open={showSidebar} onClose={setShowSidebar} className="lg:hidden">
        <Headless.DialogBackdrop
          transition
          className="fixed inset-0 z-40 bg-black/30 transition data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in"
        />
        <Headless.DialogPanel
          transition
          className="fixed inset-y-0 left-0 z-50 w-full max-w-80 p-2 transition duration-300 ease-in-out data-closed:-translate-x-full"
        >
          <div className="flex h-full flex-col rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
            <div className="-mb-3 px-4 pt-3">
              <Headless.CloseButton as={NavbarItem} aria-label="Fermer la navigation">
                <CloseMenuIcon />
              </Headless.CloseButton>
            </div>
            <NavigationSidebar pathname={pathname} />
          </div>
        </Headless.DialogPanel>
      </Headless.Dialog>

      {/* Tiroir de DÉCISION sous `xl` — même mécanique, mais il glisse depuis la
          DROITE et il est masqué à partir de `xl`, là où la colonne est visible
          en permanence. Les deux tiroirs ne peuvent donc jamais se recouvrir :
          l'un ne vit qu'en dessous de `lg`, l'autre est fermé et retiré du DOM
          au-dessus de `xl`, et ils occupent des bords opposés entre les deux. */}
      {aside ? (
        <Headless.Dialog open={showQueue} onClose={setShowQueue} className="xl:hidden">
          <Headless.DialogBackdrop
            transition
            className="fixed inset-0 z-40 bg-black/30 transition data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in"
          />
          <Headless.DialogPanel
            transition
            className="fixed inset-y-0 right-0 z-50 w-full max-w-96 p-2 transition duration-300 ease-in-out data-closed:translate-x-full"
          >
            <div className="flex h-full min-h-0 flex-col rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
              <div className="flex shrink-0 justify-end px-4 pt-3">
                <Headless.CloseButton as={NavbarItem} aria-label="Fermer la file d'action">
                  <CloseMenuIcon />
                </Headless.CloseButton>
              </div>
              <div className="min-h-0 flex-1">{aside}</div>
            </div>
          </Headless.DialogPanel>
        </Headless.Dialog>
      ) : null}

      {/* Sidebar desktop */}
      {/* `h-full min-h-0` : c'est cette borne qui fait défiler `SidebarBody`
          dans la colonne au lieu de pousser le shell hors du viewport. */}
      <div className="hidden h-full min-h-0 w-64 shrink-0 border-r border-zinc-950/5 lg:block dark:border-white/5">
        <NavigationSidebar pathname={pathname} />
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
          {/* Le déclencheur n'existe que s'il y a une file à ouvrir, et disparaît
              dès que la colonne est visible en permanence. */}
          {aside ? (
            <div className="xl:hidden">
              <NavbarItem onClick={() => setShowQueue(true)} aria-label="Ouvrir la file d'action">
                <OpenQueueIcon />
              </NavbarItem>
            </div>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
          {aside ? (
            <aside className="hidden w-80 shrink-0 border-l border-zinc-950/5 xl:block dark:border-white/5">
              {aside}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  )
}
