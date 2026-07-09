'use client'

import { useState } from 'react'

import { Description, Field, Label } from '@/components/catalyst/fieldset'
import { Select } from '@/components/catalyst/select'
import type { VersionStage } from '@/lib/agent-mission-control/types'

export interface ManifestVersionOption {
  id: string
  label: string
  stage: VersionStage
  /** V1 serves a single compiled manifest: versions without one are listed but not selectable. */
  disabled?: boolean
}

/**
 * Version picker for the manifest page. V1 serves a single compiled manifest,
 * so only the version whose manifest is actually displayed is selectable —
 * the others are listed disabled, suffixed "unavailable in V1".
 */
export function ManifestVersionSelect({
  versions,
  initialVersionId,
}: {
  versions: ManifestVersionOption[]
  initialVersionId: string
}) {
  const [selectedId, setSelectedId] = useState(initialVersionId)

  if (versions.length === 0) return null

  const selected = versions.find((version) => version.id === selectedId) ?? versions[0]

  return (
    <Field>
      <Label>Manifest version</Label>
      <Select
        name="manifest-version"
        value={selected?.id ?? initialVersionId}
        onChange={(event) => setSelectedId(event.target.value)}
      >
        {versions.map((version) => (
          <option key={version.id} value={version.id} disabled={version.disabled}>
            {version.label} ({version.stage}){version.disabled ? ' — unavailable in V1' : ''}
          </option>
        ))}
      </Select>
      <Description>
        {selected ? (
          <>
            Viewing{' '}
            <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-300">{selected.label}</span> ({selected.stage})
          </>
        ) : (
          'No version selected'
        )}
      </Description>
    </Field>
  )
}
