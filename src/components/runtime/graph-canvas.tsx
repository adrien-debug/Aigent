'use client'

/**
 * Canvas LangGraph — représentation visuelle de la topologie RÉELLE du graphe.
 *
 * XYFlow REPRÉSENTE LangGraph, il ne le remplace pas. Ce composant ne crée pas
 * de nœud, n'en supprime aucun, ne relie rien et n'écrit jamais vers l'Agent
 * Server : il n'existe ici aucun chemin de mutation du manifeste.
 *
 * LA DISPOSITION EST PERSISTÉE, LE GRAPHE NE L'EST PAS. Déplacer un nœud écrit
 * des COORDONNÉES dans un stockage client cloisonné par `graphId`
 * (`graph-layout-store`) — jamais dans le manifeste, qui reste la propriété de
 * l'Agent Server. Au montage, le graphe part de la disposition CALCULÉE, puis
 * adopte celle qui a été stockée ; « Réinitialiser » efface le stockage et rend
 * le calcul déterministe. Les deux ne peuvent donc jamais diverger.
 *
 * ÎLOT CLIENT. XYFlow mesure le DOM : il ne peut pas être un Server Component.
 * La frontière ne reçoit que des données sérialisables — jamais une fonction
 * (`check:rsc-boundary`). Tous les handlers vivent ici.
 *
 * BOÎTE BORNÉE. La hauteur est fixée par le parent et ne grandit pas avec le
 * graphe : un graphe de 200 nœuds ne pousse pas la page, il se navigue au zoom
 * dans une boîte de taille constante. Zéro overflow horizontal global.
 */
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import '@xyflow/react/dist/style.css'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import {
  toCanvasGraph,
  type CanvasNodeData,
  type TopologyEdgeInput,
  type TopologyNodeInput,
} from './graph-canvas-model'
import {
  applyLayout,
  clearLayout,
  readLayoutSnapshot,
  subscribeToLayout,
  toStoredLayout,
  writeLayout,
  type StoredLayout,
} from './graph-layout-store'

/* ───────────────────────────── Nœud ───────────────────────────── */

/**
 * Le rendu d'un nœud. Volontairement sobre : le Canvas sert à LIRE une
 * structure, pas à décorer. Les terminaux (`__start__`/`__end__`) se
 * distinguent par la forme, pas par une couleur seule — un daltonien lit la
 * même information.
 */
