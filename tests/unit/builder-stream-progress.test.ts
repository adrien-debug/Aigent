/**
 * Réduction PURE des événements du flux d'authoring (src/components/builder/model.ts).
 *
 * Aucun DOM, aucun réseau, aucun tour d'architecte réel : les événements sont
 * fabriqués à la main dans la forme exacte que
 * `project-builder-stream-protocol.ts` définit. Ce qui est prouvé ici, c'est la
 * MACHINE À ÉTATS de l'écran — la seule partie du comportement du flux qui soit
 * vérifiable sans navigateur.
 *
 * Le point le plus important est la coupure : un flux qui s'arrête sans terminal
 * ne doit affirmer NI succès NI échec.
 */
import { describe, expect, it } from 'vitest'

import {
  INITIAL_STREAM_PROGRESS,
  markStreamInterrupted,
  openingStreamProgress,
  reduceStreamEvent,
  type StreamProgress,
} from '../../src/components/builder/model'
import {
  encodeProjectBuilderHeartbeat,
  encodeProjectBuilderSSE,
  type ProjectBuilderStreamEvent,
} from '../../src/lib/agent-mission-control/project-builder-stream-protocol'
import { consumeSSE, isProjectBuilderTerminal } from '../../src/lib/agent-mission-control/sse-client'

const RUN = 'run-42'

function connected(sequence = 1): ProjectBuilderStreamEvent {
  return { type: 'connected', lifecycle: 'running', runId: RUN, conversationId: null, sequence }
}

function delta(text: string, sequence: number): ProjectBuilderStreamEvent {
  return { type: 'delta', lifecycle: 'running', runId: RUN, conversationId: null, sequence, delta: text }
}

function completed(sequence: number): ProjectBuilderStreamEvent {
  return {
    type: 'terminal',
    lifecycle: 'completed',
    runId: RUN,
    conversationId: 'conv-1',
    sequence,
    messageId: 'msg-1',
    conversationStatus: 'draft_ready',
    preview: null,
    createdCopilotId: null,
  }
}

function failed(sequence: number): ProjectBuilderStreamEvent {
  return {
    type: 'terminal',
    lifecycle: 'failed',
    runId: RUN,
    conversationId: null,
    sequence,
    error: 'architect_message_failed',
    retryable: true,
  }
}

function reduceAll(events: readonly ProjectBuilderStreamEvent[]): StreamProgress {
  return events.reduce(reduceStreamEvent, openingStreamProgress())
}

