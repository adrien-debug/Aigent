import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyLayout,
  clearLayout,
  layoutKey,
  parseLayout,
  readLayout,
  toStoredLayout,
  writeLayout,
} from '@/components/runtime/graph-layout-store'

/**
 * La persistance de disposition — ce qui compte ici est qu'elle ne puisse
 * JAMAIS casser le graphe. Une disposition est un confort : corrompue, absente
 * ou refusée par le navigateur, elle doit s'effacer devant la disposition
 * calculée, sans bruit et sans perdre un nœud.
 */

/** Un `localStorage` minimal, en mémoire. */
function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    get size() {
      return map.size
    },
  }
}

describe('parseLayout', () => {
  it('rend null sur une entrée absente ou illisible', () => {
    expect(parseLayout(null)).toBeNull()
    expect(parseLayout('pas du json')).toBeNull()
    expect(parseLayout('[]')).toBeNull()
    expect(parseLayout('{"positions":null}')).toBeNull()
  })

  it('conserve les positions valides', () => {
    const layout = parseLayout('{"positions":{"agent":{"x":10,"y":20}}}')
    expect(layout?.positions.agent).toEqual({ x: 10, y: 20 })
  })

  it('écarte les coordonnées non finies ou démesurées', () => {
    // Une coordonnée absurde enverrait le nœud hors du monde visible, sans
    // aucun moyen de le récupérer : elle ne passe pas.
    const layout = parseLayout(
      '{"positions":{"ok":{"x":1,"y":2},"nan":{"x":null,"y":5},"loin":{"x":99999999,"y":0}}}',
    )
    expect(Object.keys(layout?.positions ?? {})).toEqual(['ok'])
  })

  it('écarte un cadrage au zoom absurde', () => {
    const layout = parseLayout('{"positions":{},"viewport":{"x":0,"y":0,"zoom":9999}}')
    expect(layout?.viewport).toBeUndefined()
  })

  it('conserve un cadrage plausible', () => {
    const layout = parseLayout('{"positions":{},"viewport":{"x":5,"y":6,"zoom":1.5}}')
    expect(layout?.viewport).toEqual({ x: 5, y: 6, zoom: 1.5 })
  })
})

describe('applyLayout', () => {
  const nodes = [
    { id: 'a', position: { x: 0, y: 0 } },
    { id: 'b', position: { x: 0, y: 100 } },
  ]

  it('sans disposition stockée, ne change rien', () => {
    expect(applyLayout(nodes, null)).toEqual(nodes)
  })

  it('remplace la position d’un nœud connu', () => {
    const out = applyLayout(nodes, { positions: { a: { x: 42, y: 43 } } })
    expect(out.find((n) => n.id === 'a')?.position).toEqual({ x: 42, y: 43 })
  })

  it('IGNORE un identifiant absent du graphe — le graphe fait autorité', () => {
    const out = applyLayout(nodes, { positions: { fantome: { x: 1, y: 1 } } })
    expect(out).toHaveLength(2)
    expect(out.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('garde la position calculée d’un nœud absent du stockage', () => {
    // Un graphe qui gagne un nœud doit rester lisible sans réinitialisation.
    const out = applyLayout(nodes, { positions: { a: { x: 9, y: 9 } } })
    expect(out.find((n) => n.id === 'b')?.position).toEqual({ x: 0, y: 100 })
  })

  it('ne mute pas les nœuds d’entrée', () => {
    applyLayout(nodes, { positions: { a: { x: 7, y: 7 } } })
    expect(nodes[0].position).toEqual({ x: 0, y: 0 })
  })
})

describe('cycle déplacement → rechargement → réinitialisation', () => {
  const storage = fakeStorage()

  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: storage })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('un déplacement survit au rechargement, un reset le supprime', () => {
    const moved = [
      { id: 'a', position: { x: 300, y: 400 } },
      { id: 'b', position: { x: 0, y: 100 } },
    ]

    // Déplacement → écriture.
    writeLayout('agent_builder', toStoredLayout(moved))

    // « Rechargement » : on repart de la disposition CALCULÉE, puis on relit.
    const fresh = [
      { id: 'a', position: { x: 0, y: 0 } },
      { id: 'b', position: { x: 0, y: 100 } },
    ]
    const restored = applyLayout(fresh, readLayout('agent_builder'))
    expect(restored.find((n) => n.id === 'a')?.position).toEqual({ x: 300, y: 400 })

    // Réinitialisation → la disposition calculée revient.
    clearLayout('agent_builder')
    expect(readLayout('agent_builder')).toBeNull()
    expect(applyLayout(fresh, readLayout('agent_builder'))).toEqual(fresh)
  })

  it('cloisonne deux graphes', () => {
    writeLayout('graphe-1', { positions: { a: { x: 1, y: 1 } } })
    writeLayout('graphe-2', { positions: { a: { x: 2, y: 2 } } })
    expect(readLayout('graphe-1')?.positions.a).toEqual({ x: 1, y: 1 })
    expect(readLayout('graphe-2')?.positions.a).toEqual({ x: 2, y: 2 })
    expect(layoutKey('graphe-1')).not.toBe(layoutKey('graphe-2'))
  })

  it('ne stocke QUE des coordonnées — rien de métier', () => {
    const stored = toStoredLayout([
      { id: 'agent', position: { x: 1, y: 2 }, data: { label: 'secret métier' } } as never,
    ])
    const serialized = JSON.stringify(stored)
    expect(serialized).not.toContain('secret métier')
    expect(serialized).not.toContain('label')
    expect(stored.positions.agent).toEqual({ x: 1, y: 2 })
  })
})

describe('résistance aux pannes de stockage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('un localStorage qui lève ne casse rien', () => {
    // Mode privé, quota plein, stockage refusé par politique : la persistance
    // est dégradée, jamais le rendu du graphe.
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('refusé')
        },
        setItem: () => {
          throw new Error('quota')
        },
        removeItem: () => {
          throw new Error('refusé')
        },
      },
    })

    expect(readLayout('g')).toBeNull()
    expect(() => writeLayout('g', { positions: {} })).not.toThrow()
    expect(() => clearLayout('g')).not.toThrow()
  })

  it('côté serveur (sans window), tout est inerte', () => {
    vi.stubGlobal('window', undefined)
    expect(readLayout('g')).toBeNull()
    expect(() => writeLayout('g', { positions: {} })).not.toThrow()
  })
})
