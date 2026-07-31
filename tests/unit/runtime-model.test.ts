/**
 * Surface Runtime — les invariants dont elle est FAITE, tenus par des tests.
 *
 * Cette surface n'existe que pour ne pas mentir sur ce qui est câblé. Ses
 * règles sont donc toutes de la même famille : ne jamais confondre « c'est
 * faux », « ça ne s'applique pas » et « je n'ai pas pu lire ». Chacune de ces
 * confusions compile, passe toutes les gates, et transforme une lecture
 * échouée en accusation contre un composant sain.
 *
 * DEUX RÉGIMES DE TEST, ET POURQUOI ILS DIFFÈRENT
 * -----------------------------------------------
 * · `model.ts` est pur et isomorphe : `provisioningState` et
 *   `resolveRuntimeTab` sont importés et testés DIRECTEMENT. Ces tests ont
 *   pleine valeur de preuve — ils rougissent si l'implémentation change.
 *
 * · `crossReference` (tab-langgraph.tsx), `provenanceOf` (tab-telemetry.tsx) et
 *   `readabilityOf` (tab-repositories.tsx) ne sont PAS exportés, et leurs
 *   modules ne sont de toute façon pas importables dans cette suite : la chaîne
 *   d'imports transitive (`@/components/ui/badge` → `@headlessui/react` →
 *   `react` en CommonJS) casse sous les conditions `react-server` de
 *   `vitest.config.ts`. Les exporter ne suffirait donc pas.
 *   Pour ces trois-là, le test est en DEUX PIÈCES, et c'est la seconde qui
 *   porte la preuve :
 *     1. un miroir local de la règle, testé sur ses cas limites — il documente
 *        le comportement attendu et vérifie que la règle telle qu'énoncée fait
 *        bien ce qu'on croit ;
 *     2. une GARDE STRUCTURELLE qui lit le fichier source réel et exige que le
 *        garde y soit littéralement présent. C'est elle qui rougit si
 *        quelqu'un supprime `serverAssistantIds === null`, `=== false`,
 *        `startsWith('aigent-internal')` ou `visible === null`.
 *   Un miroir seul serait tautologique. Le miroir + la garde ne l'est pas :
 *   ensemble ils échouent sur du code cassé.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RUNTIME_TAB,
  PROVISIONING_LABEL,
  RUNTIME_TABS,
  provisioningState,
  resolveRuntimeTab,
  runtimeTabHref,
} from '@/components/runtime/model'

const SRC = path.resolve(__dirname, '../../src/components/runtime')
const readSource = (file: string) => readFileSync(path.join(SRC, file), 'utf8')

/* ═════════════════ 1. provisioningState — le `=== false` strict ═════════════ */

/**
 * L'invariant le plus conséquent de la surface.
 *
 * `runtimeProvisioned` est TERNAIRE dans le contrat canonique
 * (`available-agents.ts`) et ses trois valeurs veulent dire trois choses
 * différentes :
 *   · `true`  → runtime langgraph ET assistant_id persisté ;
 *   · `false` → runtime langgraph ET assistant_id vide — LE piège du graphe nu,
 *               le seul défaut qu'aucune gate ne détecte ;
 *   · `null`  → soit le runtime n'est pas langgraph (rien n'y provisionne
 *               d'assistant : une absence n'est PAS un défaut), soit la colonne
 *               n'a pas été lue du tout.
 *
 * Un refactor en `!runtimeProvisioned` compile, passe typecheck, lint et build
 * — et signale « graphe nu » sur TOUS les agents sains non-LangGraph. C'est
 * exactement ce que ces tests interdisent.
 */
