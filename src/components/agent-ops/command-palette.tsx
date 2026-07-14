'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import * as Headless from '@headlessui/react'
import { MagnifyingGlassIcon, ArrowRightIcon, Squares2X2Icon, PlusIcon } from '@heroicons/react/20/solid'
import { CpuChipIcon, FolderIcon, Cog6ToothIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

const ACTIONS = [
  { id: 'dashboard', name: 'Go to Dashboard', icon: Squares2X2Icon, href: '/admin', section: 'Navigation' },
  { id: 'copilots', name: 'Manage Copilots', icon: CpuChipIcon, href: '/admin/agents', section: 'Navigation' },
  { id: 'projects', name: 'Manage Projects', icon: FolderIcon, href: '/admin/projects', section: 'Navigation' },
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
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
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
            className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm transition-opacity"
          />
          <div className="fixed inset-0 z-10 w-screen overflow-y-auto p-4 sm:p-6 md:p-20">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <Headless.Combobox
                as="div"
                className="mx-auto max-w-xl overflow-hidden rounded-2xl bg-white/90 shadow-2xl ring-1 ring-zinc-950/10 backdrop-blur-xl dark:bg-zinc-900/90 dark:ring-white/10 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_40px_-10px_rgba(0,0,0,0.5)]"
                onChange={(action: typeof ACTIONS[0] | null) => {
                  if (!action) return
                  setIsOpen(false)
                  router.push(action.href)
                }}
              >
                <div className="relative flex items-center px-4 border-b border-zinc-950/5 dark:border-white/5">
                  <MagnifyingGlassIcon className="size-5 text-zinc-500" aria-hidden="true" />
                  <Headless.ComboboxInput
                    className="h-14 w-full border-0 bg-transparent pl-4 pr-4 text-sm text-zinc-900 placeholder:text-zinc-500 focus:ring-0 focus:outline-hidden dark:text-white"
                    placeholder="Search commands, copilots, or projects..."
                    onChange={(event) => setQuery(event.target.value)}
                    autoFocus
                  />
                  <kbd className="hidden sm:inline-block font-sans text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">ESC</kbd>
                </div>

                {filtered.length > 0 && (
                  <Headless.ComboboxOptions static className="max-h-80 scroll-py-2 overflow-y-auto p-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {filtered.map((action) => (
                      <Headless.ComboboxOption
                        key={action.id}
                        value={action}
                        className="group flex cursor-default select-none items-center rounded-xl px-3 py-2 data-[focus]:bg-(--accent-surface) data-[focus]:text-accent-700 dark:data-[focus]:text-accent-300"
                      >
                        <action.icon className="size-5 flex-none text-zinc-400 group-data-[focus]:text-accent-600 dark:group-data-[focus]:text-accent-400" aria-hidden="true" />
                        <span className="ml-3 flex-auto truncate font-medium">{action.name}</span>
                        <span className="hidden group-data-[focus]:inline-flex text-xs text-accent-600/70 dark:text-accent-400/70">Jump to</span>
                      </Headless.ComboboxOption>
                    ))}
                  </Headless.ComboboxOptions>
                )}

                {query !== '' && filtered.length === 0 && (
                  <div className="px-6 py-14 text-center text-sm sm:px-14">
                    <p className="mt-4 font-semibold text-zinc-900 dark:text-white">No results found</p>
                    <p className="mt-2 text-zinc-500">We couldn&apos;t find anything matching your search.</p>
                  </div>
                )}
              </Headless.Combobox>
            </motion.div>
          </div>
        </Headless.Dialog>
      )}
    </AnimatePresence>
  )
}
