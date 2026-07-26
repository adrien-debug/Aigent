'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import { MagnifyingGlassIcon, Squares2X2Icon, PlusIcon } from '@heroicons/react/20/solid'
import { ChartBarIcon, Cog6ToothIcon } from '@heroicons/react/24/outline'
import { surfaceOverlay } from '@/components/ui/panel'

const ACTIONS = [
  { id: 'dashboard', name: 'Go to Dashboard', icon: Squares2X2Icon, href: '/admin', section: 'Navigation' },
  { id: 'performance', name: 'View Performance', icon: ChartBarIcon, href: '/admin/performance', section: 'Navigation' },
  { id: 'settings', name: 'Global Settings', icon: Cog6ToothIcon, href: '/admin/settings', section: 'Navigation' },
  { id: 'new-copilot', name: 'Provision New Copilot', icon: PlusIcon, href: '/admin/agents/new', section: 'Actions' },
  { id: 'new-project', name: 'Register New Project', icon: PlusIcon, href: '/admin/projects/new', section: 'Actions' },
]

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const router = useRouter()

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setIsOpen((open) => !open)
      }
    }
    const open = () => setIsOpen(true)
    document.addEventListener('keydown', down)
    window.addEventListener('aigent:command-palette', open)
    return () => {
      document.removeEventListener('keydown', down)
      window.removeEventListener('aigent:command-palette', open)
    }
  }, [])

  const filtered = query === '' 
    ? ACTIONS 
    : ACTIONS.filter((action) => action.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <AnimatePresence>
      {isOpen && (
        <Headless.Dialog static as={motion.div} open={isOpen} onClose={setIsOpen} className="relative z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-zinc-950/50 backdrop-blur-sm transition-opacity"
          />
          <div className="fixed inset-0 z-10 w-screen overflow-y-auto p-4 sm:p-6 md:p-20">
            {/* DialogPanel is what makes "click outside" mean anything: Headless
                closes on a click landing OUTSIDE this node. Without it the dialog
                falls back to its own root, which wraps both `fixed inset-0` layers
                — the whole viewport — so no click was ever outside and only Escape
                could close the palette.
                It has to hug the palette itself, hence `mx-auto max-w-xl` moved
                here off the Combobox: left there, the panel would still span the
                full scrollport and a click beside the box would keep being eaten. */}
            <Headless.DialogPanel className="mx-auto max-w-xl">
              <Headless.DialogTitle className="sr-only">Command palette</Headless.DialogTitle>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -20 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
              <Headless.Combobox
                as="div"
                // Plane 4 (overlay): sits above every panel, so it takes the
                // overlay fill and the strong shadow — not the panel fill, which
                // made it read as just another card floating over the page.
                className={clsx('overflow-hidden backdrop-blur-xl', surfaceOverlay)}
                onChange={(action: typeof ACTIONS[0] | null) => {
                  if (!action) return
                  setIsOpen(false)
                  router.push(action.href)
                }}
              >
                <div className="relative flex items-center px-4 border-b border-zinc-950/5 dark:border-white/5 focus-within:outline focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-accent-500">
                  {/* zinc-400, not zinc-500: measured on the overlay plane
                      (#232327, the only plane this dialog ever sits on) zinc-500
                      is 3.24:1 and zinc-400 is 5.97:1. The glyph alone would
                      have squeaked past SC 1.4.11 at 3.0, but it shares a row
                      with the placeholder — which does NOT — and two different
                      greys inside one control read as a rendering accident. */}
                  {/* Stated as a PAIR. The dark half is the measured one and is
                      unchanged; the light half only existed by omission before,
                      and zinc-400 on white is 2.6:1 — under the 3.0 floor a
                      meaningful glyph owes. See the light-mode block in
                      src/theme.css: light is dormant, but a colour written here
                      with one half is a colour nobody can ever repair by
                      repainting a token. */}
                  <MagnifyingGlassIcon className="size-5 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
                  <Headless.ComboboxInput
                    // Copy matches what the palette actually searches: the fixed
                    // command list below. It does NOT (yet) index copilots or
                    // projects, so promising that told the operator to type an
                    // agent name and get "No results" — an unkept promise.
                    aria-label="Search commands"
                    // Placeholder at zinc-400: 14px body text on the overlay
                    // plane, so it owes the 4.5 threshold, and zinc-500 pays
                    // 3.24. `scripts/check-contrast.mjs` can never catch this
                    // one — it probes the six reference routes with the dialog
                    // CLOSED — so the number here comes from a hand-driven
                    // Chromium probe of this exact node, not from the gate.
                    className="h-14 w-full border-0 bg-transparent pl-4 pr-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus:ring-0 focus:outline-hidden dark:text-white"
                    placeholder="Search commands…"
                    onChange={(event) => setQuery(event.target.value)}
                    autoFocus
                  />
                  <kbd className="hidden sm:inline-block font-sans text-xs text-zinc-600 bg-zinc-100 dark:text-zinc-300 dark:bg-zinc-800 px-2 py-1 rounded">ESC</kbd>
                </div>

                {filtered.length > 0 && (
                  <Headless.ComboboxOptions static className="max-h-80 scroll-py-2 overflow-y-auto p-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {filtered.map((action) => (
                      <Headless.ComboboxOption
                        key={action.id}
                        value={action}
                        className="group flex min-h-11 cursor-default select-none items-center rounded-xl px-3 py-2 data-[focus]:bg-(--accent-surface) data-[focus]:text-accent-700 dark:data-[focus]:text-accent-300"
                      >
                        <action.icon className="size-5 flex-none text-zinc-400 group-data-[focus]:text-accent-600 dark:group-data-[focus]:text-accent-400" aria-hidden="true" />
                        <span className="ml-3 flex-auto truncate font-medium">{action.name}</span>
                        {/* Same pairing as the option label two lines up
                            (`accent-700` / `accent-300`): accent-400 is a pale
                            mint that measures 1.2:1 on white. Dark half kept
                            exactly as measured. */}
                        <span className="hidden group-data-[focus]:inline-flex text-xs text-accent-700 dark:text-accent-400">Jump to</span>
                      </Headless.ComboboxOption>
                    ))}
                  </Headless.ComboboxOptions>
                )}

                {query !== '' && filtered.length === 0 && (
                  // `py-14` is the whole vertical rhythm of this block. The
                  // title used to carry `mt-4` on top of it — a leftover from
                  // the icon that once sat above it — so the measured gaps were
                  // 72px above and 56px below: the copy sat visibly low in its
                  // own box. Margin removed, not compensated on the other side;
                  // the padding is symmetric again (56/56, re-measured).
                  <div className="px-6 py-14 text-center text-sm sm:px-14">
                    <p className="font-semibold text-zinc-900 dark:text-white">No results found</p>
                    {/* zinc-400: same overlay plane, same 3.24 → 5.97 story as
                        the placeholder above. Light half added for the same
                        reason as the search glyph — dark value untouched. */}
                    <p className="mt-2 text-zinc-500 dark:text-zinc-400">We couldn&apos;t find anything matching your search.</p>
                  </div>
                )}
              </Headless.Combobox>
              </motion.div>
            </Headless.DialogPanel>
          </div>
        </Headless.Dialog>
      )}
    </AnimatePresence>
  )
}
