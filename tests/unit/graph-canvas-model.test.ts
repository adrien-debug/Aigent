import { describe, expect, it } from 'vitest'

import { toCanvasGraph } from '@/components/runtime/graph-canvas-model'

/**
 * Le mapping topologie → Canvas est PUR : il se teste sans navigateur, sans
 * Agent Server et sans réseau. Ce qui est vérifié ici est exactement ce que
 * l'écran promet — en particulier qu'il n'invente rien.
 */
describe('toCanvasGraph', () => {
  it('rend un graphe vide pour une entrée vide', () => {
    const g = toCanvasGraph([], [])
    expect(g.nodes).toEqual([])
    expect(g.edges).toEqual([])
    expect(g.droppedEdges).toBe(0)
  })

  it('conserve chaque nœud réel, une seule fois', () => {
    const g = toCanvasGraph(
      [
        { id: '__start__', label: '__start__' },
        { id: 'agent', label: 'agent', type: 'runnable' },
        { id: 'agent', label: 'doublon' },
      ],
      [],
    )
    expect(g.nodes.map((n) => n.id)).toEqual(['__start__', 'agent'])
    // Le premier gagne : le doublon ne réécrit pas le label.
    expect(g.nodes.find((n) => n.id === 'agent')?.data.label).toBe('agent')
  })

  it('ordonne les rangs selon le flux depuis __start__', () => {
    const g = toCanvasGraph(
      [
        { id: '__start__', label: 'start' },
        { id: 'agent', label: 'agent' },
        { id: 'tools', label: 'tools' },
        { id: '__end__', label: 'end' },
      ],
      [
        { source: '__start__', target: 'agent' },
        { source: 'agent', target: 'tools' },
        { source: 'tools', target: '__end__' },
      ],
    )
    const y = (id: string) => g.nodes.find((n) => n.id === id)?.position.y ?? -1
    expect(y('__start__')).toBeLessThan(y('agent'))
    expect(y('agent')).toBeLessThan(y('tools'))
    expect(y('tools')).toBeLessThan(y('__end__'))
  })

  it('écarte les arêtes vers un nœud inconnu et le COMPTE', () => {
    const g = toCanvasGraph(
      [{ id: 'agent', label: 'agent' }],
      [
        { source: 'agent', target: 'fantome' },
        { source: 'inconnu', target: 'agent' },
      ],
    )
    // Une arête fantôme rendrait un graphe faux : elle ne passe pas.
    expect(g.edges).toEqual([])
    expect(g.droppedEdges).toBe(2)
  })

  it('marque les arêtes conditionnelles sans les inventer', () => {
    const g = toCanvasGraph(
      [
        { id: 'agent', label: 'agent' },
        { id: 'tools', label: 'tools' },
      ],
      [{ source: 'agent', target: 'tools', conditional: true }],
    )
    expect(g.edges[0].data.conditional).toBe(true)
    expect(g.edges[0].animated).toBe(true)
    expect(g.nodes.find((n) => n.id === 'agent')?.data.hasConditionalOut).toBe(true)
    expect(g.nodes.find((n) => n.id === 'tools')?.data.hasConditionalOut).toBe(false)
  })

  it('n’invente aucun type : absent reste null', () => {
    const g = toCanvasGraph([{ id: 'agent', label: 'agent' }], [])
    expect(g.nodes[0].data.nodeType).toBeNull()
  })

  it('retombe sur l’id quand le label est vide', () => {
    const g = toCanvasGraph([{ id: 'agent', label: '' }], [])
    expect(g.nodes[0].data.label).toBe('agent')
  })

  it('calcule des degrés dérivés exacts', () => {
    const g = toCanvasGraph(
      [
        { id: 'a', label: 'a' },
        { id: 'b', label: 'b' },
        { id: 'c', label: 'c' },
      ],
      [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
        { source: 'b', target: 'c' },
      ],
    )
    const node = (id: string) => g.nodes.find((n) => n.id === id)?.data
    expect(node('a')).toMatchObject({ inDegree: 0, outDegree: 2 })
    expect(node('c')).toMatchObject({ inDegree: 2, outDegree: 0 })
  })

  it('ne boucle pas à l’infini sur un graphe cyclique', () => {
    const g = toCanvasGraph(
      [
        { id: 'a', label: 'a' },
        { id: 'b', label: 'b' },
      ],
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    )
    // Un cycle pur n'a aucune racine : le mapping ne doit ni planter ni vider.
    expect(g.nodes).toHaveLength(2)
    expect(g.edges).toHaveLength(2)
  })

  it('place les nœuds injoignables SOUS le reste, sans les perdre', () => {
    const g = toCanvasGraph(
      [
        { id: '__start__', label: 'start' },
        { id: 'agent', label: 'agent' },
        { id: 'orphelin', label: 'orphelin' },
      ],
      [{ source: '__start__', target: 'agent' }],
    )
    const y = (id: string) => g.nodes.find((n) => n.id === id)?.position.y ?? -1
    expect(g.nodes).toHaveLength(3)
    expect(y('orphelin')).toBeGreaterThan(y('agent'))
  })

  it('distingue deux arêtes parallèles par des id uniques', () => {
    const g = toCanvasGraph(
      [
        { id: 'a', label: 'a' },
        { id: 'b', label: 'b' },
      ],
      [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'b', conditional: true },
      ],
    )
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(2)
  })

  it('est déterministe : même entrée, mêmes coordonnées', () => {
    const nodes = [
      { id: '__start__', label: 'start' },
      { id: 'agent', label: 'agent' },
    ]
    const edges = [{ source: '__start__', target: 'agent' }]
    expect(toCanvasGraph(nodes, edges)).toEqual(toCanvasGraph(nodes, edges))
  })

  it('marque les terminaux LangGraph', () => {
    const g = toCanvasGraph(
      [
        { id: '__start__', label: 'start' },
        { id: 'agent', label: 'agent' },
        { id: '__end__', label: 'end' },
      ],
      [],
    )
    expect(g.nodes.find((n) => n.id === '__start__')?.data.terminal).toBe(true)
    expect(g.nodes.find((n) => n.id === 'agent')?.data.terminal).toBe(false)
  })
})

/**
 * Régression — le nœud custom DOIT porter ses poignées.
 *
 * Sans `<Handle>`, React Flow refuse chaque arête et rend un graphe de nœuds
 * flottants : plausible à l'œil, structurellement faux. C'est arrivé sur cette
 * mission (168 avertissements console) pendant que typecheck, build et les 20
 * gates restaient VERTS — aucune gate ne mesure le rendu. Ce test lit la source
 * du composant : c'est grossier, mais c'est la seule barrière automatique
 * possible ici, et elle coûte moins cher qu'un second incident.
 */
describe('graph-canvas — poignées de connexion', () => {
  it('déclare une poignée source ET une poignée target', async () => {
    const { readFile } = await import('node:fs/promises')
    const src = await readFile(
      new URL('../../src/components/runtime/graph-canvas.tsx', import.meta.url),
      'utf8',
    )
    expect(src).toContain('type="target"')
    expect(src).toContain('type="source"')
  })
})
