/**
 * Logique de PRÉSENTATION de la surface Projets — pure, testable, sans I/O.
 *
 * Ce module ne lit rien et n'importe aucun module `server-only` : il transforme
 * ce que les agrégateurs existants ont déjà renvoyé en ce que l'écran doit
 * dire. Il vit sous `src/components/projects/` parce qu'il n'appartient qu'à
 * cette surface — le mettre dans `src/lib/` en ferait un module partagé que
 * d'autres PR devraient respecter, alors que rien d'autre ne le consomme.
 *
 * LA SEULE RÈGLE QU'IL TIENT
 * --------------------------
 * `null` n'est pas `0`, et « je n'ai pas pu lire » n'est pas « il n'y a rien ».
 * Le data layer d'Aigent est déjà rigoureux là-dessus (`sumMeasuredHealth`
 * renvoie `null` quand une équipe existe sans qu'aucun membre n'ait prouvé la
 * mesure). Le rôle de ce module est de NE PAS reperdre cette distinction au
 * moment de l'affichage, et surtout d'ajouter celle que le type ne porte pas :
 * un `0` mesuré sur une équipe VIDE ne dit pas la même chose qu'un `0` mesuré
 * sur une équipe qui a réellement tourné à coût nul.
 */
import type { ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'

/**
 * Ce qu'une mesure agrégée de projet dit RÉELLEMENT — trois états, jamais deux.
 *
 * `ProjectOverviewItem.costLast24hUsd` est un `number | null` qui recouvre
 * TROIS situations que l'écran doit distinguer, et que le seul type ne permet
 * pas de séparer :
 *
 *  · `measured`     — la valeur a été prouvée par au moins un membre de
 *                     l'équipe. Un `0` ici est un vrai zéro : des agents ont
 *                     été lus et n'ont rien coûté. On affiche le chiffre.
 *  · `not-measured` — l'équipe existe, aucun membre n'a prouvé la métrique.
 *                     `sumMeasuredHealth` renvoie `null`. On affiche
 *                     UNAVAILABLE_LABEL, jamais « $0.00 ».
 *  · `no-subject`   — il n'y a AUCUN agent sur le projet. `sumMeasuredHealth`
 *                     renvoie alors `{ value: 0 }` et le contrat le documente
 *                     comme un zéro mesuré — ce qui est défendable (pas
 *                     d'agent, pas de run, pas de coût) mais reste trompeur à
 *                     l'écran : « $0.00 · 0 runs » se lit comme un projet qu'on
 *                     a mesuré et qui dort, pas comme un projet qui n'a
 *                     personne. On l'affiche donc comme ce qu'il est —
 *                     « aucun agent » — au lieu de le peindre en chiffres.
 *
 * C'est la nuance que l'aperçu ne fait pas : `rows.tsx:ProjectRow` rend
 * `formatUsd(0)` → « $0.00 » et « 0 runs » pour un projet sans le moindre
 * copilote. Le chiffre n'est pas FAUX au sens du data layer, il est
 * ININTERPRÉTABLE à l'écran. Cette surface ne le reproduit pas.
 */
export type MeasureState = 'measured' | 'not-measured' | 'no-subject'

export interface ProjectMeasure {
  state: MeasureState
  /** Renseigné UNIQUEMENT quand `state === 'measured'`. Sinon `null`. */
  value: number | null
}

/**
 * L'état d'une mesure agrégée de projet, à partir de la valeur ET de la taille
 * de l'équipe qui l'a (ou non) produite.
 *
 * `copilotCount` est structurel : c'est un vrai décompte de lignes, jamais une
 * estimation. C'est lui qui autorise à distinguer `no-subject` de `measured`,
 * puisque `sumMeasuredHealth` collapse les deux vers `0`.
 */
export function measureOf(value: number | null, copilotCount: number): ProjectMeasure {
  if (copilotCount === 0) return { state: 'no-subject', value: null }
  if (value === null) return { state: 'not-measured', value: null }
  return { state: 'measured', value }
}

/** La ligne de liste, telle que l'écran la consomme — mesures déjà qualifiées. */
export interface ProjectListItem {
  id: string
  name: string
  href: string
  repoFullName: string | null
  platform: ProjectOverviewItem['platform']
  copilotCount: number
  activeCount: number
  runs: ProjectMeasure
  cost: ProjectMeasure
  /** Taux de réussite moyen 0..1. `null` = aucune évidence, jamais 0. */
  passRate: number | null
}

/**
 * `ProjectOverviewItem[]` → lignes d'écran.
 *
 * L'ORDRE VIENT DE L'AMONT et n'est pas retouché : `buildProjectOverview` trie
 * déjà (signal d'abord, puis nombre de runs décroissant, puis nom), et son tri
 * fait passer un `null` SOUS un zéro mesuré via `runsOrderKey` — exactement la
 * sémantique voulue. Re-trier ici avec un `?? 0` réintroduirait le faux zéro
 * dans la clé de tri, ce que fait `overview-screen.tsx:60` sur l'aperçu.
 */
export function buildProjectList(items: readonly ProjectOverviewItem[]): ProjectListItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    href: `/projects/${item.id}`,
    repoFullName: item.repoFullName,
    platform: item.platform,
    copilotCount: item.copilotCount,
    activeCount: item.activeCount,
    runs: measureOf(item.runsLast24h, item.copilotCount),
    cost: measureOf(item.costLast24hUsd, item.copilotCount),
    passRate: item.passRate,
  }))
}