function AigentNode({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const base =
    'rounded-lg border px-3 py-2 text-xs shadow-sm transition-colors min-w-[7rem] max-w-[12rem]'
  // Un nœud TERMINAL est une surface neutre (`aig-raised` + liseré franc) ; un
  // nœud de travail est un panneau du produit dont SEUL le liseré reste sky —
  // c'est lui qui porte la distinction, et il la porte en plus de la forme
  // (cf. l'en-tête : jamais la couleur seule). Les paires `X dark:Y` tombent :
  // le document est sombre depuis `layout.tsx`, la moitié claire ne se rendait
  // plus. La sélection garde son anneau sky, qui est un état d'interaction.
  const tone = d.terminal ? 'aig-raised aig-line' : 'aig-panel border-[color-mix(in_oklab,var(--aig-severity-running)_45%,transparent)]'
  const ring = selected
    ? 'ring-2 ring-(--aig-severity-running) ring-offset-1 ring-offset-[color:var(--aig-subtle)]'
    : ''

  return (
    <div className={`${base} ${tone} ${ring}`}>
      {/*
        LES POIGNÉES SONT OBLIGATOIRES. Un nœud custom SANS `Handle` ne peut
        porter aucune arête : React Flow refuse alors chaque arête et le graphe
        se rend en nœuds FLOTTANTS, sans aucun lien — visuellement plausible,
        structurellement faux. Constaté ici même : 168 avertissements
        « Couldn't create edge for source handle id: null » pendant que
        typecheck, build et les 20 gates restaient verts. Aucune gate ne mesure
        le rendu ; seule la capture l'a montré.

        Elles sont invisibles (`opacity-0`) parce que le Canvas est en lecture
        seule : elles servent d'ancrage aux arêtes, pas de cible de connexion.
        Leur fond n'a donc aucune conséquence visuelle : il vaut le liseré de la
        grammaire plutôt qu'un gris du kit, pour ne laisser aucune couleur
        orpheline derrière un `opacity-0` qu'un futur retrait rendrait visible.
      */}
      <Handle
        type="target"
        position={Position.Top}
        className="!size-1.5 !border-0 !bg-[color:var(--aig-line)] opacity-0"
      />
      <div className="truncate font-semibold" title={d.label}>
        {d.label}
      </div>
      {d.nodeType ? (
        <div className="aig-text-faint mt-0.5 truncate text-3xs">{d.nodeType}</div>
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-1.5 !border-0 !bg-[color:var(--aig-line)] opacity-0"
      />
    </div>
  )
}

/* ─────────────────────────── Inspecteur ─────────────────────────── */

/**
 * Panneau de détail du nœud sélectionné.
 *
 * IL DIT CE QU'IL NE SAIT PAS. La topologie publiée par l'Agent Server ne
 * contient ni modèle, ni outils, ni politiques — ces champs sont donc marqués
 * « non publié », jamais remplis d'une valeur plausible. Un modèle inventé ici
 * produirait exactement le genre de mensonge que `AGENTS.md` interdit.
 */
function Inspector({ node }: Readonly<{ node: Node | null }>) {
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Text className="aig-text-muted text-center text-xs">
          Sélectionne un nœud pour l’inspecter.
        </Text>
      </div>
    )
  }

  const d = node.data as CanvasNodeData

  return (
    <div
      className="scroll-thin flex h-full flex-col gap-3 overflow-y-auto p-3"
      data-testid="node-inspector"
    >
      <div className="flex flex-col gap-1">
        <Heading level={3} className="truncate text-sm">
          {d.label}
        </Heading>
        <Text className="aig-text-muted truncate font-mono text-2xs">{node.id}</Text>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge color="zinc">{d.nodeType ?? 'type non publié'}</Badge>
        {d.terminal ? <Badge color="amber">terminal</Badge> : null}
        {d.hasConditionalOut ? <Badge color="purple">sortie conditionnelle</Badge> : null}
      </div>

      <dl className="flex flex-col gap-1.5 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="aig-text-muted">Arêtes entrantes</dt>
          <dd className="font-mono">{d.inDegree}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="aig-text-muted">Arêtes sortantes</dt>
          <dd className="font-mono">{d.outDegree}</dd>
        </div>
      </dl>

      {/*
        Ces trois champs sont demandés par la mission mais ne sont PAS publiés
        par `GET /assistants/{id}/graph`. Les afficher vides et dits absents est
        la seule option honnête : les remplir exigerait de les fabriquer.
      */}
      <div className="aig-line-soft mt-1 flex flex-col gap-1 border-t pt-2">
        <Text className="aig-text-muted text-2xs">
          Modèle, outils et politiques ne sont pas exposés par la topologie de l’Agent Server. Ils
          ne sont pas affichés plutôt que devinés.
        </Text>
      </div>
    </div>
  )
}

/* ─────────────────────────── Canvas ─────────────────────────── */

const NODE_TYPES = { aigentNode: AigentNode }

export interface GraphCanvasProps {
  /** Cloisonne la disposition persistée : deux graphes ne se mélangent pas. */
  graphId: string
  nodes: readonly TopologyNodeInput[]
  edges: readonly TopologyEdgeInput[]
  /** Rendu en lecture seule — le seul mode existant aujourd'hui. */
  readOnly?: boolean
}

function CanvasInner({ graphId, nodes: rawNodes, edges: rawEdges }: Readonly<GraphCanvasProps>) {
  const mapped = useMemo(() => toCanvasGraph(rawNodes, rawEdges), [rawNodes, rawEdges])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(mapped.nodes as unknown as Node[])
  const [edges, , onEdgesChange] = useEdgesState<Edge>(mapped.edges as unknown as Edge[])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const flow = useReactFlow()

  /*
    RÉHYDRATATION AU PREMIER RENDU CLIENT, jamais pendant le rendu serveur.

    `localStorage` n'existe pas côté serveur : le lire pendant le rendu
    produirait un HTML serveur différent du premier rendu client, donc une
    erreur d'hydratation React. `useSyncExternalStore` est fait exactement pour
    ça — il déclare une valeur serveur (`null`) et une valeur client, sans
    `setState` dans un effet et sans risque de divergence entre les deux.

    Le graphe monte donc sur la disposition CALCULÉE — identique des deux côtés —
    puis adopte la disposition stockée dès que le client prend la main.
  */
  const storedLayout = useSyncExternalStore(
    subscribeToLayout,
    () => readLayoutSnapshot(graphId),
    () => null,
  )
  /** Vrai dès qu'une disposition persistée existe — pilote le bouton de reset. */
  const hasStoredLayout = storedLayout !== null

  /*
    L'application de la disposition stockée est un EFFET sur l'état XYFlow, pas
    un rendu dérivé : `useNodesState` détient les nœuds, y compris ceux que
    l'utilisateur déplace. On la réapplique quand l'instantané change — c'est-à-
    dire au premier rendu client, et après un reset.
  */
  const appliedRef = useRef<StoredLayout | null | undefined>(undefined)
  useEffect(() => {
    if (appliedRef.current === storedLayout) return
    appliedRef.current = storedLayout
    setNodes((current) => applyLayout(current, storedLayout))
    // Le cadrage stocké est restauré APRÈS les positions : sinon `fitView`
    // recadrerait par-dessus et annulerait visuellement la restauration.
    if (storedLayout?.viewport) flow.setViewport(storedLayout.viewport)
  }, [storedLayout, setNodes, flow])

  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    setSelectedId(sel.length === 1 ? sel[0].id : null)
  }, [])

  /*
    On persiste à la FIN d'un glisser, pas à chaque image.

    `onNodeDragStop` reçoit les nœuds courants en argument : on écrit depuis
    eux, sans passer par un updater d'état — un updater doit rester PUR, et
    écrire dans `localStorage` depuis l'intérieur ne l'est pas.
  */
  const onNodeDragStop = useCallback(
    (_event: unknown, _node: Node, currentNodes: Node[]) => {
      // Le CADRAGE est stocké avec les positions. Sans lui, `fitView` recadrait
      // au rechargement et le nœud restauré RÉAPPARAISSAIT ailleurs à l'écran :
      // les coordonnées du graphe étaient bonnes, leur projection ne l'était
      // pas. Constaté par l'E2E, qui a refusé la capture.
      writeLayout(graphId, toStoredLayout(currentNodes, flow.getViewport()))
    },
    [graphId, flow],
  )

  /** Efface la disposition stockée et revient au calcul déterministe. */
  const onResetLayout = useCallback(() => {
    clearLayout(graphId)
    setNodes(mapped.nodes as unknown as Node[])
  }, [graphId, mapped.nodes, setNodes])

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row" data-testid="graph-canvas">
      {/*
        `min-w-0` sur la colonne du graphe : sans lui, un contenu large forcerait
        l'élargissement du flex parent et provoquerait un overflow horizontal de
        la PAGE — exactement ce que la mission interdit.
      */}
      <div className="aig-line-soft relative min-h-[16rem] min-w-0 flex-1 overflow-hidden rounded-lg border">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={onSelectionChange}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={NODE_TYPES}
          // `fitView` UNIQUEMENT sans disposition stockée : sinon il recadre
          // par-dessus la restauration et l'annule visuellement.
          fitView={!hasStoredLayout}
          // Aucune mutation du GRAPHE : pas de création d'arête, pas de
          // suppression. Seule la disposition bouge, et elle est stockée à part.
          nodesConnectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: false }}
          // Le fond du graphe est un CREUX : c'est la surface qui accueille la
          // donnée, elle descend d'un palier sous le panneau qui la contient.
          // `bg-zinc-50 dark:bg-zinc-950` disait la même chose en deux valeurs
          // arbitraires dont une seule se rendait encore.
          className="aig-subtle"
        >
          <Background gap={16} className="opacity-60" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable className="!bottom-2 !right-2 hidden sm:block" />
        </ReactFlow>

        {hasStoredLayout ? (
          <div className="absolute right-2 top-2 z-10">
            <Button plain onClick={onResetLayout} data-testid="reset-layout" className="!text-xs">
              Réinitialiser la disposition
            </Button>
          </div>
        ) : null}
      </div>

      {/*
        L'inspecteur : colonne à droite sur desktop, bloc SOUS le graphe sur
        mobile. `shrink-0` + hauteur bornée pour qu'il ne mange jamais le graphe.
      */}
      <div className="aig-line-soft max-h-[14rem] min-h-[8rem] w-full shrink-0 overflow-hidden rounded-lg border lg:max-h-none lg:w-64">
        <Inspector node={selected} />
      </div>
    </div>
  )
}

