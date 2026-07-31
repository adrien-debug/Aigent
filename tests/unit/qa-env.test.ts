/**
 * Le harnais QA refuse-t-il vraiment la production ?
 *
 * Ces tests portent sur la garantie la plus importante du dispositif QA : qu'un
 * test qui écrit en base ne puisse JAMAIS, par aucun chemin, atterrir sur la
 * base produit. Ils sont volontairement paranoïaques — c'est le seul filet
 * entre une variable oubliée et une écriture dans la base qui porte les
 * copilots réels.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { QA_ENV_KEYS, qaEnvAvailable, requireQaEnv } from '../../src/lib/agent-mission-control/qa-env'

const VALID = {
  AIGENT_QA_DATABASE_URL: 'postgres://aigent_qa_owner:pw@10.0.0.1:5432/aigent_qa',
  AIGENT_QA_SUPABASE_URL: 'http://10.0.0.1:3010',
  AIGENT_QA_SUPABASE_SERVICE_ROLE_KEY: 'header.payload.signature',
  AIGENT_QA_CONSUMER_TELEMETRY_TOKEN: 'qa-token',
} as const

/** Les variables PRODUIT, posées exprès : elles ne doivent JAMAIS être lues. */
const PRODUCTION_DECOYS = {
  AMC_SUPABASE_URL: 'https://aigent-db.hearst.app',
  SUPABASE_SERVICE_ROLE_KEY: 'prod-service-role-key',
  AMC_DATA_SOURCE: 'gpu1',
} as const

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {}
  for (const k of [...QA_ENV_KEYS, ...Object.keys(PRODUCTION_DECOYS)]) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('requireQaEnv — échec immédiat, aucun repli', () => {
  it('lève quand TOUTES les variables QA manquent', () => {
    expect(() => requireQaEnv()).toThrow(/Environnement QA incomplet/)
  })

  it('nomme exactement la variable manquante — une seule absente suffit à lever', () => {
    Object.assign(process.env, VALID)
    delete process.env.AIGENT_QA_CONSUMER_TELEMETRY_TOKEN

    expect(() => requireQaEnv()).toThrow(/AIGENT_QA_CONSUMER_TELEMETRY_TOKEN/)
  })

  it('LE TEST QUI COMPTE : ne retombe jamais sur les variables produit', () => {
    // Les variables produit sont là, parfaitement valides. Les QA n'y sont pas.
    Object.assign(process.env, PRODUCTION_DECOYS)

    // Un repli, même « de secours », rendrait ce test vert. Il doit lever.
    expect(() => requireQaEnv()).toThrow(/Environnement QA incomplet/)

    // Et l'erreur doit le DIRE, pour que personne ne « corrige » en ajoutant un repli.
    expect(() => requireQaEnv()).toThrow(/AUCUN repli/)
  })

  it('une variable vide ou blanche vaut absente', () => {
    Object.assign(process.env, VALID)
    process.env.AIGENT_QA_SUPABASE_URL = '   '

    expect(() => requireQaEnv()).toThrow(/AIGENT_QA_SUPABASE_URL/)
  })

  it('résout les quatre valeurs quand tout est présent', () => {
    Object.assign(process.env, VALID)
    const env = requireQaEnv()

    expect(env.databaseUrl).toBe(VALID.AIGENT_QA_DATABASE_URL)
    expect(env.supabaseUrl).toBe(VALID.AIGENT_QA_SUPABASE_URL)
    expect(env.serviceRoleKey).toBe(VALID.AIGENT_QA_SUPABASE_SERVICE_ROLE_KEY)
    expect(env.consumerTelemetryToken).toBe(VALID.AIGENT_QA_CONSUMER_TELEMETRY_TOKEN)
  })
})

describe('requireQaEnv — refuse une cible de production mal collée', () => {
  it('refuse une URL QA qui pointe sur l’hôte de production', () => {
    Object.assign(process.env, VALID)
    process.env.AIGENT_QA_SUPABASE_URL = 'https://aigent-db.hearst.app'

    expect(() => requireQaEnv()).toThrow(/PRODUCTION/)
  })

  it('refuse une DATABASE_URL qui vise la base `aigent` et non `aigent_qa`', () => {
    Object.assign(process.env, VALID)
    process.env.AIGENT_QA_DATABASE_URL = 'postgres://u:p@10.0.0.1:5432/aigent'

    expect(() => requireQaEnv()).toThrow(/production/i)
  })

  it('accepte `aigent_qa` — le préfixe partagé ne doit pas produire de faux refus', () => {
    Object.assign(process.env, VALID)
    expect(() => requireQaEnv()).not.toThrow()
  })
})

describe('qaEnvAvailable — pour SKIPPER, jamais pour choisir une cible', () => {
  it('false quand une variable manque', () => {
    Object.assign(process.env, VALID)
    delete process.env.AIGENT_QA_DATABASE_URL

    expect(qaEnvAvailable()).toBe(false)
  })

  it('false même quand les variables produit sont toutes présentes', () => {
    Object.assign(process.env, PRODUCTION_DECOYS)
    expect(qaEnvAvailable()).toBe(false)
  })

  it('true quand les quatre sont là', () => {
    Object.assign(process.env, VALID)
    expect(qaEnvAvailable()).toBe(true)
  })
})

describe('le module ne connaît pas les variables produit', () => {
  it('QA_ENV_KEYS ne contient QUE des noms AIGENT_QA_*', () => {
    for (const k of QA_ENV_KEYS) expect(k.startsWith('AIGENT_QA_')).toBe(true)
    expect(QA_ENV_KEYS).toHaveLength(4)
  })
})
