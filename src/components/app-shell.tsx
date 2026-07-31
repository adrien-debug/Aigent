'use client'

/**
 * Cadre du poste de contrôle : rail d'outils à gauche, barre d'état en haut,
 * plan de travail au centre, colonne de décision à droite.
 *
 * Le shell précédent posait chaque colonne en `fixed` et compensait par des
 * `pl-20` / `pr-96` sur le contenu — trois systèmes de coordonnées qui devaient
 * rester d'accord. Ici tout est en flux : une rangée, une colonne, et la barre
 * d'état couvre réellement toute la largeur au lieu de s'arrêter avant la
 * colonne de droite.
 *
 * `h-full overflow-hidden` : le cockpit tient dans le viewport et ne scrolle
 * JAMAIS au niveau de la page en desktop. Seules les listes scrollent, dans
 * leur box.
 */
import { useState } from 'react'
import type { ComponentType, ReactNode, SVGProps } from 'react'
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
import {
  Bars3Icon,
  BoltIcon,
  CpuChipIcon,
  FolderIcon,
  RocketLaunchIcon,
  SignalIcon,
  Squares2X2Icon,
  XMarkIcon,
} from '@heroicons/react/24/outline'

type NavItem = {
  name: string
  href: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  current: boolean
}

/**
 * Le cockpit est le seul écran construit à ce jour. Les autres entrées nomment
 * les domaines réels d'Aigent et restent VISIBLEMENT inactives : elles annoncent
 * la carte du produit, elles ne prétendent pas ouvrir une page.
 */
const navigation: NavItem[] = [
  { name: 'Cockpit', href: '/', icon: Squares2X2Icon, current: true },
  { name: 'Agents', href: '#', icon: CpuChipIcon, current: false },
  { name: 'Projets', href: '#', icon: FolderIcon, current: false },
  { name: 'Runs', href: '#', icon: BoltIcon, current: false },
  { name: 'Livraisons', href: '#', icon: RocketLaunchIcon, current: false },
  { name: 'Télémétrie', href: '#', icon: SignalIcon, current: false },
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

function NavLink({ item, withLabel = false }: { item: NavItem; withLabel?: boolean }) {
  const soon = !item.current && item.href === '#'
  return (
    <a
      href={item.href}
      title={soon ? `${item.name} — écran à venir` : item.name}
      aria-current={item.current ? 'page' : undefined}
      aria-disabled={soon || undefined}
      className={[
        'group relative flex items-center gap-3 rounded-lg transition-colors',
        withLabel ? 'px-3 py-2 text-[13px] font-medium' : 'justify-center p-2.5',
        item.current
          ? 'bg-accent/10 text-accent'
          : soon
            ? 'text-ink-faint/70 hover:bg-white/4 hover:text-ink-dim'
            : 'text-ink-faint hover:bg-white/4 hover:text-ink',
      ].join(' ')}
    >
      {item.current ? (
        <span
          aria-hidden
          className="absolute top-1/2 -left-3 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent"
        />
      ) : null}
      <item.icon aria-hidden="true" className="size-5 shrink-0" />
      {withLabel ? <span>{item.name}</span> : <span className="sr-only">{item.name}</span>}
    </a>
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
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-full overflow-hidden bg-base">
      {/* Rail mobile */}
      <Dialog open={sidebarOpen} onClose={setSidebarOpen} className="relative z-50 lg:hidden">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity duration-300 ease-linear data-closed:opacity-0"
        />
        <div className="fixed inset-0 flex">
          <DialogPanel
            transition
            className="relative flex w-full max-w-64 flex-1 flex-col border-r border-white/6 bg-raised transition duration-300 ease-in-out data-closed:-translate-x-full"
          >
            <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-white/6 px-4">
              <Mark className="size-[18px]" />
              <span className="text-[13px] font-semibold tracking-[0.26em] text-ink">AIGENT</span>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="ml-auto -mr-1 p-1 text-ink-faint hover:text-ink"
              >
                <span className="sr-only">Fermer</span>
                <XMarkIcon aria-hidden="true" className="size-5" />
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-1 p-3">
              {navigation.map((item) => (
                <NavLink key={item.name} item={item} withLabel />
              ))}
            </nav>
          </DialogPanel>
        </div>
      </Dialog>

      {/* Rail desktop */}
      <div className="hidden w-16 shrink-0 flex-col border-r border-white/6 bg-base lg:flex">
        <div className="flex h-12 shrink-0 items-center justify-center border-b border-white/6">
          <Mark className="size-[20px]" />
        </div>
        <nav className="flex flex-1 flex-col items-center gap-1 py-4">
          {navigation.map((item) => (
            <NavLink key={item.name} item={item} />
          ))}
        </nav>
        <div className="flex h-12 shrink-0 items-center justify-center border-t border-white/6">
          <span
            aria-hidden
            title="Interface en ligne"
            className="pulse-live size-1.5 rounded-full bg-accent"
          />
        </div>
      </div>

      {/* Colonne principale */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b border-white/6">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="ml-2 shrink-0 rounded-md p-2 text-ink-faint hover:bg-white/4 hover:text-ink lg:hidden"
          >
            <span className="sr-only">Ouvrir la navigation</span>
            <Bars3Icon aria-hidden="true" className="size-5" />
          </button>
          <div className="min-w-0 flex-1">{topbar}</div>
        </div>

        <div className="flex min-h-0 flex-1">
          <main className="cockpit-substrate min-w-0 flex-1 overflow-hidden">{children}</main>
          <aside className="hidden w-80 shrink-0 border-l border-white/6 bg-base xl:block">
            {aside}
          </aside>
        </div>
      </div>
    </div>
  )
}
