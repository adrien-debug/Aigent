import {
  BoltIcon,
  ChartBarSquareIcon,
  CircleStackIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  CpuChipIcon,
  HomeIcon,
  PlayCircleIcon,
} from '@heroicons/react/24/outline'

import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'

const navigation = [
  { href: '/admin', label: 'Overview', icon: HomeIcon },
  { href: '/admin/runs', label: 'Runs', icon: PlayCircleIcon },
  { href: null, label: 'Projects', icon: CircleStackIcon },
  { href: null, label: 'Agents', icon: CpuChipIcon },
  { href: null, label: 'Factory', icon: BoltIcon },
  { href: null, label: 'Performance', icon: ChartBarSquareIcon },
] as const

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-app text-white">
      <div className="mx-auto grid min-h-screen max-w-[1800px] lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="hidden border-r border-white/8 bg-surface-raised px-4 py-5 lg:flex lg:flex-col">
          <div className="flex items-center gap-3 px-2">
            <div className="grid size-9 place-items-center rounded-lg bg-accent-500 text-zinc-950">
              <CommandLineIcon className="size-5" />
            </div>
            <div>
              <Heading level={2} className="text-lg/6">Nexus</Heading>
              <p className="text-[11px]/4 text-zinc-400">Agent Mission Control</p>
            </div>
          </div>
          <nav aria-label="Primary" className="mt-8 space-y-1">
            {navigation.map(({ href, label, icon: Icon }) => (
              href ? (
                <Button key={label} href={href} plain className="w-full justify-start">
                  <Icon data-slot="icon" />
                  {label}
                </Button>
              ) : (
                <Button key={label} plain disabled className="w-full justify-start">
                  <Icon data-slot="icon" />
                  {label}
                </Button>
              )
            ))}
          </nav>
          <div className="mt-auto border-t border-white/8 pt-4">
            <Button plain disabled className="w-full justify-start">
              <Cog6ToothIcon data-slot="icon" />
              Settings
            </Button>
          </div>
        </aside>
        <div className="min-w-0">
          <header className="flex h-16 items-center justify-between border-b border-white/8 px-4 sm:px-6 lg:px-8">
            <div className="lg:hidden">
              <Heading level={2} className="text-lg/6">Nexus</Heading>
            </div>
            <p className="hidden text-xs text-zinc-400 lg:block">Live operations console</p>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-accent-500" aria-hidden="true" />
              <span className="text-xs text-zinc-300">Connected</span>
            </div>
          </header>
          <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </div>
  )
}
