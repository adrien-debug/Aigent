/**
 * Live test — l'exporter Langfuse contre l'instance SELF-HOSTED réelle.
 *
 * Lève le doute « wired-but-unverified » : ce test POSTe une vraie trace vers
 * le Langfuse d'Adrien (GPU2) et vérifie que l'instance l'accepte. Opt-in via
 * `npm run test:live` ; self-skip propre si les vars ne sont pas configurées
 * (tests/live/setup.ts charge .env.local avant).
 *
 * Aucun coût : Langfuse est self-hosted, zéro appel LLM ici.
 *
 * Ce test a déjà payé sa place : il a révélé qu'un step sans `durationMs`
 * finissait en Invalid Date et faisait THROW l'export hors de la fonction,
 * alors que l'export doit toujours être fail-soft (une trace ratée ne doit
 * jamais casser le run qui l'a produite).
 */
import { describe, expect, it } from 'vitest'

import {
  exportLangfuseTrace,
  isLangfuseConfigured,
  buildLangfuseBatch,
} from '@/lib/agent-mission-control/langfuse'

const configured = isLangfuseConfigured()

describe.skipIf(!configured)('langfuse export (live, self-hosted)', () => {
  it('accepte une trace complète avec generation + span', async () => {
    const startedAt = new Date(Date.now() - 4_000).toISOString()
    // Suffixe horodaté : suffit à éviter la collision d'id, sans aléa.
    const traceId = `aigent-live-check-${Date.now()}`

    const result = await exportLangfuseTrace({
      traceId,
      name: 'aigent-live-check',
      metadata: { source: 'tests/live/langfuse-export.test.ts', copilotId: 'live-check' },
      tags: ['live-check'],
      startedAt,
      finishedAt: new Date().toISOString(),
      input: { prompt: 'live wiring check' },
      output: { text: 'ok' },
      steps: [
        {
          name: 'model call',
          kind: 'llm-call',
          status: 'ok',
          detail: 'live wiring check',
          startedAt,
          durationMs: 1_200,
          model: 'gpt-4o-mini',
          provider: 'openai',
          usage: { promptTokens: 12, completionTokens: 7, totalTokens: 19 },
          costUsd: 0.0001,
          input: { messages: 1 },
          output: { text: 'ok' },
        },
        {
          name: 'read_project_summary',
          kind: 'tool-call',
          status: 'ok',
          detail: 'read-only lookup',
          startedAt,
          durationMs: 90,
          input: { projectId: 'live-check' },
          output: { ok: true },
        },
      ],
    })

    expect(result.reason ?? '').toBe('')
    expect(result.exported).toBe(true)
    expect(result.eventCount).toBeGreaterThanOrEqual(3)
    expect(result.traceUrl).toContain(traceId)
  })

  it('un step à durée manquante dégrade sans jamais throw', async () => {
    const startedAt = new Date().toISOString()
    const brokenStep = {
      name: 'step sans duree',
      kind: 'tool-call',
      status: 'ok',
      detail: 'duration absente du payload',
      startedAt,
    } as unknown as Parameters<typeof buildLangfuseBatch>[0]['steps'][number]

    expect(() =>
      buildLangfuseBatch({
        traceId: `aigent-live-degrade-${Date.now()}`,
        name: 'aigent-live-degrade',
        metadata: {},
        startedAt,
        finishedAt: startedAt,
        steps: [brokenStep],
      })
    ).not.toThrow()

    const result = await exportLangfuseTrace({
      traceId: `aigent-live-degrade-${Date.now()}`,
      name: 'aigent-live-degrade',
      metadata: { source: 'tests/live/langfuse-export.test.ts' },
      startedAt,
      finishedAt: startedAt,
      steps: [brokenStep],
    })
    expect(result.exported).toBe(true)
  })
})

describe.skipIf(configured)('langfuse export (live) — skip', () => {
  it('vars Langfuse absentes : test non exécuté', () => {
    expect(isLangfuseConfigured()).toBe(false)
  })
})
