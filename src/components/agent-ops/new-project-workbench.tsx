'use client'

import {
  ArrowPathIcon,
  DocumentIcon,
  ExclamationTriangleIcon,
  FolderIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import * as Headless from '@headlessui/react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Field, Fieldset, Label } from '@/components/catalyst/fieldset'
import { Input, InputGroup } from '@/components/catalyst/input'
import { Select } from '@/components/catalyst/select'
import { Textarea } from '@/components/catalyst/textarea'
import type { Project } from '@/lib/agent-mission-control/types'

// ---------------------------------------------------------------------------
// Wire shapes — mirror the server github.ts summaries (kept local so this
// client module never imports the server-only github.ts / data.ts).
// ---------------------------------------------------------------------------

interface RepoSummary {
  fullName: string
  name: string
  owner: string
  private: boolean
  defaultBranch: string
  description: string | null
  htmlUrl: string
  updatedAt: string
}

interface TreeEntry {
  path: string
  type: 'blob' | 'tree'
  size?: number
}

const PLATFORM_OPTIONS: Project['platform'][] = ['web', 'desktop', 'mobile', 'api']

/** Cap the number of tree rows we render — honest truncation with a counter. */
const TREE_DISPLAY_CAP = 400

/** Show the search box only once the list is long enough to warrant it. */
const SEARCH_THRESHOLD = 8

function formatUpdated(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// New-project workbench — pick a repo, preview its tree, register the project.
// ---------------------------------------------------------------------------

export function NewProjectWorkbench() {
  const router = useRouter()

  // Step 1 — repositories.
  const [repos, setRepos] = useState<RepoSummary[] | null>(null)
  const [reposLoading, setReposLoading] = useState(true)
  const [reposError, setReposError] = useState<{ message: string; notConfigured: boolean } | null>(null)
  const [query, setQuery] = useState('')

  // Step 2 — selection + tree.
  const [selected, setSelected] = useState<RepoSummary | null>(null)
  const [tree, setTree] = useState<TreeEntry[] | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState<string | null>(null)

  // Step 3 — form.
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<Project['platform']>('web')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // --- Load repositories. No setState runs synchronously before the first
  // await, so calling this on mount satisfies react-hooks/set-state-in-effect.
  // Callers that need to clear a prior error do so before invoking. ---
  async function fetchRepos() {
    try {
      const res = await fetch('/api/agent-ops/github/repos', { cache: 'no-store' })
      if (res.status === 503) {
        setReposError({ message: 'GitHub not configured.', notConfigured: true })
        return
      }
      if (!res.ok) {
        setReposError({ message: `Could not load repositories (${res.status}).`, notConfigured: false })
        return
      }
      const data = (await res.json()) as { repos?: RepoSummary[] } | RepoSummary[]
      const list = Array.isArray(data) ? data : (data.repos ?? [])
      setRepos(list)
    } catch {
      setReposError({ message: 'Network error — could not reach GitHub.', notConfigured: false })
    } finally {
      setReposLoading(false)
    }
  }

  /** Retry entry point (button): clear the error, re-enter loading, refetch. */
  async function retryRepos() {
    if (reposLoading) return
    setReposError(null)
    setReposLoading(true)
    await fetchRepos()
  }

  useEffect(() => {
    // One-shot data fetch on mount: load the repo list into state. This is the
    // exact "synchronize with an external system (the GitHub API)" case the
    // effect exists for; the setState happens only after the awaited fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchRepos()
  }, [])

  // --- Load the tree when a repo is selected. ---
  async function selectRepo(repo: RepoSummary) {
    if (treeLoading) return
    setSelected(repo)
    setName(repo.name)
    setDescription(repo.description ?? '')
    setFormError(null)

    setTree(null)
    setTreeError(null)
    setTreeLoading(true)
    try {
      const res = await fetch(`/api/agent-ops/github/tree?repo=${encodeURIComponent(repo.fullName)}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        setTreeError(`Could not load the file tree (${res.status}).`)
        return
      }
      const data = (await res.json()) as { entries?: TreeEntry[] } | TreeEntry[]
      const entries = Array.isArray(data) ? data : (data.entries ?? [])
      setTree(entries)
    } catch {
      setTreeError('Network error — could not load the file tree.')
    } finally {
      setTreeLoading(false)
    }
  }

  // --- Submit. ---
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || saving || name.trim().length === 0) return

    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch('/api/agent-ops/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          platform,
          description: description.trim(),
          repoUrl: selected.htmlUrl,
          repoFullName: selected.fullName,
        }),
      })
      if (res.status === 503) {
        setFormError('Live backend not configured.')
        return
      }
      if (!res.ok) {
        setFormError(`Could not create the project (${res.status}).`)
        return
      }
      const created = (await res.json()) as { projectId?: string }
      if (!created.projectId) {
        setFormError('Project created but no id was returned.')
        return
      }
      router.push(`/admin/projects/${created.projectId}`)
    } catch {
      setFormError('Network error — the project was not created.')
    } finally {
      setSaving(false)
    }
  }

  const filteredRepos = useMemo(() => {
    if (!repos) return []
    const q = query.trim().toLowerCase()
    if (!q) return repos
    return repos.filter((repo) => repo.fullName.toLowerCase().includes(q))
  }, [repos, query])

  const visibleTree = tree ? tree.slice(0, TREE_DISPLAY_CAP) : []
  const treeOverflow = tree ? Math.max(0, tree.length - TREE_DISPLAY_CAP) : 0

  const canSubmit = selected !== null && name.trim().length > 0 && !saving

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      {/* Step 1 — repository picker */}
      <AgentSectionCard
        title="Repository"
        description="Select the GitHub repo this project is built from."
      >
        {reposLoading ? (
          <div className="flex items-center gap-3 py-8 text-sm text-zinc-500 dark:text-zinc-400">
            <ArrowPathIcon aria-hidden="true" className="size-4 animate-spin" />
            Loading repositories…
          </div>
        ) : reposError ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <ExclamationTriangleIcon aria-hidden="true" className="size-6 text-accent-500" />
            <p className="text-sm font-medium text-zinc-950 dark:text-white">
              {reposError.notConfigured ? 'GitHub not configured' : 'Could not load repositories'}
            </p>
            <p role="alert" className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              {reposError.message}
            </p>
            {reposError.notConfigured ? null : (
              <Button
                color="accent"
                onClick={() => void retryRepos()}
                disabled={reposLoading}
                className="mt-1"
              >
                <ArrowPathIcon data-slot="icon" className={reposLoading ? 'animate-spin' : undefined} />
                {reposLoading ? 'Retrying…' : 'Retry'}
              </Button>
            )}
          </div>
        ) : repos && repos.length === 0 ? (
          <EmptyState
            icon={FolderIcon}
            title="No repositories"
            description="The connected GitHub account has no accessible repositories."
          />
        ) : (
          <div className="space-y-4">
            {repos && repos.length > SEARCH_THRESHOLD ? (
              <Field>
                <Label className="sr-only">Filter repositories</Label>
                <InputGroup>
                  <MagnifyingGlassIcon />
                  <Input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter by name…"
                    aria-label="Filter repositories by name"
                  />
                </InputGroup>
              </Field>
            ) : null}

            <ul className="no-scrollbar max-h-[28rem] space-y-2 overflow-y-auto">
              {filteredRepos.map((repo) => {
                const isSelected = selected?.fullName === repo.fullName
                return (
                  <li key={repo.fullName}>
                    <Headless.Button
                      onClick={() => void selectRepo(repo)}
                      disabled={treeLoading}
                      aria-pressed={isSelected}
                      className={
                        'w-full rounded-lg px-4 py-3 text-left transition-colors ' +
                        'focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent-500 ' +
                        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 ' +
                        (isSelected
                          ? 'bg-[var(--accent-surface)] ring-1 ring-[var(--accent-line-strong)]'
                          : 'ring-1 ring-transparent hover:bg-zinc-950/2.5 dark:hover:bg-white/2.5')
                      }
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 truncate font-mono text-sm text-zinc-950 dark:text-white">
                          {repo.fullName}
                        </span>
                        {repo.private ? <Badge color="zinc">private</Badge> : null}
                      </div>
                      {repo.description ? (
                        <p className="mt-1 line-clamp-1 text-sm text-zinc-500 dark:text-zinc-400">
                          {repo.description}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-zinc-500 tabular-nums dark:text-zinc-500">
                        Updated {formatUpdated(repo.updatedAt)}
                      </p>
                    </Headless.Button>
                  </li>
                )
              })}
              {filteredRepos.length === 0 ? (
                <li role="status" className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No repository matches “{query}”.
                </li>
              ) : null}
            </ul>
          </div>
        )}
      </AgentSectionCard>

      {/* Step 2 + 3 — tree preview and form */}
      <div className="space-y-8">
        <AgentSectionCard
          title="File tree"
          description={selected ? selected.fullName : 'Select a repository to preview its files.'}
        >
          {!selected ? (
            <EmptyState icon={FolderIcon} title="No repository selected yet." />
          ) : treeLoading ? (
            <div className="flex items-center gap-3 py-8 text-sm text-zinc-500 dark:text-zinc-400">
              <ArrowPathIcon aria-hidden="true" className="size-4 animate-spin" />
              Loading file tree…
            </div>
          ) : treeError ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <ExclamationTriangleIcon aria-hidden="true" className="size-6 text-accent-500" />
              <p role="alert" className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                {treeError}
              </p>
              <Button
                color="accent"
                onClick={() => void selectRepo(selected)}
                disabled={treeLoading}
                className="mt-1"
              >
                <ArrowPathIcon data-slot="icon" className={treeLoading ? 'animate-spin' : undefined} />
                {treeLoading ? 'Retrying…' : 'Retry'}
              </Button>
            </div>
          ) : tree && tree.length === 0 ? (
            <EmptyState icon={FolderIcon} title="This repository is empty." />
          ) : (
            <div className="space-y-3">
              <ul className="no-scrollbar max-h-[28rem] overflow-x-auto overflow-y-auto font-mono text-sm">
                {visibleTree.map((entry) => {
                  const depth = entry.path.split('/').length - 1
                  const label = entry.path.split('/').pop() ?? entry.path
                  const isDir = entry.type === 'tree'
                  return (
                    <li
                      key={`${entry.type}:${entry.path}`}
                      className="flex items-center gap-2 py-0.5"
                      // Dynamic tree indentation — depth comes from a real GitHub repo tree and is
                      // unbounded (no fixed max nesting), so a static Tailwind class per level isn't
                      // possible: it would need one class per depth with no upper bound. The inline
                      // style is the legitimate escape hatch here; the step itself (16px = spacing-4)
                      // still comes from the repo's 4px spacing scale, not a magic number.
                      style={{ paddingLeft: `${depth * 16}px` }}
                    >
                      {isDir ? (
                        <FolderIcon
                          aria-hidden="true"
                          className="size-4 shrink-0 text-zinc-500 dark:text-zinc-500"
                        />
                      ) : (
                        <DocumentIcon
                          aria-hidden="true"
                          className="size-4 shrink-0 text-zinc-400 dark:text-zinc-600"
                        />
                      )}
                      <span
                        className={
                          'truncate ' +
                          (isDir ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-500 dark:text-zinc-400')
                        }
                      >
                        {label}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {treeOverflow > 0 ? (
                <p role="status" className="text-xs text-zinc-500 tabular-nums dark:text-zinc-500">
                  +{treeOverflow.toLocaleString('en-US')} more (showing first{' '}
                  {TREE_DISPLAY_CAP.toLocaleString('en-US')})
                </p>
              ) : (
                <p role="status" className="text-xs text-zinc-500 tabular-nums dark:text-zinc-500">
                  {(tree?.length ?? 0).toLocaleString('en-US')} entries
                </p>
              )}
            </div>
          )}
        </AgentSectionCard>

        <AgentSectionCard title="Project" description="Register the project against the selected repo.">
          <form onSubmit={handleSubmit}>
            <Fieldset>
              <div className="space-y-6">
                <Field>
                  <Label>Name</Label>
                  <Input
                    name="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Console"
                    disabled={!selected}
                    required
                  />
                </Field>

                <Field>
                  <Label>Platform</Label>
                  <Select
                    name="platform"
                    value={platform}
                    onChange={(event) => setPlatform(event.target.value as Project['platform'])}
                    disabled={!selected}
                  >
                    {PLATFORM_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field>
                  <Label>Description</Label>
                  <Textarea
                    name="description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={3}
                    placeholder="What this project is."
                    disabled={!selected}
                  />
                </Field>
              </div>
            </Fieldset>

            {formError ? (
              <p role="alert" className="mt-6 text-sm text-accent-600 dark:text-accent-400">
                {formError}
              </p>
            ) : null}

            <div className="mt-8 flex items-center justify-end gap-3">
              <Button plain href="/admin">
                Cancel
              </Button>
              <Button type="submit" color="accent" disabled={!canSubmit}>
                {saving ? 'Creating…' : 'Create project'}
              </Button>
            </div>
          </form>
        </AgentSectionCard>
      </div>
    </div>
  )
}
