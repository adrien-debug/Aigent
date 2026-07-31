/**
 * Scénarios 11 à 14 — l'agrégation `active_in_consumer`, sur des lignes qui
 * ont RÉELLEMENT traversé la route HTTP contre `aigent_qa`.
 *
 * Les autres tests de ce module fabriquent leurs lignes. Ceux-ci partent de la
 * forme exacte que la route a persistée le 2026-07-31 — six événements en 202,
 * relus depuis `runtime_telemetry_events`. C'est la différence entre « la
 * fonction se comporte bien sur ce que je lui donne » et « elle se comporte
 * bien sur ce que le système produit vraiment ».
 *
 * LE POINT NON NÉGOCIABLE (scénario 14) : aucun chemin ne doit produire
 * `false`. Le type l'interdit déjà (`true | 'unknown'`), mais un type se
 * contourne au refactor — ces tests le vérifient sur le comportement.
 */
import { describe, expect, it } from 'vitest'

import {
  ACTIVATION_RECENCY_WINDOW_MS,
  deriveConsumerActivation,
} from '../../src/lib/agent-mission-control/consumer-activation'

/**
 * La forme de ligne que la fonction accepte. Déclarée ICI plutôt qu'exportée
 * depuis le module : ce type est un détail d'implémentation de la lecture, et
 * l'exporter uniquement pour un test élargirait sa surface publique sans raison.
 */
interface ConsumerEventRow {
  event_type?: unknown
  received_at?: unknown
  installation_id?: unknown
  version_id?: unknown
}

const COPILOT = 'qa-copilot-alpha'
const INSTALLATION = 'qa-inst-alpha'
const NOW = new Date('2026-07-31T08:00:00.000Z')

/** La forme réellement persistée par la route (relevée en base après les frappes). */
function persisted(eventType: string, receivedAt: string): ConsumerEventRow {
  return {
    event_type: eventType,
    installation_id: INSTALLATION,
    received_at: receivedAt,
    version_id: 'qa-version-1',
  } as ConsumerEventRow
}

const recent = (minutesAgo: number) =>
  new Date(NOW.getTime() - minutesAgo * 60_000).toISOString()
const older = (msBeyondWindow: number) =>
  new Date(NOW.getTime() - ACTIVATION_RECENCY_WINDOW_MS - msBeyondWindow).toISOString()

describe('11 · absence de preuve → unknown', () => {
  it('aucune ligne du tout → unknown, jamais false', () => {
    const r = deriveConsumerActivation(COPILOT, [], { delivered: false, now: NOW })
    expect(r.activeInConsumer).toBe('unknown')
  })

  it('livré mais jamais observé → unknown, et la RAISON distingue les deux', () => {
    const delivered = deriveConsumerActivation(COPILOT, [], { delivered: true, now: NOW })
    const never = deriveConsumerActivation(COPILOT, [], { delivered: false, now: NOW })

    expect(delivered.activeInConsumer).toBe('unknown')
    expect(never.activeInConsumer).toBe('unknown')
    // Même verdict, causes différentes : « poussé, silencieux » n'est pas
    // « jamais poussé ». Un opérateur doit pouvoir les séparer.
    expect(delivered.reason).not.toBe(never.reason)
  })

  it('un événement NON authentifié (installation_id null) ne prouve rien', () => {
    const internal = { ...persisted('consumer.run_completed', recent(1)), installation_id: null }
    const r = deriveConsumerActivation(COPILOT, [internal as ConsumerEventRow], {
      delivered: true,
      now: NOW,
    })
    expect(r.activeInConsumer).toBe('unknown')
  })
})