/**
 * Point d'entrée. Les états dégradés sont traités AVANT de monter XYFlow :
 * monter un canvas vide puis afficher « rien » par-dessus coûterait un provider
 * et une mesure DOM pour rendre du vide.
 */
export default function GraphCanvas(props: Readonly<GraphCanvasProps>) {
  const { nodes, edges } = props

  if (nodes.length === 0) {
    return (
      <div
        className="aig-line-soft flex min-h-[12rem] flex-1 items-center justify-center rounded-lg border border-dashed p-6"
        data-testid="graph-canvas-empty"
      >
        <Text className="aig-text-muted max-w-md text-center text-xs">
          Aucun nœud à représenter. Ce n’est pas un graphe vide : le serveur ne publie pas de
          topologie pour ce graphe.
        </Text>
      </div>
    )
  }

  // Le mapping est déterministe : ce second appel rend le MÊME résultat que
  // celui de `CanvasInner`. On n'en lit que le compteur d'arêtes écartées.
  const dropped = toCanvasGraph(nodes, edges).droppedEdges

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      {dropped > 0 ? (
        // Une arête écartée est un fait, pas un détail : la taire donnerait un
        // graphe faux d'apparence saine.
        <Text className="text-2xs text-(--aig-severity-warn)">
          {dropped} arête(s) écartée(s) : elles désignent un nœud absent de la topologie publiée.
        </Text>
      ) : null}
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  )
}