/* ─────────────────────────── Repository lié ─────────────────────────── */

/**
 * L'état de lecture d'un dépôt lié — quatre situations, jamais confondues.
 *
 * `github.ts` fait bien son travail sur le chemin de LECTURE : `getRepoTree`
 * LÈVE quand l'API est injoignable, quand le jeton manque ou quand le dépôt est
 * inaccessible. Il ne renvoie jamais `[]` en silence (les `catch { return [] }`
 * de `github.ts:1382` et `consumer-bootstrap.ts:209` sont sur le chemin
 * d'écriture / dans du code GÉNÉRÉ pour le dépôt consommateur, pas ici).
 *
 * Cette surface peut donc réellement distinguer « vide » de « illisible », à
 * une réserve près, portée par `truncated` ci-dessous.
 */
export type RepoReadState =
  /** Aucun dépôt n'est rattaché au projet — il n'y a rien à lire. */
  | 'unlinked'
  /** Lecture réussie. L'arbre est la vérité. */
  | 'read'
  /** La lecture a ÉCHOUÉ. L'arbre est inconnu — surtout pas vide. */
  | 'unreadable'

export interface RepoTreeNode {
  name: string
  path: string
  type: 'blob' | 'tree'
  children: RepoTreeNode[]
}

/**
 * Arbre plat GitHub → arbre hiérarchique borné.
 *
 * `getRepoTree` renvoie une liste PLATE de chemins (`src/lib/foo.ts`), blobs et
 * trees mélangés. L'écran veut une hiérarchie.
 *
 * BORNAGE : un dépôt réel dépasse largement ce qu'une box de hauteur fixe peut
 * montrer, et l'API GitHub tronque elle-même les très gros arbres. On ne garde
 * donc que les `maxDepth` premiers niveaux — une carte de la structure, pas un
 * explorateur de fichiers. Le nombre d'entrées écartées est rendu à l'appelant
 * pour qu'il le DISE, au lieu de laisser croire que le dépôt s'arrête là.
 */
export function buildRepoTree(
  entries: readonly { path: string; type: 'blob' | 'tree' }[],
  maxDepth = 2,
): { roots: RepoTreeNode[]; deeperEntries: number } {
  const roots: RepoTreeNode[] = []
  const byPath = new Map<string, RepoTreeNode>()
  let deeperEntries = 0

  // Tri par chemin : un parent précède toujours ses enfants, ce qui rend
  // l'insertion en un seul passage possible sans créer de dossier fantôme.
  // `toSorted` : l'entrée est `readonly`, on ne mute pas ce qu'on nous prête.
  const sorted = entries.toSorted((a, b) => a.path.localeCompare(b.path))

  for (const entry of sorted) {
    const segments = entry.path.split('/')
    if (segments.length > maxDepth) {
      deeperEntries += 1
      continue
    }

    const name = segments.at(-1)
    // Un segment vide (chemin malformé) n'a pas de nom affichable : on l'ignore
    // plutôt que de rendre une ligne sans libellé.
    if (!name) continue

    const node: RepoTreeNode = { name, path: entry.path, type: entry.type, children: [] }
    byPath.set(entry.path, node)

    if (segments.length === 1) {
      roots.push(node)
      continue
    }

    const parentPath = segments.slice(0, -1).join('/')
    const parent = byPath.get(parentPath)
    // Parent absent de la réponse (arbre tronqué par GitHub au milieu d'une
    // branche) : on remonte l'entrée à la racine plutôt que de la perdre.
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  orderTree(roots)

  return { roots, deeperEntries }
}

/**
 * Dossiers avant fichiers, puis alphabétique — la lecture habituelle d'un arbre
 * de sources. Trie EN PLACE des nœuds que `buildRepoTree` vient de construire
 * lui-même : rien d'emprunté à l'appelant n'est muté ici.
 */
function orderTree(nodes: RepoTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const node of nodes) orderTree(node.children)
}

