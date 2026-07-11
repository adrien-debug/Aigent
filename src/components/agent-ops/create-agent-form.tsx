'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { Button } from '@/components/catalyst/button'
import { Field, Fieldset, Label } from '@/components/catalyst/fieldset'
import { Input } from '@/components/catalyst/input'
import { Select } from '@/components/catalyst/select'
import { Textarea } from '@/components/catalyst/textarea'
import type { CreateCopilotInput, GeneratedManifest } from '@/lib/agent-mission-control/authoring-types'
import { formatUsd } from '@/lib/agent-mission-control/format'
import { slugify } from '@/lib/agent-mission-control/slug'
import type { AgentRuntime, ModelProvider, Project } from '@/lib/agent-mission-control/types'

const RUNTIME_OPTIONS: AgentRuntime[] = ['langgraph', 'openai-assistants', 'anthropic-sdk', 'gemini', 'custom']
const PROVIDER_OPTIONS: ModelProvider[] = ['anthropic', 'openai', 'google', 'mistral', 'local']

const BENCH_VALUE = '__bench__'

function defaultManifest(description: string): GeneratedManifest {
  return {
    systemPromptSummary: description || 'No description provided.',
    allowedRoutes: [],
    forbiddenActions: [],
    confirmationPolicy: 'risky-only',
    alwaysConfirmActions: [],
    outputContract: { format: 'text', schemaName: null, invariants: [] },
    proposedTools: [],
    maxStepsPerRun: 12,
    maxCostPerRunUsd: 0.5,
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

/**
 * Create-agent form: identity fields (name/slug/description/runtime/model/
 * modelProvider/owner/tags/project) are LOCAL state — the manifest contract
 * (authoring-types.ts) has no identity fields. When `initialManifest` comes
 * from the architect, it is used as-is and shown as a read-only summary;
 * otherwise a minimal default manifest is built from the description on
 * submit. POSTs CreateCopilotInput to /api/agent-ops/copilots, then routes
 * to the new copilot on success.
 */
export function CreateAgentForm({
  projects,
  initialManifest,
}: {
  projects: Project[]
  initialManifest?: GeneratedManifest
}) {
  const router = useRouter()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [runtime, setRuntime] = useState<AgentRuntime>('anthropic-sdk')
  const [model, setModel] = useState('claude-sonnet-4-5')
  const [modelProvider, setModelProvider] = useState<ModelProvider>('anthropic')
  const [owner, setOwner] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [projectId, setProjectId] = useState<string>(BENCH_VALUE)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const manifest = useMemo(
    () => initialManifest ?? defaultManifest(description),
    [initialManifest, description]
  )

  function handleNameChange(value: string) {
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  function handleSlugChange(value: string) {
    setSlugTouched(true)
    setSlug(value)
  }

  const canSubmit = name.trim().length > 0 && slug.trim().length > 0 && owner.trim().length > 0 && !saving

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return

    setSaving(true)
    setError(null)

    const tags = tagsInput
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)

    const input: CreateCopilotInput = {
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim(),
      runtime,
      model: model.trim(),
      modelProvider,
      owner: owner.trim(),
      tags,
      projectId: projectId === BENCH_VALUE ? null : projectId,
      targetProjectIds: [],
      manifest,
    }

    try {
      const res = await fetch('/api/agent-ops/copilots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      if (res.status === 503) {
        setError('Live backend not configured.')
        return
      }
      if (!res.ok) {
        setError(`Could not create copilot (${res.status}).`)
        return
      }

      const created = (await res.json()) as { id?: string }
      if (!created.id) {
        setError('Copilot created but no id was returned.')
        return
      }

      router.push(`/admin/agents/${created.id}`)
    } catch {
      setError('Network error — the copilot was not created.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {initialManifest ? (
        <div className="rounded-lg bg-zinc-950/5 p-4 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:ring-white/10">
          <p className="text-sm font-medium text-zinc-950 dark:text-white">Manifest from the architect</p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {truncate(initialManifest.systemPromptSummary, 220)}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Routes</dt>
              <dd className="font-mono tabular-nums text-zinc-950 dark:text-white">
                {initialManifest.allowedRoutes.length}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Tools</dt>
              <dd className="font-mono tabular-nums text-zinc-950 dark:text-white">
                {initialManifest.proposedTools.length}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Confirmation</dt>
              <dd className="text-zinc-950 dark:text-white">{initialManifest.confirmationPolicy}</dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Max steps / run</dt>
              <dd className="font-mono tabular-nums text-zinc-950 dark:text-white">
                {initialManifest.maxStepsPerRun}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Max cost per run:{' '}
            <span className="font-mono tabular-nums text-zinc-950 dark:text-white">
              {formatUsd(initialManifest.maxCostPerRunUsd)}
            </span>
          </p>
        </div>
      ) : null}

      <Fieldset>
        <div className="grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2">
          <Field>
            <Label>Name</Label>
            <Input
              name="name"
              value={name}
              onChange={(event) => handleNameChange(event.target.value)}
              placeholder="Support triage copilot"
              required
            />
          </Field>

          <Field>
            <Label>Slug</Label>
            <Input
              name="slug"
              value={slug}
              onChange={(event) => handleSlugChange(event.target.value)}
              placeholder="support-triage-copilot"
              required
            />
          </Field>

          <Field className="sm:col-span-2">
            <Label>Description</Label>
            <Textarea
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="What this copilot does and why it exists."
            />
          </Field>

          <Field>
            <Label>Runtime</Label>
            <Select
              name="runtime"
              value={runtime}
              onChange={(event) => setRuntime(event.target.value as AgentRuntime)}
            >
              {RUNTIME_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>

          <Field>
            <Label>Model provider</Label>
            <Select
              name="modelProvider"
              value={modelProvider}
              onChange={(event) => setModelProvider(event.target.value as ModelProvider)}
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>

          <Field>
            <Label>Model</Label>
            <Input
              name="model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="claude-sonnet-4-5"
              required
            />
          </Field>

          <Field>
            <Label>Owner</Label>
            <Input
              name="owner"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder="you@company.com"
              required
            />
          </Field>

          <Field>
            <Label>Tags</Label>
            <Input
              name="tags"
              value={tagsInput}
              onChange={(event) => setTagsInput(event.target.value)}
              placeholder="support, tier-1"
            />
          </Field>

          <Field>
            <Label>Project</Label>
            <Select name="projectId" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value={BENCH_VALUE}>Validation bench (no project)</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Fieldset>

      {error ? <p className="text-sm text-accent-600 dark:text-accent-400">{error}</p> : null}

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" color="accent" disabled={!canSubmit}>
          {saving ? 'Creating…' : 'Create copilot'}
        </Button>
      </div>
    </form>
  )
}
