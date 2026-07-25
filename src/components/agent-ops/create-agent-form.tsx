'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { ManifestRecap } from '@/components/agent-ops/authoring-primitives'
import { Button } from '@/components/ui/button'
import { Description, ErrorMessage, Field, Fieldset, Label } from '@/components/ui/fieldset'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CREATABLE_MODEL_PROVIDERS, type CreatableModelProvider } from '@/lib/agent-mission-control/resource-ids'
import type { CreateCopilotInput, GeneratedManifest } from '@/lib/agent-mission-control/authoring-types'
import { AGENT_RUNTIME_LABELS, MODEL_PROVIDER_LABELS } from '@/lib/agent-mission-control/labels'
import { SUGGESTED_MODELS } from '@/lib/agent-mission-control/model-catalog'
import { slugify } from '@/lib/agent-mission-control/slug'
import type { CreatableAgentRuntime, Project } from '@/lib/agent-mission-control/types'

const PROVIDER_OPTIONS = CREATABLE_MODEL_PROVIDERS

const BENCH_VALUE = '__bench__'

// The runtime is NOT a user choice here, and the reason is a backend fact, not a
// claim about which engine is real (AIGENT-UI-TRUTH-026). Aigent executes several
// runtimes — the four TradeAgent roster agents run on `openai-assistants` through
// the direct model-router path, and AGENTS.md forbids `langgraph` for
// market-tool agents because that runtime short-circuits to the LangGraph Agent
// Server, which never mounts the manifest's tools.
//
// What is genuinely langgraph-only is THIS CREATION PATH:
//   - POST /api/agent-ops/copilots validates `runtime: z.literal('langgraph')`;
//   - it then provisions a dedicated LangGraph assistant (ensureCopilotAssistant)
//     and rolls the whole copilot back if that fails.
// Offering another value here would 400 every submission. Widening the choice
// means widening that route + `CreatableAgentRuntime` first — see types.ts.
const DEFAULT_RUNTIME: CreatableAgentRuntime = 'langgraph'
const DEFAULT_PROVIDER: CreatableModelProvider = 'openai'
const DEFAULT_MODEL = SUGGESTED_MODELS[DEFAULT_PROVIDER][0]

/** Same key as ArchitectChat's session draft — purged after a successful creation. */
const ARCHITECT_DRAFT_STORAGE_KEY = 'amc-architect-draft'

/** True when `model` matches another provider's known models but not `provider`'s. */
function modelBelongsToAnotherProvider(model: string, provider: CreatableModelProvider): boolean {
  const trimmed = model.trim()
  if (trimmed.length === 0) return false
  if (SUGGESTED_MODELS[provider].includes(trimmed)) return false
  return PROVIDER_OPTIONS.some((other) => other !== provider && SUGGESTED_MODELS[other].includes(trimmed))
}

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

/**
 * Create-agent form: identity fields (name/slug/description/runtime/model/
 * modelProvider/owner/tags/project) are LOCAL state — the manifest contract
 * (authoring-types.ts) has no identity fields. When `manifest` comes from the
 * architect, it is used as-is, shown as a read-only summary, and MERGED into
 * the form without remounting: only fields still empty or never touched by
 * the user are prefilled — manual input is never overwritten. Otherwise a
 * minimal default manifest is built from the description on submit. POSTs
 * CreateCopilotInput to /api/agent-ops/copilots, then routes to the new
 * copilot on success.
 */