describe('provisioningState — trois états, jamais deux', () => {
  it('false + langgraph → graphe nu (le piège que rien d’autre ne voit)', () => {
    expect(provisioningState(false)).toBe('bare-graph')
  })

  it('true → provisionné', () => {
    expect(provisioningState(true)).toBe('provisioned')
  })

  it('null (runtime ≠ langgraph, non applicable) → PAS graphe nu', () => {
    // Le cas que `!runtimeProvisioned` casserait silencieusement.
    expect(provisioningState(null)).toBe('not-applicable')
    expect(provisioningState(null)).not.toBe('bare-graph')
  })

  it('null (colonne non lue) → PAS graphe nu non plus', () => {
    // Même valeur, autre raison : une lecture absente ne devient pas un défaut.
    // `available-agents.ts` produit `null` dans les deux cas, et l'écran doit
    // les rendre identiquement inoffensifs.
    const columnNotRead: boolean | null = null
    expect(provisioningState(columnNotRead)).toBe('not-applicable')
    expect(provisioningState(columnNotRead)).not.toBe('bare-graph')
  })

  it('les trois états sont deux à deux distincts', () => {
    const states = [
      provisioningState(true),
      provisioningState(false),
      provisioningState(null),
    ]
    expect(new Set(states).size).toBe(3)
  })

  it('seul `false` produit le libellé alarmant « graphe nu »', () => {
    // Le libellé est la charge utile : c'est lui qui accuse. On vérifie qu'il
    // n'atteint que le cas mesuré, jamais les deux absences.
    const alarming = PROVISIONING_LABEL['bare-graph']
    expect(PROVISIONING_LABEL[provisioningState(false)]).toBe(alarming)
    expect(PROVISIONING_LABEL[provisioningState(null)]).not.toBe(alarming)
    expect(PROVISIONING_LABEL[provisioningState(true)]).not.toBe(alarming)
  })

  it('aucune valeur falsy autre que `false` n’est traitée comme graphe nu', () => {
    // Garde anti-`!truthy` : si l'implémentation passait à `!runtimeProvisioned`,
    // `null` basculerait ici et ce test rougirait.
    const falsyButNotFalse: (boolean | null)[] = [null]
    for (const value of falsyButNotFalse) {
      expect(provisioningState(value)).not.toBe('bare-graph')
    }
  })
})

/* ═════════ 2. crossReference — le garde `serverAssistantIds === null` ═══════ */

/**
 * Si la liste des assistants du serveur n'a pas pu être lue, la question
 * « quels assistants sont périmés ? » n'a PAS de réponse. Elle doit valoir
 * `null` — pas une liste vide (« aucun périmé », rassurant à tort), et surtout
 * pas la liste complète (« tous périmés », une accusation fabriquée à partir
 * d'une panne de notre côté).
 *
 * Miroir fidèle de `crossReference` (tab-langgraph.tsx). Voir l'en-tête du
 * fichier : la garde structurelle plus bas est ce qui rend ce bloc probant.
 */
type MirrorAgent = {
  runtime: string | null
  runtimeProvisioned: boolean | null
  assistantId: string | null
}

function crossReferenceMirror(agents: MirrorAgent[], serverAssistantIds: Set<string> | null) {
  const langgraph = agents.filter((a) => a.runtime === 'langgraph')
  const bareGraph = langgraph.filter((a) => a.runtimeProvisioned === false)
  const provisioned = langgraph.filter((a) => a.runtimeProvisioned === true)
  const staleAssistant =
    serverAssistantIds === null
      ? null
      : provisioned.filter((a) => a.assistantId !== null && !serverAssistantIds.has(a.assistantId))
  return { langgraph, bareGraph, provisioned, staleAssistant }
}

const agent = (over: Partial<MirrorAgent> = {}): MirrorAgent => ({
  runtime: 'langgraph',
  runtimeProvisioned: true,
  assistantId: 'asst-live',
  ...over,
})

