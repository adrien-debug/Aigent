'use client'

import { Dialog, DialogPanel } from '@headlessui/react'
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

/**
 * Hearst "H" monogram — same mark used in the admin rail
 * (src/components/agent-ops/agent-control-shell.tsx), so the brand is
 * identical across marketing and app. Draws in `currentColor`.
 */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="570.6 464.9 133.3 146.8" fill="currentColor" aria-hidden="true" className={className}>
      <polygon points="601.7 466.9 572.6 466.9 572.6 609.7 601.7 609.7 601.7 549.1 633.1 579.4 665.8 579.4 601.7 517.5 601.7 466.9" />
      <polygon points="672.7 466.9 672.7 528.1 644.6 500.9 612 500.9 672.7 559.7 672.7 609.7 701.9 609.7 701.9 466.9 672.7 466.9" />
    </svg>
  )
}

const NAVIGATION = [
  { name: 'Product', href: '/#product' },
  { name: 'Pricing', href: '/pricing' },
  { name: 'About', href: '/about' },
  { name: 'Contact', href: '/contact' },
] as const

export function SiteHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const pathname = usePathname()

  return (
    <header className="bg-zinc-950">
      <nav aria-label="Global" className="mx-auto flex max-w-7xl items-center justify-between p-6 lg:px-8">
        <div className="flex items-center gap-x-12">
          <Link href="/" className="-m-1.5 flex items-center gap-2 p-1.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-surface)] ring-1 ring-[var(--accent-line)]">
              <LogoMark className="size-4 text-accent-400" />
            </span>
            <span className="text-sm font-semibold text-white">Agent Mission Control</span>
          </Link>
          <div className="hidden lg:flex lg:gap-x-12">
            {NAVIGATION.map((item) => {
              const basePath = item.href.split('#')[0]
              const current = item.href !== '/#product' && basePath !== '/' && pathname.startsWith(basePath)
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  aria-current={current ? 'page' : undefined}
                  className={clsx(
                    'text-sm/6 font-semibold transition-colors',
                    current ? 'text-accent-400' : 'text-zinc-300 hover:text-white'
                  )}
                >
                  {item.name}
                </Link>
              )
            })}
          </div>
        </div>
        <div className="flex lg:hidden">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-zinc-300 hover:text-white"
          >
            <span className="sr-only">Open main menu</span>
            <Bars3Icon aria-hidden="true" className="size-6" />
          </button>
        </div>
        <div className="hidden lg:flex">
          <Link
            href="/login"
            className="rounded-md bg-accent-500 px-3.5 py-2 text-sm/6 font-semibold text-zinc-950 shadow-xs hover:bg-accent-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            Sign in <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </nav>
      <Dialog open={mobileMenuOpen} onClose={setMobileMenuOpen} className="lg:hidden">
        <div className="fixed inset-0 z-50" />
        <DialogPanel className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-zinc-950 p-6 sm:max-w-sm sm:ring-1 sm:ring-white/10">
          <div className="flex items-center justify-between">
            <Link href="/" className="-m-1.5 flex items-center gap-2 p-1.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-surface)] ring-1 ring-[var(--accent-line)]">
                <LogoMark className="size-4 text-accent-400" />
              </span>
              <span className="text-sm font-semibold text-white">Agent Mission Control</span>
            </Link>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="-m-2.5 rounded-md p-2.5 text-zinc-300 hover:text-white"
            >
              <span className="sr-only">Close menu</span>
              <XMarkIcon aria-hidden="true" className="size-6" />
            </button>
          </div>
          <div className="mt-6 flow-root">
            <div className="-my-6 divide-y divide-white/10">
              <div className="space-y-2 py-6">
                {NAVIGATION.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="-mx-3 block rounded-lg px-3 py-2 text-base/7 font-semibold text-white hover:bg-white/5"
                  >
                    {item.name}
                  </Link>
                ))}
              </div>
              <div className="py-6">
                <Link
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="-mx-3 block rounded-lg px-3 py-2.5 text-base/7 font-semibold text-white hover:bg-white/5"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </DialogPanel>
      </Dialog>
    </header>
  )
}
