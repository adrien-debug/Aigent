/**
 * Surface Projets — logique de PRÉSENTATION (`src/components/projects/model.ts`).
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *  1. Un projet SANS agent n'affiche pas « $0.00 · 0 runs ». Le data layer
 *     renvoie bien `0` là (c'est un zéro mesuré au sens de `sumMeasuredHealth`)
 *     mais à l'écran ce chiffre est ininterprétable : `measureOf` le qualifie
 *     `no-subject` pour que l'écran dise « aucun agent » au lieu de le peindre.
 *  2. Un projet PEUPLÉ dont personne n'a prouvé la mesure reste `not-measured`
 *     — jamais un zéro.
 *  3. Un vrai zéro mesuré reste un vrai zéro et s'affiche.
 *  4. L'arbre de dépôt est borné SANS perdre le compte de ce qu'il a écarté.
 *  5. La capacité de livraison reproduit exactement la composition de la route,
 *     verrou par verrou.
 */
import { describe, expect, it } from 'vitest'

import {
  buildProjectList,
  buildRepoTree,
  deriveDeliveryCapability,
  measureOf,
} from '@/components/projects/model'
import type { DeliveryEnv } from '@/components/projects/model'
import type { ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'

function item(over: Partial<ProjectOverviewItem> = {}): ProjectOverviewItem {
  return {
    id: 'p1',
    name: 'Projet',
    imageUrl: null,
    logoUrl: null,
    repoFullName: null,
    platform: 'web',
    copilotCount: 0,
    activeCount: 0,
    runsLast24h: 0,
    costLast24hUsd: 0,
    passRate: null,
    ...over,
  }
}

describe('measureOf — les trois états d’une mesure agrégée', () => {
  it('qualifie « no-subject » un projet SANS agent, même quand la valeur vaut 0', () => {
    // C'est le cas exact du défaut constaté : `sumMeasuredHealth([])` renvoie
    // `{ value: 0 }`, et l'aperçu le rend « $0.00 ». Ici on refuse de traiter
    // ce 0 comme une mesure affichable.
    expect(measureOf(0, 0)).toEqual({ state: 'no-subject', value: null })
  })

  it('ne fabrique aucune valeur pour un « no-subject », même sur une valeur non nulle', () => {
    expect(measureOf(42, 0).value).toBeNull()
  })

  it('qualifie « not-measured » un projet peuplé dont la mesure est null', () => {
    expect(measureOf(null, 3)).toEqual({ state: 'not-measured', value: null })
  })

  it('conserve un VRAI zéro mesuré sur une équipe qui existe', () => {
    // Des agents ont été lus et n'ont rien coûté : ce zéro est un fait, il
    // s'affiche.
    expect(measureOf(0, 2)).toEqual({ state: 'measured', value: 0 })
  })

  it('conserve une valeur mesurée non nulle', () => {
    expect(measureOf(18.42, 2)).toEqual({ state: 'measured', value: 18.42 })
  })
})

describe('buildProjectList', () => {
  it('applique la qualification aux DEUX mesures, runs et coût', () => {
    const [row] = buildProjectList([item({ copilotCount: 0, runsLast24h: 0, costLast24hUsd: 0 })])
    expect(row.runs.state).toBe('no-subject')
    expect(row.cost.state).toBe('no-subject')
  })

  it('distingue une équipe non mesurée d’une équipe absente', () => {
    const [peopled] = buildProjectList([
      item({ copilotCount: 4, runsLast24h: null, costLast24hUsd: null }),
    ])
    expect(peopled.runs.state).toBe('not-measured')
    expect(peopled.cost.state).toBe('not-measured')
  })

  it('ne coerce jamais passRate en 0', () => {
    const [row] = buildProjectList([item({ copilotCount: 2, passRate: null })])
    expect(row.passRate).toBeNull()
  })

  it('construit un deep link vers /projects/[id] et jamais un « # »', () => {
    const [row] = buildProjectList([item({ id: 'abc-123' })])
    expect(row.href).toBe('/projects/abc-123')
  })

  it('PRÉSERVE l’ordre amont — re-trier réintroduirait un « ?? 0 » dans la clé', () => {
    // `buildProjectOverview` trie déjà en faisant passer un `null` SOUS un zéro
    // mesuré. Un re-tri local avec `?? 0` remonterait le non-mesuré au niveau
    // du mesuré : exactement le faux zéro qu'on combat.
    const rows = buildProjectList([
      item({ id: 'a', name: 'A', copilotCount: 1, runsLast24h: null }),
      item({ id: 'b', name: 'B', copilotCount: 1, runsLast24h: 9 }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('buildRepoTree', () => {
  it('hiérarchise un arbre plat et met les dossiers avant les fichiers', () => {
    const { roots } = buildRepoTree([
      { path: 'README.md', type: 'blob' },
      { path: 'src', type: 'tree' },
      { path: 'src/index.ts', type: 'blob' },
    ])
    expect(roots.map((n) => n.name)).toEqual(['src', 'README.md'])
    expect(roots[0].children.map((n) => n.name)).toEqual(['index.ts'])
  })

  it('borne la profondeur et COMPTE ce qu’il écarte, au lieu de le taire', () => {
    const { roots, deeperEntries } = buildRepoTree(
      [
        { path: 'src', type: 'tree' },
        { path: 'src/lib', type: 'tree' },
        { path: 'src/lib/deep.ts', type: 'blob' },
        { path: 'src/lib/other/deeper.ts', type: 'blob' },
      ],
      2,
    )
    expect(deeperEntries).toBe(2)
    expect(roots[0].children.map((n) => n.name)).toEqual(['lib'])
  })

  it('remonte à la racine une entrée dont le parent manque, plutôt que de la perdre', () => {
    // Cas d'un arbre tronqué au milieu d'une branche par l'API GitHub.
    const { roots } = buildRepoTree([{ path: 'orphan/file.ts', type: 'blob' }], 2)
    expect(roots.map((n) => n.path)).toEqual(['orphan/file.ts'])
  })

  it('rend un arbre vide pour une lecture réussie sans entrée — sans inventer de nœud', () => {
    expect(buildRepoTree([])).toEqual({ roots: [], deeperEntries: 0 })
  })
})

describe('deriveDeliveryCapability', () => {
  const full = {
    AMC_DATA_SOURCE: 'gpu1',
    AMC_SUPABASE_URL: 'https://example.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    GITHUB_TOKEN: 't',
    GITHUB_PUSH_ENABLED: '1',
  } satisfies DeliveryEnv

  it('exige les trois verrous pour une livraison réelle', () => {
    expect(deriveDeliveryCapability(full).realDeliveryEnabled).toBe(true)
  })

  it('retombe à false dès qu’un seul verrou manque', () => {
    for (const key of Object.keys(full)) {
      const partial = { ...full, [key]: undefined }
      expect(deriveDeliveryCapability(partial).realDeliveryEnabled).toBe(false)
    }
  })

  it('ne considère PAS armé un GITHUB_PUSH_ENABLED qui vaut autre chose que « 1 »', () => {
    expect(deriveDeliveryCapability({ ...full, GITHUB_PUSH_ENABLED: 'true' }).pushArmed).toBe(false)
  })

  it('exige AMC_DATA_SOURCE=gpu1 exactement', () => {
    expect(
      deriveDeliveryCapability({ ...full, AMC_DATA_SOURCE: 'local' }).backendConfigured,
    ).toBe(false)
  })

  it('rapporte chaque verrou séparément, sans jamais exposer de valeur de secret', () => {
    const capability = deriveDeliveryCapability({ ...full, GITHUB_TOKEN: undefined })
    expect(capability.backendConfigured).toBe(true)
    expect(capability.githubConfigured).toBe(false)
    expect(Object.values(capability).every((v) => typeof v === 'boolean')).toBe(true)
  })
})
