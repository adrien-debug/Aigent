'use client'

/**
 * Canvas LangGraph — représentation visuelle de la topologie RÉELLE du graphe.
 *
 * XYFlow REPRÉSENTE LangGraph, il ne le remplace pas. Ce composant ne crée pas
 * de nœud, n'en supprime aucun, ne relie rien et n'écrit jamais vers l'Agent
 * Server : il n'existe ici aucun chemin de mutation du manifeste. Le
 * déplacement d'un nœud reste dans l'état React et meurt avec le composant —
 * c'est délibéré, la disposition est DÉRIVÉE du graphe (voir
 * `graph-canvas-model`), donc jamais désynchronisée de lui.
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
} from '@xyflow/react'
import { useCallback, useMemo, useState } from 'react'

import '@xyflow/react/dist/style.css'

import { Badge } from '@/components/ui/badge'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import {
  toCanvasGraph,
  type CanvasNodeData,
  type TopologyEdgeInput,
  type TopologyNodeInput,
} from './graph-canvas-model'

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
  const tone = d.terminal
    ? 'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
    : 'border-sky-300 bg-white text-zinc-900 dark:border-sky-800 dark:bg-zinc-900 dark:text-zinc-100'
  const ring = selected ? 'ring-2 ring-sky-500 ring-offset-1 dark:ring-offset-zinc-950' : ''

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
      */}
      <Handle type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-zinc-400 opacity-0" />
      <div className="truncate font-semibold" title={d.label}>
        {d.label}
      </div>
      {d.nodeType ? (
        <div className="mt-0.5 truncate text-3xs text-zinc-500 dark:text-zinc-400">
          {d.nodeType}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-zinc-400 opacity-0" />
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
        <Text className="text-center text-xs text-zinc-500">
          Sélectionne un nœud pour l’inspecter.
        </Text>
      </div>
    )
  }

  const d = node.data as CanvasNodeData

  return (
    <div className="scroll-thin flex h-full flex-col gap-3 overflow-y-auto p-3" data-testid="node-inspector">
      <div className="flex flex-col gap-1">
        <Heading level={3} className="truncate text-sm">
          {d.label}
        </Heading>
        <Text className="truncate font-mono text-2xs text-zinc-500">{node.id}</Text>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge color="zinc">{d.nodeType ?? 'type non publié'}</Badge>
        {d.terminal ? <Badge color="amber">terminal</Badge> : null}
        {d.hasConditionalOut ? <Badge color="purple">sortie conditionnelle</Badge> : null}
      </div>

      <dl className="flex flex-col gap-1.5 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-zinc-500">Arêtes entrantes</dt>
          <dd className="font-mono text-zinc-900 dark:text-zinc-100">{d.inDegree}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-zinc-500">Arêtes sortantes</dt>
          <dd className="font-mono text-zinc-900 dark:text-zinc-100">{d.outDegree}</dd>
        </div>
      </dl>

      {/*
        Ces trois champs sont demandés par la mission mais ne sont PAS publiés
        par `GET /assistants/{id}/graph`. Les afficher vides et dits absents est
        la seule option honnête : les remplir exigerait de les fabriquer.
      */}
      <div className="mt-1 flex flex-col gap-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
        <Text className="text-2xs text-zinc-500">
          Modèle, outils et politiques ne sont pas exposés par la topologie de
          l’Agent Server. Ils ne sont pas affichés plutôt que devinés.
        </Text>
      </div>
    </div>
  )
}

/* ─────────────────────────── Canvas ─────────────────────────── */

const NODE_TYPES = { aigentNode: AigentNode }

export interface GraphCanvasProps {
  nodes: readonly TopologyNodeInput[]
  edges: readonly TopologyEdgeInput[]
  /** Rendu en lecture seule — le seul mode existant aujourd'hui. */
  readOnly?: boolean
}

function CanvasInner({ nodes: rawNodes, edges: rawEdges }: Readonly<GraphCanvasProps>) {
  const mapped = useMemo(() => toCanvasGraph(rawNodes, rawEdges), [rawNodes, rawEdges])

  const [nodes, , onNodesChange] = useNodesState<Node>(mapped.nodes as unknown as Node[])
  const [edges, , onEdgesChange] = useEdgesState<Edge>(mapped.edges as unknown as Edge[])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    setSelectedId(sel.length === 1 ? sel[0].id : null)
  }, [])

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row" data-testid="graph-canvas">
      {/*
        `min-w-0` sur la colonne du graphe : sans lui, un contenu large forcerait
        l'élargissement du flex parent et provoquerait un overflow horizontal de
        la PAGE — exactement ce que la mission interdit.
      */}
      <div className="relative min-h-[18rem] min-w-0 flex-1 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={onSelectionChange}
          nodeTypes={NODE_TYPES}
          fitView
          // Aucune mutation du graphe : pas de création d'arête, pas de
          // suppression. Le déplacement d'un nœud reste local et non persisté.
          nodesConnectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: false }}
          className="bg-zinc-50 dark:bg-zinc-950"
        >
          <Background gap={16} className="opacity-60" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable className="!bottom-2 !right-2 hidden sm:block" />
        </ReactFlow>
      </div>

      <div className="min-h-[9rem] w-full shrink-0 overflow-hidden rounded-lg border border-zinc-200 lg:h-auto lg:w-64 dark:border-zinc-800">
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
        className="flex min-h-[12rem] flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-6 dark:border-zinc-700"
        data-testid="graph-canvas-empty"
      >
        <Text className="max-w-md text-center text-xs text-zinc-500">
          Aucun nœud à représenter. Ce n’est pas un graphe vide : le serveur ne
          publie pas de topologie pour ce graphe.
        </Text>
      </div>
    )
  }

  const dropped = toCanvasGraph(nodes, edges).droppedEdges

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      {dropped > 0 ? (
        // Une arête écartée est un fait, pas un détail : la taire donnerait un
        // graphe faux d'apparence saine.
        <Text className="text-2xs text-amber-600 dark:text-amber-500">
          {dropped} arête(s) écartée(s) : elles désignent un nœud absent de la
          topologie publiée.
        </Text>
      ) : null}
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  )
}
