import type { AgentSkill, ConfirmationPolicy } from './types'

export interface AgentSkillsExportInput {
  agentName: string
  agentSlug: string
  agentDescription: string
  manifestVersion: string
  confirmationPolicy: ConfirmationPolicy
  forbiddenActions: string[]
  skills: AgentSkill[]
}

export interface SkillTreeSkillPayload {
  name: string
  description: string
  content: string
  isPublic: false
}

export interface SkillTreeTrackPayload {
  name: string
  description: string
  skills: SkillTreeSkillPayload[]
}

function skillSlug(label: string): string {
  const normalized = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)

  return normalized || 'agent-capability'
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function uniqueSlug(label: string, used: Set<string>): string {
  const base = skillSlug(label)
  let candidate = base
  let suffix = 2

  while (used.has(candidate)) {
    const marker = `-${suffix}`
    candidate = `${base.slice(0, 64 - marker.length)}${marker}`
    suffix += 1
  }

  used.add(candidate)
  return candidate
}

function renderSkillMarkdown(
  input: AgentSkillsExportInput,
  skill: AgentSkill,
  slug: string
): string {
  const description = skill.detail?.trim() || `Capability provided by ${input.agentName}.`
  const forbidden =
    input.forbiddenActions.length > 0
      ? input.forbiddenActions.map((action) => `- ${action}`).join('\n')
      : '- No additional forbidden action declared.'

  return `---
name: ${slug}
description: ${yamlString(description)}
compatibility: ${yamlString(`Requires the Aigent agent "${input.agentSlug}" and its governed runtime.`)}
metadata:
  agent: ${yamlString(input.agentName)}
  agent-slug: ${yamlString(input.agentSlug)}
  manifest-version: ${yamlString(input.manifestVersion)}
---

# ${skill.label}

## Capability

${description}

## Runtime policy

- Confirmation policy: \`${input.confirmationPolicy}\`
- This skill describes one capability of the governed agent; it does not replace the agent runtime or its tool guards.

## Forbidden actions

${forbidden}
`
}

/**
 * Convert one governed Aigent manifest into a SkillTree track containing
 * Agent Skills-compatible SKILL.md documents. Pure and deterministic.
 *
 * Publication is private by construction. Making a Skill public remains a
 * separate, explicit SkillTree operation.
 */
export function buildSkillTreeTrack(input: AgentSkillsExportInput): SkillTreeTrackPayload {
  const usedSlugs = new Set<string>()

  return {
    name: input.agentName,
    description: input.agentDescription,
    skills: input.skills.map((skill) => {
      const slug = uniqueSlug(skill.label, usedSlugs)
      const description = skill.detail?.trim() || `Capability provided by ${input.agentName}.`

      return {
        name: skill.label,
        description,
        content: renderSkillMarkdown(input, skill, slug),
        isPublic: false,
      }
    }),
  }
}