export function CreateAgentForm({
  projects,
  manifest,
}: {
  projects: Project[]
  manifest?: GeneratedManifest
}) {
  const router = useRouter()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')
  const runtime: CreatableAgentRuntime = DEFAULT_RUNTIME
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [modelProvider, setModelProvider] = useState<CreatableModelProvider>(DEFAULT_PROVIDER)
  const [owner, setOwner] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [projectId, setProjectId] = useState<string>(BENCH_VALUE)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Fields the user edited by hand — a manifest merge never overwrites these. */
  const dirtyFields = useRef(new Set<string>())
  /** True once the user typed a model manually — disables the auto provider swap. */
  const [modelDirty, setModelDirty] = useState(false)

  // Merge an incoming architect manifest into the EXISTING state (no remount):
  // prefill only fields still empty or never touched by the user.
  const appliedManifestRef = useRef<GeneratedManifest | null>(null)
  useEffect(() => {
    if (!manifest || appliedManifestRef.current === manifest) return
    appliedManifestRef.current = manifest
    if (manifest.systemPromptSummary) {
      setDescription((prev) =>
        prev.trim().length === 0 || !dirtyFields.current.has('description')
          ? manifest.systemPromptSummary
          : prev
      )
    }
  }, [manifest])

  const effectiveManifest = useMemo(
    () => manifest ?? defaultManifest(description),
    [manifest, description]
  )

  // Warn before refresh/close/external navigation once the form is dirty
  // (at least one field differs from its default).
  const isDirty =
    name.length > 0 ||
    slug.length > 0 ||
    description.length > 0 ||
    owner.length > 0 ||
    tagsInput.length > 0 ||
    // `runtime` is not in this list: it is locked to DEFAULT_RUNTIME by the
    // creation route, so it can never diverge and never make the form dirty.
    model !== DEFAULT_MODEL ||
    modelProvider !== DEFAULT_PROVIDER ||
    projectId !== BENCH_VALUE
  useEffect(() => {
    if (!isDirty) return
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  function handleNameChange(value: string) {
    dirtyFields.current.add('name')
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  function handleSlugChange(value: string) {
    dirtyFields.current.add('slug')
    setSlugTouched(true)
    setSlug(value)
  }

  function handleModelChange(value: string) {
    dirtyFields.current.add('model')
    setModelDirty(true)
    setModel(value)
  }

  function handleProviderChange(next: CreatableModelProvider) {
    dirtyFields.current.add('modelProvider')
    setModelProvider(next)
    // If the current model clearly belongs to ANOTHER provider and was never
    // typed manually, swap it for the new provider's default. A manually
    // entered model is left alone (the soft hint below flags the mismatch).
    setModel((prev) => {
      const fallback = SUGGESTED_MODELS[next][0]
      if (!modelDirty && fallback && modelBelongsToAnotherProvider(prev, next)) {
        return fallback
      }
      return prev
    })
  }

  const modelLooksForeign = modelBelongsToAnotherProvider(model, modelProvider)

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
      manifest: effectiveManifest,
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

      const created = (await res.json()) as { copilotId?: string }
      if (!created.copilotId) {
        setError('Copilot created but no id was returned.')
        return
      }

      // Creation succeeded — the architect draft (if any) is no longer unsaved work.
      try {
        window.sessionStorage.removeItem(ARCHITECT_DRAFT_STORAGE_KEY)
      } catch {
        // Storage unavailable — nothing to purge.
      }

      router.push(`/admin/agents/${created.copilotId}`)
    } catch {
      setError('Network error — the copilot was not created.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {manifest ? <ManifestRecap manifest={manifest} showLimits /> : null}

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
              onChange={(event) => {
                dirtyFields.current.add('description')
                setDescription(event.target.value)
              }}
              rows={3}
              placeholder="What this copilot does and why it exists."
            />
          </Field>

          <Field>
            <Label>Runtime</Label>
            <Input name="runtime" value={AGENT_RUNTIME_LABELS[runtime]} disabled readOnly />
            <Description>
              Fixed for agents created here: this form provisions a dedicated LangGraph assistant.
              Other runtimes execute in Aigent but are not creatable from this surface.
            </Description>
          </Field>

          <Field>
            <Label>Model provider</Label>
            <Select
              name="modelProvider"
              value={modelProvider}
              onChange={(event) => handleProviderChange(event.target.value as CreatableModelProvider)}
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {MODEL_PROVIDER_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>

          <Field>
            <Label>Model</Label>
            <Input
              name="model"
              value={model}
              onChange={(event) => handleModelChange(event.target.value)}
              placeholder={DEFAULT_MODEL}
              list="create-agent-model-suggestions"
              required
            />
            <datalist id="create-agent-model-suggestions">
              {SUGGESTED_MODELS[modelProvider].map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
            {modelLooksForeign ? (
              <Description className="text-accent-600 dark:text-accent-400">
                {`Model doesn't look like a ${modelProvider} model.`}
              </Description>
            ) : null}
          </Field>

          <Field>
            <Label>Owner</Label>
            <Input
              name="owner"
              value={owner}
              onChange={(event) => {
                dirtyFields.current.add('owner')
                setOwner(event.target.value)
              }}
              placeholder="you@company.com"
              required
            />
          </Field>

          <Field>
            <Label>Tags</Label>
            <Input
              name="tags"
              value={tagsInput}
              onChange={(event) => {
                dirtyFields.current.add('tags')
                setTagsInput(event.target.value)
              }}
              placeholder="support, tier-1"
            />
          </Field>

          <Field>
            <Label>Project</Label>
            <Select
              name="projectId"
              value={projectId}
              onChange={(event) => {
                dirtyFields.current.add('projectId')
                setProjectId(event.target.value)
              }}
            >
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

      {error ? <ErrorMessage role="alert">{error}</ErrorMessage> : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button plain onClick={() => router.push('/admin')} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" color="accent" disabled={!canSubmit}>
          {saving ? 'Creating…' : 'Create copilot'}
        </Button>
      </div>
    </form>
  )
}