describe('Builder — réduction du flux d’authoring', () => {
  it('part d’un état qui n’affirme rien', () => {
    expect(INITIAL_STREAM_PROGRESS.phase).toBe('idle')
    expect(INITIAL_STREAM_PROGRESS.outcomeUnknown).toBe(false)
    expect(INITIAL_STREAM_PROGRESS.completion).toBeNull()

    const opening = openingStreamProgress()
    expect(opening.phase).toBe('opening')
    expect(opening.text).toBe('')
    expect(opening.deltaCount).toBe(0)
    expect(opening.errorCode).toBeNull()
  })

  it('séquence nominale : connected → deltas → completed', () => {
    const state = reduceAll([connected(), delta('Bonjour', 2), delta(' opérateur', 3), completed(4)])

    expect(state.phase).toBe('completed')
    expect(state.text).toBe('Bonjour opérateur')
    expect(state.deltaCount).toBe(2)
    expect(state.runId).toBe(RUN)
    expect(state.errorCode).toBeNull()
    expect(state.outcomeUnknown).toBe(false)
    expect(state.completion).toEqual({
      messageId: 'msg-1',
      conversationId: 'conv-1',
      conversationStatus: 'draft_ready',
      createdCopilotId: null,
    })
  })

  it('après connected et avant tout delta, le résultat est encore inconnu', () => {
    const state = reduceAll([connected()])
    expect(state.phase).toBe('working')
    expect(state.outcomeUnknown).toBe(true)
    // Aucune étape d'outil inventée : le protocole n'en émet pas.
    expect(state.deltaCount).toBe(0)
    expect(state.text).toBe('')
  })

  it('erreur serveur : phase `failed`, code réel, jamais `interrupted`', () => {
    const state = reduceAll([connected(), delta('début', 2), failed(3)])

    expect(state.phase).toBe('failed')
    expect(state.errorCode).toBe('architect_message_failed')
    expect(state.retryable).toBe(true)
    expect(state.completion).toBeNull()
    // Le serveur a PARLÉ : ce n'est pas un résultat inconnu.
    expect(state.outcomeUnknown).toBe(false)
  })

  it('coupure en cours : ni succès ni échec — résultat inconnu', () => {
    const midway = reduceAll([connected(), delta('réponse partielle', 2)])
    const cut = markStreamInterrupted(midway, 'network error')

    expect(cut.phase).toBe('interrupted')
    expect(cut.outcomeUnknown).toBe(true)
    // Aucun code d'erreur fabriqué : le serveur n'en a jamais envoyé.
    expect(cut.errorCode).toBeNull()
    expect(cut.completion).toBeNull()
    // La prose déjà reçue n'est pas effacée : elle a réellement été reçue.
    expect(cut.text).toBe('réponse partielle')
    expect(cut.detail).toContain('network error')
  })

  it('une coupure survenue APRÈS un terminal ne repeint pas le résultat', () => {
    const done = reduceAll([connected(), completed(2)])
    expect(markStreamInterrupted(done, 'late')).toBe(done)

    const broke = reduceAll([connected(), failed(2)])
    expect(markStreamInterrupted(broke, 'late')).toBe(broke)
  })

  it('un heartbeat n’atteint jamais la réduction et n’est donc pas une étape', async () => {
    const encoder = new TextEncoder()
    const frames = [
      encodeProjectBuilderSSE(connected()),
      encodeProjectBuilderHeartbeat(RUN, 1),
      encodeProjectBuilderHeartbeat(RUN, 1),
      encodeProjectBuilderSSE(delta('texte', 2)),
      encodeProjectBuilderSSE(completed(3)),
    ]
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        frames.forEach((frame) => controller.enqueue(encoder.encode(frame)))
        controller.close()
      },
    })

    let state = openingStreamProgress()
    const result = await consumeSSE<ProjectBuilderStreamEvent>(
      body,
      (event) => {
        state = reduceStreamEvent(state, event)
      },
      { isTerminal: isProjectBuilderTerminal, requireTerminal: true },
    )

    // 3 événements réels malgré 2 battements de cœur intercalés.
    expect(result.events).toBe(3)
    expect(state.deltaCount).toBe(1)
    expect(state.text).toBe('texte')
    expect(state.phase).toBe('completed')
  })

  it('la réduction est pure : elle ne mute jamais l’état reçu', () => {
    const before = openingStreamProgress()
    const snapshot = { ...before }
    const after = reduceStreamEvent(before, delta('x', 1))

    expect(before).toEqual(snapshot)
    expect(after).not.toBe(before)
  })

  /* ── Garde de terminalité : une issue prouvée ne se réécrit pas ──────────
   *
   * Les trois cas ci-dessous ne sont pas déclenchables par le serveur actuel
   * (la route pousse le terminal en dernier). Ils sont testés parce qu'une
   * asymétrie de discipline dans ce module — `markStreamInterrupted` gardait
   * déjà la terminalité, `reduceStreamEvent` non — est précisément ce qui
   * produit un mensonge le jour où le protocole change.
   */

  it('un delta APRÈS un terminal ne rouvre pas un tour prouvé', () => {
    const done = reduceStreamEvent(reduceStreamEvent(openingStreamProgress(), connected()), completed(2))
    expect(done.phase).toBe('completed')
    expect(done.outcomeUnknown).toBe(false)

    const after = reduceStreamEvent(done, delta('suite inattendue', 3))

    // Sans la garde : phase repassait à 'streaming' et outcomeUnknown à true,
    // alors que `completion` restait renseignée — l'écran repeignait un tour
    // persisté en « résultat inconnu ».
    expect(after.phase).toBe('completed')
    expect(after.outcomeUnknown).toBe(false)
    expect(after.completion).not.toBeNull()
  })

  it('un second terminal n’efface pas une réussite déjà prouvée', () => {
    const done = reduceStreamEvent(reduceStreamEvent(openingStreamProgress(), connected()), completed(2))
    const after = reduceStreamEvent(done, failed(3))

    // Sans la garde : phase 'failed', errorCode renseigné, `completion` effacée
    // — un succès persisté devenait un échec affiché.
    expect(after.phase).toBe('completed')
    expect(after.errorCode).toBeNull()
    expect(after.completion).not.toBeNull()
  })

  it('un événement inconnu est IGNORÉ, jamais traité comme un échec', () => {
    const working = reduceStreamEvent(openingStreamProgress(), connected())
    // Le cinquième événement que le protocole n'a pas encore : un appel d'outil
    // est le candidat évident, et c'est l'absence que cette surface documente.
    const unknown = { type: 'tool_call', runId: RUN, sequence: 2 } as unknown as ProjectBuilderStreamEvent
    const after = reduceStreamEvent(working, unknown)

    // Avant : phase 'failed' + errorCode `undefined` — une valeur hors du type
    // déclaré, et un échec que le serveur n'a jamais prononcé.
    expect(after.phase).toBe('working')
    expect(after.errorCode).toBeNull()
    expect(after.outcomeUnknown).toBe(true)
  })
})