/* ──────────────────────── Capacité de livraison ──────────────────────── */

/**
 * Les trois préconditions d'une livraison RÉELLE, dites séparément.
 *
 * La route `/api/agent-ops/delivery-capability` ne renvoie qu'UN booléen, et
 * volontairement : sa réponse traverse le réseau, et détailler quel secret
 * manque renseignerait un appelant sur la configuration du serveur.
 *
 * Ici on est en Server Component : rien ne traverse le réseau, l'opérateur est
 * déjà authentifié par `src/proxy.ts` pour atteindre cet écran, et un booléen
 * unique lui laisserait deviner LEQUEL des trois verrous manque. On lit donc
 * les trois séparément — sans jamais afficher une VALEUR de secret, seulement
 * sa présence.
 *
 * Aucune de ces lectures ne déclenche quoi que ce soit : `pushArmed` DÉCRIT
 * l'état de `GITHUB_PUSH_ENABLED`, il ne l'active pas. Cette surface est en
 * lecture seule et n'appelle aucune écriture GitHub, même en dry-run.
 */
export interface DeliveryCapability {
  backendConfigured: boolean
  githubConfigured: boolean
  /** `GITHUB_PUSH_ENABLED=1`. Second des deux verrous ; l'autre est `confirm:true`. */
  pushArmed: boolean
  /** Les trois réunis. C'est le booléen que la route publie. */
  realDeliveryEnabled: boolean
}

/**
 * Le sac de variables d'environnement que cette dérivation lit.
 *
 * Un simple index de chaînes optionnelles plutôt que `NodeJS.ProcessEnv` : le
 * `ProcessEnv` de ce projet est un type FERMÉ (il déclare `NODE_ENV` comme
 * obligatoire et n'a pas de signature d'index utilisable), donc un test devrait
 * reconstruire tout l'environnement pour fournir cinq clés. `process.env` est
 * assignable à ce type ; l'inverse ne l'est pas, ce qui est le bon sens de la
 * dépendance.
 *
 * Les cinq clés réellement consultées sont nommées dans le corps de la
 * fonction et nulle part ailleurs — aucune VALEUR de secret n'est retournée,
 * seulement des booléens de présence.
 */
export type DeliveryEnv = Readonly<Record<string, string | undefined>>

/**
 * Dérive la capacité depuis un sac de variables d'environnement.
 *
 * Le paramètre est injecté plutôt que lu depuis `process.env` pour que la règle
 * soit testable sans muter l'environnement du process de test. La composition
 * reproduit exactement celle de `delivery-capability/route.ts:41-51` — si l'une
 * des deux dérive, les deux surfaces se contrediraient sur le même fait.
 */
export function deriveDeliveryCapability(env: DeliveryEnv): DeliveryCapability {
  const backendConfigured =
    env.AMC_DATA_SOURCE === 'gpu1' &&
    Boolean(env.AMC_SUPABASE_URL) &&
    Boolean(env.SUPABASE_SERVICE_ROLE_KEY)
  const githubConfigured = Boolean(env.GITHUB_TOKEN)
  const pushArmed = env.GITHUB_PUSH_ENABLED === '1'

  return {
    backendConfigured,
    githubConfigured,
    pushArmed,
    realDeliveryEnabled: backendConfigured && githubConfigured && pushArmed,
  }
}
