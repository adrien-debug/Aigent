/**
 * AIG-DROPSHIP-001 — LOT 1 roster tests.
 *
 * Pure, offline : aucun LLM, aucun réseau, aucun secret. Vérifie que l'import
 * des six copilots dropship est bien formé et que les invariants machine-
 * vérifiables tiennent — provenance pinnée, slugs uniques, outils uniques par
 * agent, chaque outil 'spend'/'ship' confirmé, les sept gates code-enforced du
 * Super Agent présentes, et la vérité d'exécution (modèles, limites de boucle)
 * conforme au commit importé.
 */
import { describe, it, expect } from 'vitest'
import {
  DROPSHIP_ROSTER,
  DROPSHIP_IMPORT,
  getDropshipAgentBySlug,
} from '@/lib/agent-mission-control/dropship/agents/roster'

describe('dropship roster (Lot 1 — import)', () => {
  it('pins its provenance to a full commit SHA of the dropship repo', () => {
    expect(DROPSHIP_IMPORT.repo).toBe('Hearst-Corporation/dropship-platform')
    expect(DROPSHIP_IMPORT.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(DROPSHIP_IMPORT.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('defines exactly six imported agents', () => {
    expect(DROPSHIP_ROSTER).toHaveLength(6)
  })

  it('has unique kebab-case slugs and unique names', () => {
    const slugs = DROPSHIP_ROSTER.map((a) => a.slug)
    expect(new Set(slugs).size).toBe(6)
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
    expect(new Set(DROPSHIP_ROSTER.map((a) => a.name)).size).toBe(6)
  })

  it('covers the five hub modes plus the Super Agent', () => {
    expect(DROPSHIP_ROSTER.map((a) => a.name).sort()).toEqual(
      ['Ads', 'Curation', 'Dev', 'Médias', 'Recherche', 'Super Agent'].sort(),
    )
  })

  it('every agent executes on dropship-platform, never in Aigent', () => {
    for (const agent of DROPSHIP_ROSTER) {
      expect(agent.executionHost).toBe('dropship-platform')
      expect(agent.promptSource.file.startsWith('apps/web/lib/agent/')).toBe(true)
      expect(agent.promptSource.exportName.length).toBeGreaterThan(0)
    }
  })

  it('has non-empty prompts, unique tool ids per agent, and sane loop limits', () => {
    for (const agent of DROPSHIP_ROSTER) {
      expect(agent.systemPromptCore.length).toBeGreaterThan(100)
      expect(agent.tools.length).toBeGreaterThan(0)
      const ids = agent.tools.map((t) => t.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(agent.maxToolLoopsPerTurn).toBeGreaterThan(0)
      expect(agent.maxToolCallsPerTurn).toBeGreaterThanOrEqual(agent.maxToolLoopsPerTurn)
      expect(agent.isAiAssistant).toBe(true)
    }
  })

  it('models match the execution truth at the imported commit', () => {
    const modelBySlug = Object.fromEntries(
      DROPSHIP_ROSTER.map((a) => [a.slug, a.model.id]),
    )
    expect(modelBySlug).toEqual({
      'dropship-recherche-niche': 'gpt-5.4',
      'dropship-curation': 'gpt-4o',
      'dropship-ads': 'gpt-4o',
      'dropship-medias': 'gpt-4o',
      'dropship-dev': 'gpt-4o',
      'dropship-super-agent': 'gpt-4.1',
    })
  })

  it("every 'ship' tool and every real-ad-spend tool carries a confirmation", () => {
    // Vérité importée : dropship gate les sorties (push/deploy/CI) et les pushs
    // de budget publicitaire réel. La génération d'images (generate_visual,
    // regenerate_asset, quelques centimes fal.ai) n'est PAS gatée hors mode
    // Médias — on ne durcit pas l'import au-delà de la source.
    const AD_SPEND_TOOLS = new Set([
      'publish_to_meta',
      'publish_to_tiktok',
      'publish_to_google',
      'google_ads_push',
    ])
    for (const agent of DROPSHIP_ROSTER) {
      for (const tool of agent.tools) {
        if (tool.sideEffect === 'ship') {
          expect(tool.confirm, `${agent.slug}/${tool.id}`).toBeDefined()
        }
        if (AD_SPEND_TOOLS.has(tool.id)) {
          expect(tool.sideEffect, `${agent.slug}/${tool.id}`).toBe('spend')
          const gated =
            tool.confirm !== undefined || agent.alwaysConfirmActions.includes(tool.id)
          expect(gated, `${agent.slug}/${tool.id}`).toBe(true)
        }
      }
    }
  })

  it('the Super Agent keeps its seven code-enforced confirmation gates', () => {
    const superAgent = getDropshipAgentBySlug('dropship-super-agent')!
    const codeGated = superAgent.tools
      .filter((t) => t.confirm?.enforcedBy === 'code')
      .map((t) => t.id)
      .sort()
    expect(codeGated).toEqual(
      [
        'run_sql',
        'delete_store',
        'delete_stores_bulk',
        'medusa_admin',
        'trigger_workflow',
        'deploy_vercel',
        'google_ads_push',
      ].sort(),
    )
  })

  it('the Dev copilot gates git_push in code and forbids the dangerous paths', () => {
    const dev = getDropshipAgentBySlug('dropship-dev')!
    const push = dev.tools.find((t) => t.id === 'git_push')!
    expect(push.confirm).toEqual({ enforcedBy: 'code', key: 'git_push' })
    expect(dev.forbiddenActions.join(' ')).toContain('.env*')
    expect(dev.maxToolLoopsPerTurn).toBe(15)
    expect(dev.maxToolCallsPerTurn).toBe(20)
  })

  it('the Ads copilot always confirms the three live publish tools', () => {
    const ads = getDropshipAgentBySlug('dropship-ads')!
    expect([...ads.alwaysConfirmActions].sort()).toEqual(
      ['publish_to_google', 'publish_to_meta', 'publish_to_tiktok'].sort(),
    )
    for (const id of ads.alwaysConfirmActions) {
      expect(ads.tools.find((t) => t.id === id)?.sideEffect).toBe('spend')
    }
  })

  it('the Research copilot keeps its contract tool and its mandatory-sequence guardrails', () => {
    const research = getDropshipAgentBySlug('dropship-recherche-niche')!
    expect(research.tools.map((t) => t.id)).toContain('shortlist_niche')
    expect(research.systemPromptCore).toContain('Mandatory analysis sequence before `shortlist_niche`')
    expect(research.systemPromptCore).toContain('LUXURY PLAY')
    // Les blocs dynamiques ne sont jamais résolus dans l'import.
    expect(research.dynamicContextSlots.length).toBeGreaterThan(0)
    expect(research.systemPromptCore).not.toContain('=== Temporal context')
  })

  it('interpolated store context stays as {{slots}}, never fabricated values', () => {
    for (const slug of ['dropship-curation', 'dropship-ads', 'dropship-medias', 'dropship-dev']) {
      const agent = getDropshipAgentBySlug(slug)!
      expect(agent.systemPromptCore).toContain('{{store_name}}')
      expect(agent.systemPromptCore).toContain('{{store_niche}}')
    }
    const superAgent = getDropshipAgentBySlug('dropship-super-agent')!
    expect(superAgent.systemPromptCore).toContain('{{page}}')
    expect(superAgent.systemPromptCore).toContain('{{store_id}}')
  })
})