describe('crossReference — une lecture échouée n’accuse personne', () => {
  it('serverAssistantIds null → staleAssistant null, PAS une liste vide', () => {
    const agents = [agent({ assistantId: 'asst-a' }), agent({ assistantId: 'asst-b' })]
    const { staleAssistant } = crossReferenceMirror(agents, null)

    expect(staleAssistant).toBeNull()
    // La distinction qui compte : `null` (question ouverte) ≠ `[]` (réponse
    // « aucun périmé »). Les deux sont falsy, un seul est honnête.
    expect(staleAssistant).not.toEqual([])
  })

  it('serverAssistantIds null → surtout PAS « tous périmés »', () => {
    const agents = [agent({ assistantId: 'asst-a' }), agent({ assistantId: 'asst-b' })]
    const { staleAssistant, provisioned } = crossReferenceMirror(agents, null)

    expect(provisioned).toHaveLength(2)
    expect(staleAssistant).toBeNull()
    // Le pire refactor possible serait de compter tout le monde comme périmé
    // parce que rien n'a été trouvé dans un Set absent. On l'exprime sans
    // `toHaveLength`, qui lève sur `null` au lieu de passer.
    expect(Array.isArray(staleAssistant)).toBe(false)
  })

  it('liste lue → le croisement se fait réellement', () => {
    const agents = [
      agent({ assistantId: 'asst-live' }),
      agent({ assistantId: 'asst-gone' }),
    ]
    const { staleAssistant } = crossReferenceMirror(agents, new Set(['asst-live']))

    expect(staleAssistant).not.toBeNull()
    expect(staleAssistant?.map((a) => a.assistantId)).toEqual(['asst-gone'])
  })

  it('liste lue et vide → tous les provisionnés sont périmés (fait mesuré)', () => {
    // `langgraphjs dev` garde ses assistants en RAM : un redémarrage les efface
    // pendant que la base conserve son assistant_id. Une liste VIDE et LUE est
    // une information réelle — c'est le cas que le garde ne doit pas absorber.
    const agents = [agent({ assistantId: 'asst-a' })]
    const { staleAssistant } = crossReferenceMirror(agents, new Set())

    expect(staleAssistant).toHaveLength(1)
  })

  it('bareGraph ignore les agents non-LangGraph et les null', () => {
    const agents = [
      agent({ runtime: 'langgraph', runtimeProvisioned: false, assistantId: null }),
      agent({ runtime: 'openai-assistants', runtimeProvisioned: null, assistantId: null }),
      agent({ runtime: null, runtimeProvisioned: null, assistantId: null }),
    ]
    const { langgraph, bareGraph } = crossReferenceMirror(agents, new Set())

    expect(langgraph).toHaveLength(1)
    expect(bareGraph).toHaveLength(1)
  })

  it('un provisionné sans assistantId n’est jamais compté comme périmé', () => {
    const agents = [agent({ runtimeProvisioned: true, assistantId: null })]
    const { staleAssistant } = crossReferenceMirror(agents, new Set(['other']))

    expect(staleAssistant).toEqual([])
  })

  /**
   * LA GARDE QUI PORTE LA PREUVE.
   * Le miroir ci-dessus ne prouverait rien seul. Ces assertions lisent le
   * fichier source réel et échouent si le garde `=== null` ou le strict
   * `=== false` en disparaît.
   */
  it('GARDE SOURCE — tab-langgraph.tsx conserve `serverAssistantIds === null` et `=== false`', () => {
    const source = readSource('tab-langgraph.tsx')

    expect(source).toContain('serverAssistantIds === null')
    expect(source).toContain('a.runtimeProvisioned === false')
    // Un `!a.runtimeProvisioned` absorberait le `null` non applicable.
    expect(source).not.toContain('!a.runtimeProvisioned')
    // Un `!serverAssistantIds` NU (le null-check truthy) traiterait un Set vide
    // comme une lecture échouée. `!serverAssistantIds.has(...)` est en revanche
    // légitime — c'est la négation du résultat de `.has`, pas du Set lui-même.
    expect(source).not.toMatch(/!serverAssistantIds(?!\.)/)
  })
})

/* ═══════════════════ 3. resolveRuntimeTab — jamais la valeur brute ══════════ */

describe('resolveRuntimeTab — un ?tab= arbitraire ne traverse pas', () => {
  it('chaque id d’onglet connu est retourné tel quel', () => {
    for (const tab of RUNTIME_TABS) {
      expect(resolveRuntimeTab(tab.id)).toBe(tab.id)
    }
  })

  it('une valeur inconnue retombe sur le défaut', () => {
    expect(resolveRuntimeTab('does-not-exist')).toBe(DEFAULT_RUNTIME_TAB)
  })

  it('undefined et chaîne vide retombent sur le défaut', () => {
    expect(resolveRuntimeTab(undefined)).toBe(DEFAULT_RUNTIME_TAB)
    expect(resolveRuntimeTab('')).toBe(DEFAULT_RUNTIME_TAB)
  })

  it('une valeur hostile n’est JAMAIS reflétée', () => {
    // Le point n'est pas le XSS (React échappe), c'est le contrat : la valeur
    // retenue appartient toujours à l'union, elle n'est jamais la chaîne brute.
    const hostile = '<img src=x onerror=alert(1)>'
    const resolved = resolveRuntimeTab(hostile)

    expect(resolved).toBe(DEFAULT_RUNTIME_TAB)
    expect(resolved).not.toBe(hostile)
  })

  it('la sortie est TOUJOURS un membre de l’union, quelle que soit l’entrée', () => {
    const ids = new Set<string>(RUNTIME_TABS.map((t) => t.id))
    const inputs: (string | string[] | undefined)[] = [
      undefined,
      '',
      'telemetry',
      'TELEMETRY', // la casse compte : ce n'est pas un id valide
      'langgraph ',
      '__proto__',
      'constructor',
      'toString',
      ['repositories', 'tools'],
      [],
      ['nope'],
    ]

    for (const input of inputs) {
      expect(ids.has(resolveRuntimeTab(input))).toBe(true)
    }
  })

  it('un tableau (?tab=a&tab=b) ne retient que la première valeur', () => {
    expect(resolveRuntimeTab(['repositories', 'tools'])).toBe('repositories')
    expect(resolveRuntimeTab(['nope', 'tools'])).toBe(DEFAULT_RUNTIME_TAB)
    expect(resolveRuntimeTab([])).toBe(DEFAULT_RUNTIME_TAB)
  })

  it('une clé de prototype ne devient jamais un onglet', () => {
    // `RUNTIME_TABS.find` est immunisé, mais un refactor vers un objet indexé
    // ne le serait pas — ce test le rattraperait.
    expect(resolveRuntimeTab('__proto__')).toBe(DEFAULT_RUNTIME_TAB)
    expect(resolveRuntimeTab('constructor')).toBe(DEFAULT_RUNTIME_TAB)
  })

  it('le href du défaut reste l’URL nue, les autres portent le paramètre', () => {
    expect(runtimeTabHref(DEFAULT_RUNTIME_TAB)).toBe('/runtime')
    expect(runtimeTabHref('langgraph')).toBe('/runtime?tab=langgraph')
  })

  it('href → resolve est un aller-retour fidèle pour tous les onglets', () => {
    for (const tab of RUNTIME_TABS) {
      const href = runtimeTabHref(tab.id)
      const raw = href.includes('?tab=') ? href.split('?tab=')[1] : undefined
      expect(resolveRuntimeTab(raw)).toBe(tab.id)
    }
  })
})