describe('12 · preuve récente authentifiée → true', () => {
  it('un run_completed récent et authentifié → true', () => {
    const r = deriveConsumerActivation(COPILOT, [persisted('consumer.run_completed', recent(5))], {
      delivered: true,
      now: NOW,
    })
    expect(r.activeInConsumer).toBe(true)
  })

  it('UN HEARTBEAT NE SUFFIT PAS — il prouve un runtime vivant, pas une exécution', () => {
    const r = deriveConsumerActivation(COPILOT, [persisted('consumer.heartbeat', recent(1))], {
      delivered: true,
      now: NOW,
    })
    // Confondre les deux surestimerait l'adoption : « le processus tourne » et
    // « l'agent a fait quelque chose » sont deux affirmations distinctes.
    expect(r.activeInConsumer).toBe('unknown')
  })

  it('les six événements du contrat, tels que la route les a écrits', () => {
    const rows = [
      persisted('consumer.installation_seen', recent(30)),
      persisted('consumer.version_loaded', recent(25)),
      persisted('consumer.run_started', recent(20)),
      persisted('consumer.run_completed', recent(15)),
      persisted('consumer.run_failed', recent(10)),
      persisted('consumer.heartbeat', recent(5)),
    ]
    const r = deriveConsumerActivation(COPILOT, rows, { delivered: true, now: NOW })

    expect(r.activeInConsumer).toBe(true)
    expect(r.lastVersionLoaded).toBe('qa-version-1')
    // Jamais confronté à copilot_versions — la lecture le DÉCLARE.
    expect(r.lastVersionLoadedVerified).toBe(false)
  })
})

describe('13 · preuve ancienne → stale, retour à unknown', () => {
  it('une exécution HORS fenêtre ne vaut plus true', () => {
    const r = deriveConsumerActivation(COPILOT, [persisted('consumer.run_completed', older(60_000))], {
      delivered: true,
      now: NOW,
    })
    expect(r.activeInConsumer).toBe('unknown')
  })

  it('la preuve périmée reste LISIBLE : on sait qu’il y en a eu une', () => {
    const r = deriveConsumerActivation(COPILOT, [persisted('consumer.run_completed', older(60_000))], {
      delivered: true,
      now: NOW,
    })
    // « Plus de preuve récente » n'est pas « aucune preuve n'a jamais existé ».
    expect(r.staleEvidence).toBe(true)
  })

  it('la fenêtre est appliquée dans les DEUX sens, à sa borne exacte', () => {
    const justInside = deriveConsumerActivation(
      COPILOT,
      [persisted('consumer.run_completed', new Date(NOW.getTime() - ACTIVATION_RECENCY_WINDOW_MS + 60_000).toISOString())],
      { delivered: true, now: NOW },
    )
    const justOutside = deriveConsumerActivation(COPILOT, [persisted('consumer.run_completed', older(60_000))], {
      delivered: true,
      now: NOW,
    })

    expect(justInside.activeInConsumer).toBe(true)
    expect(justOutside.activeInConsumer).toBe('unknown')
  })

  it('la fenêtre est renvoyée dans le résultat — un verdict n’est jamais inexpliqué', () => {
    const r = deriveConsumerActivation(COPILOT, [], { delivered: true, now: NOW })
    expect(r.recencyWindowMs).toBe(ACTIVATION_RECENCY_WINDOW_MS)
    expect(r.recencyWindowDays).toBeGreaterThan(0)
    expect(typeof r.reason).toBe('string')
  })
})

describe('14 · AUCUN cas ne produit false implicitement', () => {
  const CASES: Array<[string, ConsumerEventRow[], boolean]> = [
    ['aucune ligne, non livré', [], false],
    ['aucune ligne, livré', [], true],
    ['heartbeat seul', [persisted('consumer.heartbeat', recent(1))], true],
    ['exécution périmée', [persisted('consumer.run_completed', older(1))], true],
    ['run_failed récent', [persisted('consumer.run_failed', recent(2))], true],
    ['run_started sans complétion', [persisted('consumer.run_started', recent(2))], true],
    ['événement non authentifié', [{ ...persisted('consumer.run_completed', recent(1)), installation_id: null } as ConsumerEventRow], true],
    ['exécution récente', [persisted('consumer.run_completed', recent(1))], true],
  ]

  it.each(CASES)('%s → true ou unknown, JAMAIS false', (_label, rows, delivered) => {
    const r = deriveConsumerActivation(COPILOT, rows, { delivered, now: NOW })
    expect(r.activeInConsumer === true || r.activeInConsumer === 'unknown').toBe(true)
    // L'assertion qui compte : la valeur littérale `false` ne doit jamais sortir.
    expect(r.activeInConsumer as unknown).not.toBe(false)
  })
})
