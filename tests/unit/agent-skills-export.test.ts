import { describe, expect, it } from 'vitest'

import { buildSkillTreeTrack } from '@/lib/agent-mission-control/agent-skills-export'

const input = {
  agentName: 'Market Intelligence',
  agentSlug: 'market-intelligence',
  agentDescription: 'Reads market structure without mutating trading state.',
  manifestVersion: '1.2.0',
  confirmationPolicy: 'risky-only' as const,
  forbiddenActions: ['Place an order', 'Invent unavailable prices'],
  skills: [
    {
      label: 'Read ETH multi-timeframe market structure',
      detail: 'Trend, key levels and swings from measured candles.',
    },
    {
      label: 'Classify the volatility regime',
      detail: 'Low, normal, elevated or high from observed volatility.',
    },
  ],
}

describe('Agent Skills export', () => {
  it('maps one agent to one SkillTree track with private skills', () => {
    const track = buildSkillTreeTrack(input)

    expect(track.name).toBe(input.agentName)
    expect(track.description).toBe(input.agentDescription)
    expect(track.skills).toHaveLength(2)
    expect(track.skills.every((skill) => skill.isPublic === false)).toBe(true)
  })

  it('renders Agent Skills-compatible frontmatter and governed runtime context', () => {
    const [skill] = buildSkillTreeTrack(input).skills

    expect(skill.content).toContain('---\nname: read-eth-multi-timeframe-market-structure')
    expect(skill.content).toContain('description: "Trend, key levels and swings from measured candles."')
    expect(skill.content).toContain('manifest-version: "1.2.0"')
    expect(skill.content).toContain('- Confirmation policy: `risky-only`')
    expect(skill.content).toContain('- Place an order')
    expect(skill.content).toContain('- Invent unavailable prices')
  })

  it('produces deterministic unique slugs when labels normalize to the same value', () => {
    const track = buildSkillTreeTrack({
      ...input,
      skills: [
        { label: 'Évaluer le risque' },
        { label: 'Evaluer le risque' },
      ],
    })

    expect(track.skills[0].content).toContain('name: evaluer-le-risque')
    expect(track.skills[1].content).toContain('name: evaluer-le-risque-2')
    expect(buildSkillTreeTrack(input)).toEqual(buildSkillTreeTrack(input))
  })
})