/* ════════════ 4. provenanceOf — un non-étiqueté n’est pas un consommateur ═══ */

/**
 * Le canal de télémétrie est UNIQUE pour deux sources : les agents déployés
 * chez un consommateur, et les runs internes d'Aigent. Le chiffre qui compte
 * — la boucle de retour produit — est le compte consommateur, et il peut être
 * à zéro pendant que le canal a l'air actif.
 *
 * D'où l'invariant : ce qui n'est pas identifiable tombe dans une TROISIÈME
 * catégorie. L'attribuer par défaut au consommateur gonflerait précisément le
 * chiffre qu'on regarde.
 */
type MirrorEvent = { environment?: { source?: unknown } | null }

function provenanceOfMirror(event: MirrorEvent): 'internal' | 'consumer' | 'unlabelled' {
  const source = event.environment?.source
  if (typeof source !== 'string') return 'unlabelled'
  if (source.startsWith('aigent-internal')) return 'internal'
  return 'consumer'
}

describe('provenanceOf — trois voies, le doute n’est jamais du consommateur', () => {
  it('`aigent-internal` exact → interne', () => {
    expect(provenanceOfMirror({ environment: { source: 'aigent-internal' } })).toBe('internal')
  })

  it('un préfixe `aigent-internal…` → interne (startsWith, pas égalité)', () => {
    expect(provenanceOfMirror({ environment: { source: 'aigent-internal-runner' } })).toBe('internal')
    expect(provenanceOfMirror({ environment: { source: 'aigent-internal/bench' } })).toBe('internal')
  })

  it('une source tierce → consommateur', () => {
    expect(provenanceOfMirror({ environment: { source: 'dropship-prod' } })).toBe('consumer')
  })

  it('LE CAS CRITIQUE — environment absent n’est JAMAIS un consommateur', () => {
    expect(provenanceOfMirror({})).toBe('unlabelled')
    expect(provenanceOfMirror({})).not.toBe('consumer')
  })

  it('LE CAS CRITIQUE — environment null / source absente ne sont pas des consommateurs', () => {
    expect(provenanceOfMirror({ environment: null })).toBe('unlabelled')
    expect(provenanceOfMirror({ environment: {} })).toBe('unlabelled')
    expect(provenanceOfMirror({ environment: { source: undefined } })).toBe('unlabelled')

    for (const event of [{}, { environment: null }, { environment: {} }]) {
      expect(provenanceOfMirror(event)).not.toBe('consumer')
    }
  })

  it('une source non-chaîne (nombre, objet, booléen) reste non étiquetée', () => {
    // Le `typeof source !== 'string'` protège aussi du `.startsWith` qui
    // lèverait — mais le point produit est l'attribution, pas le crash.
    const hostile: unknown[] = [42, true, {}, [], { source: 'nested' }]
    for (const source of hostile) {
      expect(provenanceOfMirror({ environment: { source } })).toBe('unlabelled')
    }
  })

  it('une chaîne vide est une source tierce, pas une absence', () => {
    // `''` est étiqueté (typeof string) mais ne commence pas par le préfixe
    // interne. Le comportement réel est « consumer ». On le documente plutôt
    // que de le supposer.
    expect(provenanceOfMirror({ environment: { source: '' } })).toBe('consumer')
  })

  it('`aigent-internal` au MILIEU de la chaîne n’est pas interne', () => {
    // startsWith, pas includes : un consommateur nommé « x-aigent-internal »
    // ne doit pas être reclassé en interne.
    expect(provenanceOfMirror({ environment: { source: 'x-aigent-internal' } })).toBe('consumer')
  })

  it('les trois voies sont exhaustives et disjointes', () => {
    const samples: MirrorEvent[] = [
      { environment: { source: 'aigent-internal' } },
      { environment: { source: 'consumer-x' } },
      {},
    ]
    const seen = samples.map(provenanceOfMirror)
    expect(new Set(seen)).toEqual(new Set(['internal', 'consumer', 'unlabelled']))
  })

  it('GARDE SOURCE — tab-telemetry.tsx conserve startsWith + la voie non étiquetée', () => {
    const source = readSource('tab-telemetry.tsx')

    expect(source).toContain("startsWith('aigent-internal')")
    expect(source).toContain("typeof source !== 'string'")
    expect(source).toContain("return 'unlabelled'")
    // `includes` reclasserait un consommateur en interne.
    expect(source).not.toContain("includes('aigent-internal')")
  })
})

/* ════════════ 5. readabilityOf — `unknown` n’est pas `unreadable` ═══════════ */

/**
 * Si la liste des dépôts visibles n'a pas pu être lue, aucune conclusion n'est
 * possible sur AUCUN dépôt. Les marquer tous « non lisible » transformerait une
 * panne du côté Aigent en accusation portée sur des dépôts consommateurs sains.
 */
type MirrorReadability = 'readable' | 'unreadable' | 'unknown'

function readabilityOfMirror(repoFullName: string, visible: Set<string> | null): MirrorReadability {
  if (visible === null) return 'unknown'
  return visible.has(repoFullName) ? 'readable' : 'unreadable'
}

describe('readabilityOf — trois états, unknown ≠ unreadable', () => {
  it('visible null → unknown, jamais unreadable', () => {
    expect(readabilityOfMirror('org/repo', null)).toBe('unknown')
    expect(readabilityOfMirror('org/repo', null)).not.toBe('unreadable')
  })

  it('visible null → unknown pour TOUT dépôt, même absurde', () => {
    // Aucune conclusion n'est possible : le nom du dépôt n'entre même pas dans
    // la décision quand la liste est absente.
    for (const name of ['org/repo', 'inexistant/xyz', '']) {
      expect(readabilityOfMirror(name, null)).toBe('unknown')
    }
  })

  it('présent dans la liste lue → readable', () => {
    expect(readabilityOfMirror('org/repo', new Set(['org/repo']))).toBe('readable')
  })

  it('absent d’une liste LUE → unreadable (fait mesuré, pas une supposition)', () => {
    expect(readabilityOfMirror('org/repo', new Set(['org/autre']))).toBe('unreadable')
  })

  it('liste lue et VIDE → unreadable, et surtout pas unknown', () => {
    // La distinction symétrique de l'invariant 2 : un Set vide est une lecture
    // RÉUSSIE qui n'a rien trouvé. Elle autorise une conclusion ; `null` non.
    expect(readabilityOfMirror('org/repo', new Set())).toBe('unreadable')
    expect(readabilityOfMirror('org/repo', new Set())).not.toBe('unknown')
  })

  it('la comparaison est exacte — pas de correspondance partielle sur le nom', () => {
    const visible = new Set(['org/repo'])
    expect(readabilityOfMirror('org/repo-2', visible)).toBe('unreadable')
    expect(readabilityOfMirror('ORG/REPO', visible)).toBe('unreadable')
  })

  it('les trois états sont atteignables et distincts', () => {
    const states = [
      readabilityOfMirror('org/repo', new Set(['org/repo'])),
      readabilityOfMirror('org/repo', new Set()),
      readabilityOfMirror('org/repo', null),
    ]
    expect(new Set(states).size).toBe(3)
  })

  it('GARDE SOURCE — tab-repositories.tsx conserve le garde `visible === null`', () => {
    const source = readSource('tab-repositories.tsx')

    expect(source).toContain('visible === null')
    expect(source).toContain("return 'unknown'")
    // `!visible` NU traiterait un Set vide (lecture réussie) comme une panne.
    // `!visible.has(...)` resterait légitime, d'où la négation lookahead.
    expect(source).not.toMatch(/!visible(?!\.)/)
  })
})
