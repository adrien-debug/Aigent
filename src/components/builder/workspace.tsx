'use client'

/**
 * Builder — le poste d'authoring d'un projet.
 *
 * CE COMPOSANT EST LE SEUL À MUTER, ET IL MUTE PAR `fetch` VERS `/api/agent-ops`
 * ----------------------------------------------------------------------------
 * La LECTURE initiale est faite par le Server Component parent (RSC direct vers
 * `src/lib/agent-mission-control/**`, comme `src/app/page.tsx`). Les MUTATIONS
 * partent d'ici, en `fetch` vers les routes `/api/agent-ops/**`, JAMAIS par une
 * Server Action : une Server Action POSTe vers la route de la page, qui est hors
 * du `matcher` de `src/proxy.ts` (`['/api/agent-ops/:path*']`) — ce serait une
 * quatrième frontière de confiance non gardée. Ce contrat est tranché.
 *
 * LES QUATRE ÉTATS
 * ----------------
 * `loading` (une mutation est en vol), `error` (elle a échoué — avec le code
 * HTTP réel), `empty` (lecture réussie, rien à montrer) et `unavailable` (la
 * lecture n'a pas pu être tentée : 503 backend absent) ne sont jamais confondus.
 * Un 503 n'est PAS une erreur transitoire : il dit que le backend live n'est pas
 * configuré, et la surface le nomme ainsi.
 *
 * HITL — UNE DÉCISION, PAS UN ÉCHEC
 * ---------------------------------
 * Quand le graphe s'interrompt (`awaiting_approval`), l'écran affiche la
 * question du graphe, l'outil retenu au checkpoint (qui n'a PAS été exécuté) et
 * deux boutons de décision. Ce n'est pas peint comme une erreur.
 *
 * ZÉRO-SCROLL : la page ne défile jamais. Chaque panneau est borné (`min-h-0` +
 * `overflow-y-auto`) et c'est son contenu qui défile.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Divider } from '@/components/ui/divider'
import { Heading, Subheading } from '@/components/ui/heading'
import { Strong, Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { Panel, Unavailable } from '@/components/cockpit/primitives'
import type { BuilderRunState } from '@/lib/agent-mission-control/agent-builder-run'
import type { ProjectBuilderStreamEvent } from '@/lib/agent-mission-control/project-builder-stream-protocol'
import type {
  ProjectBuilderConversationBundle,
} from '@/lib/agent-mission-control/project-builder-types'
import { consumeSSE, isProjectBuilderTerminal } from '@/lib/agent-mission-control/sse-client'
import { CostedConfirmDialog, useCostedConfirm } from './confirm-dialog'
import {
  buildCapability,
  buildChatLines,
  buildHitlView,
  buildPreviewView,
  INITIAL_STREAM_PROGRESS,
  markStreamInterrupted,
  openingStreamProgress,
  reduceStreamEvent,
  type PreviewView,
  type StreamProgress,
} from './model'

/* ─────────────────────────── Erreurs de mutation ───────────────────────── */

/**
 * Une mutation ratée, qualifiée par ce que le serveur a réellement répondu.
 *
 * `kind` sépare les quatre familles que l'écran doit traiter différemment :
 * `unavailable` (503 — backend non configuré), `conflict` (409 — un état, pas
 * une panne), `not-found` (404) et `failure` (le reste).
 */
interface MutationError {
  kind: 'unavailable' | 'conflict' | 'not-found' | 'failure'
  message: string
  status: number | null
}

function classify(status: number, message: string): MutationError {
  if (status === 503) return { kind: 'unavailable', message, status }
  if (status === 409) return { kind: 'conflict', message, status }
  if (status === 404) return { kind: 'not-found', message, status }
  return { kind: 'failure', message, status }
}

/**
 * Appelle une route de mutation et normalise l'échec.
 *
 * Le corps d'erreur des routes est toujours `{ error: string }` — on le lit,
 * sans jamais inventer de message quand il manque.
 */
async function mutate(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; body: unknown } | { ok: false; error: MutationError }> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
  } catch (err) {
    // Réseau injoignable : on ne sait pas si le serveur a agi. On le dit.
    return {
      ok: false,
      error: {
        kind: 'failure',
        message: err instanceof Error ? err.message : 'requête impossible',
        status: null,
      },
    }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const message =
      body !== null && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${response.status}`
    return { ok: false, error: classify(response.status, message) }
  }
  return { ok: true, body }
}

/* ──────────────────────────────── Sous-vues ────────────────────────────── */

function ErrorNote({ error }: { error: MutationError }) {
  const label =
    error.kind === 'unavailable'
      ? 'Backend indisponible'
      : error.kind === 'conflict'
        ? 'État en conflit'
        : error.kind === 'not-found'
          ? 'Introuvable'
          : 'Échec'
  const color = error.kind === 'conflict' ? 'amber' : error.kind === 'unavailable' ? 'zinc' : 'red'

  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-zinc-950/10 p-3 dark:border-white/10">
      <Badge color={color}>{label}</Badge>
      <Text className="min-w-0 flex-1 break-words">{error.message}</Text>
    </div>
  )
}

function ChatThread({
  lines,
  emptyProven,
}: {
  lines: ReturnType<typeof buildChatLines>
  emptyProven: boolean
}) {
  if (lines.length === 0) {
    return (
      <div className="p-4">
        <Unavailable
          reason={emptyProven ? 'no-data' : 'unread'}
          detail={
            emptyProven
              ? 'La lecture a réussi et le fil est réellement vide : la conversation vient d’être ouverte. Décrire l’agent voulu pour commencer.'
              : 'Le fil n’a pas pu être lu.'
          }
        />
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-3 p-4">
      {lines.map((line) => (
        <li key={line.id} className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Badge color={line.role === 'user' ? 'blue' : line.role === 'assistant' ? 'emerald' : 'zinc'}>
              {line.role === 'user' ? 'vous' : line.role === 'assistant' ? 'architecte' : 'système'}
            </Badge>
          </div>
          <Text className="whitespace-pre-wrap break-words">{line.content}</Text>
        </li>
      ))}
    </ul>
  )
}

/** L'outil, AVEC sa description : elle porte le contrat que le schéma ne dit pas. */
function ToolRow({ tool }: { tool: PreviewView['tools'][number] }) {
  const riskColor =
    tool.riskLevel === 'critical' || tool.riskLevel === 'high'
      ? 'red'
      : tool.riskLevel === 'medium'
        ? 'amber'
        : 'zinc'

  return (
    <li className="flex flex-col gap-1 border-b border-zinc-950/5 py-2 last:border-b-0 dark:border-white/5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Strong className="truncate font-mono text-xs">{tool.name}</Strong>
        <Badge color={riskColor}>{tool.riskLevel}</Badge>
        {tool.requiresConfirmation ? <Badge color="amber">confirmation</Badge> : null}
      </div>
      {/* Description absente ≠ description vide : on nomme l'absence. */}
      <Text className="text-xs">
        {tool.description ?? (
          <span className="text-zinc-500 dark:text-zinc-400">
            description non fournie par l’architecte
          </span>
        )}
      </Text>
    </li>
  )
}

function SpecPanel({
  preview,
  onSelectOption,
  selecting,
  canSelect,
}: {
  preview: PreviewView | null
  onSelectOption: (optionId: string) => void
  selecting: boolean
  canSelect: boolean
}) {
  if (!preview) {
    return (
      <div className="p-4">
        <Unavailable
          reason="no-data"
          detail="La lecture a réussi et l’architecte n’a encore produit aucune spécification. Elle se remplit au fil de la conversation."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Subheading level={3}>{preview.name ?? 'Agent sans nom'}</Subheading>
        {preview.role ? <Text>{preview.role}</Text> : null}
        {preview.description ? <Text className="mt-1">{preview.description}</Text> : null}
      </div>

      {preview.options.length > 0 ? (
        <div>
          <Text className="mb-2 font-medium">Options proposées</Text>
          <ul className="flex flex-col gap-2">
            {preview.options.map((option) => {
              const selected = preview.selectedOptionId === option.id
              return (
                <li
                  key={option.id}
                  className="rounded-lg border border-zinc-950/10 p-2 dark:border-white/10"
                >
                  <div className="flex items-center gap-2">
                    <Strong className="min-w-0 flex-1 truncate">{option.title}</Strong>
                    {selected ? (
                      <Badge color="emerald">retenue</Badge>
                    ) : canSelect ? (
                      <Button
                        plain
                        onClick={() => onSelectOption(option.id)}
                        disabled={selecting}
                      >
                        Choisir
                      </Button>
                    ) : null}
                  </div>
                  <Text className="mt-1">{option.summary}</Text>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {preview.tools.length > 0 ? (
        <div>
          <Text className="mb-1 font-medium">Outils ({preview.tools.length})</Text>
          <ul>
            {preview.tools.map((tool) => (
              <ToolRow key={tool.name} tool={tool} />
            ))}
          </ul>
        </div>
      ) : null}

      {preview.flow.length > 0 ? (
        <div>
          <Text className="mb-1 font-medium">Déroulé</Text>
          <ol className="flex flex-col gap-1">
            {preview.flow.map((step, index) => (
              <li key={step} className="flex gap-2">
                <span className="shrink-0 font-mono text-xs text-zinc-500">{index + 1}.</span>
                <Text className="text-xs">{step}</Text>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {preview.tests.length > 0 ? (
        <div>
          <Text className="mb-1 font-medium">Tests prévus ({preview.tests.length})</Text>
          <ul className="flex flex-col gap-0.5">
            {preview.tests.map((test) => (
              <li key={test}>
                <Text className="text-xs">{test}</Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        {preview.confirmationPolicy ? (
          <Text className="text-xs">
            <Strong>Politique de confirmation :</Strong> {preview.confirmationPolicy}
          </Text>
        ) : null}
        {/* `null` ≠ 0 : un plafond non fixé se dit, il ne se chiffre pas. */}
        <Text className="text-xs">
          <Strong>Étapes max par run :</Strong>{' '}
          {preview.maxStepsPerRun === null ? (
            <span className="text-zinc-500 dark:text-zinc-400">non fixé par l’architecte</span>
          ) : (
            preview.maxStepsPerRun
          )}
        </Text>
        {preview.riskPolicy ? (
          <Text className="text-xs">
            <Strong>Risque :</Strong> {preview.riskPolicy}
          </Text>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Le tour d'architecte EN COURS, tel que le flux le dit.
 *
 * Ce bloc remplace l'ancien « Envoi… » aveugle. Il ne rend QUE ce que le
 * protocole porte réellement : la phase, la prose reçue au fil de l'eau, et le
 * nombre de fragments reçus. Il n'y a ni barre de pourcentage (aucun total
 * n'existe dans le protocole) ni liste d'appels d'outils (le protocole n'en
 * émet aucun — voir `StreamProgress` dans `model.ts`).
 *
 * ZÉRO-SCROLL : la prose reçue défile dans SA propre boîte bornée. Un tour long
 * ne fait pas grandir le panneau ni la page.
 */
function StreamProgressNote({ progress }: { progress: StreamProgress }) {
  if (progress.phase === 'idle') return null

  const color =
    progress.phase === 'completed'
      ? 'emerald'
      : progress.phase === 'failed'
        ? 'red'
        : progress.phase === 'interrupted'
          ? 'amber'
          : 'blue'

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-zinc-950/10 p-3 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={color}>{progress.label}</Badge>
        {/* Une mesure réelle — le nombre de fragments reçus — jamais un pourcentage inventé. */}
        {progress.deltaCount > 0 ? (
          <Text className="text-xs">{progress.deltaCount} fragments reçus</Text>
        ) : null}
        {progress.errorCode ? (
          <Text className="font-mono text-xs">{progress.errorCode}</Text>
        ) : null}
      </div>

      {progress.detail ? <Text className="text-xs">{progress.detail}</Text> : null}

      {progress.text.length > 0 ? (
        <div className="max-h-40 min-h-0 overflow-y-auto rounded-md bg-zinc-950/5 p-2 dark:bg-white/5">
          <Text className="text-xs whitespace-pre-wrap break-words">{progress.text}</Text>
        </div>
      ) : null}

      {progress.phase === 'failed' && progress.retryable ? (
        <Text className="text-xs">Le serveur signale que ce tour peut être retenté.</Text>
      ) : null}
    </div>
  )
}

/**
 * L'interruption humaine — une DÉCISION, jamais un échec.
 *
 * L'outil retenu au checkpoint est affiché explicitement comme NON exécuté :
 * c'est le fait le plus important de l'écran à cet instant.
 */
function HitlPanel({
  hitl,
  onDecide,
  pending,
}: {
  hitl: ReturnType<typeof buildHitlView>
  onDecide: (approved: boolean) => void
  pending: boolean
}) {
  if (hitl.phase === 'none') {
    return (
      <div className="p-4">
        <Unavailable
          reason="no-data"
          detail="Aucun run de matérialisation n’est en cours. C’est l’état normal tant que la spécification n’a pas été approuvée."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Badge
          color={
            hitl.phase === 'awaiting-decision'
              ? 'amber'
              : hitl.phase === 'completed'
                ? 'emerald'
                : hitl.phase === 'running'
                  ? 'blue'
                  : hitl.phase === 'thread-lost'
                    ? 'zinc'
                    : 'red'
          }
        >
          {hitl.label}
        </Badge>
      </div>

      {hitl.actionHint ? <Text>{hitl.actionHint}</Text> : null}

      {hitl.question ? (
        <div className="rounded-lg border border-zinc-950/10 p-3 dark:border-white/10">
          <Text className="font-medium">Question du graphe</Text>
          <Text className="mt-1 whitespace-pre-wrap">{hitl.question}</Text>
        </div>
      ) : null}

      {hitl.pendingTool ? (
        <div className="rounded-lg border border-dashed border-amber-500/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Strong className="font-mono text-xs">{hitl.pendingTool.name}</Strong>
            {hitl.pendingTool.risk ? <Badge color="amber">{hitl.pendingTool.risk}</Badge> : null}
            <Badge color="zinc">non exécuté</Badge>
          </div>
          <Text className="mt-1 font-mono text-xs break-words">
            {hitl.pendingTool.argumentsSummary}
          </Text>
          <Text className="mt-1 text-xs">
            L’outil est retenu au point d’arrêt : il ne s’exécutera que si la décision est
            « approuver ».
          </Text>
        </div>
      ) : null}

      {hitl.decisionRequired ? (
        <div className="flex gap-2">
          <Button onClick={() => onDecide(true)} disabled={pending}>
            {pending ? 'En cours…' : 'Approuver — créer le draft'}
          </Button>
          <Button plain onClick={() => onDecide(false)} disabled={pending}>
            Refuser
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/* ──────────────────────────────── Écran ────────────────────────────────── */

export default function BuilderWorkspace({
  projectId,
  projectName,
  repoFullName,
  bundle,
  /** `true` quand la lecture serveur a échoué — le bundle est alors `null`. */
  unreadable,
  failure,
  /** `true` quand le backend live n'est pas configuré (503 côté serveur). */
  backendUnavailable,
}: {
  projectId: string
  projectName: string
  repoFullName: string | null
  bundle: ProjectBuilderConversationBundle | null
  unreadable: boolean
  failure: string | null
  backendUnavailable: boolean
}) {
  const router = useRouter()
  const [draftMessage, setDraftMessage] = useState('')
  const [busy, setBusy] = useState<null | 'message' | 'select' | 'draft' | 'decision'>(null)
  const [error, setError] = useState<MutationError | null>(null)
  // Ce que le FLUX du tour d'architecte dit — remplace l'ancien « Envoi… » aveugle.
  const [stream, setStream] = useState<StreamProgress>(INITIAL_STREAM_PROGRESS)
  const confirmer = useCostedConfirm()
  // Le run reçu du serveur peut être remplacé par celui d'une mutation locale :
  // on garde la valeur la plus fraîche sans re-fetch complet.
  const [liveRun, setLiveRun] = useState<BuilderRunState | null | undefined>(undefined)
  const threadRef = useRef<HTMLDivElement | null>(null)

  const conversation = bundle?.conversation ?? null
  const preview = useMemo(() => buildPreviewView(conversation?.latestPreview ?? null), [conversation])
  const lines = useMemo(() => buildChatLines(bundle?.messages ?? []), [bundle])
  const hitl = useMemo(
    () => buildHitlView(liveRun === undefined ? (bundle?.runState ?? null) : liveRun, conversation),
    [liveRun, bundle, conversation],
  )
  const capability = useMemo(
    () =>
      buildCapability({
        conversationStatus: conversation?.status ?? 'active',
        preview,
        hitl,
        backendUnavailable: backendUnavailable || unreadable,
      }),
    [conversation, preview, hitl, backendUnavailable, unreadable],
  )

  /** Recharge la lecture serveur — la source de vérité reste le RSC. */
  const refresh = useCallback(() => {
    setLiveRun(undefined)
    router.refresh()
  }, [router])

  /**
   * Repli NON streamé — le POST JSON d'origine, inchangé.
   *
   * Il sert quand le flux ne peut pas s'ouvrir du tout : navigateur sans
   * `ReadableStream` sur les réponses `fetch`, proxy qui refuse le
   * `text/event-stream`, réponse sans corps lisible. La fonctionnalité reste
   * entière — on perd la progression, pas le tour.
   */
  const sendMessageBuffered = useCallback(
    async (content: string) => {
      setStream({
        ...openingStreamProgress(),
        label: 'Tour en cours — sans flux',
        detail:
          'Le flux de progression n’a pas pu être ouvert : le tour est émis en une seule requête. Aucune étape intermédiaire n’est donc rapportée jusqu’à la réponse.',
      })
      const result = await mutate(
        `/api/agent-ops/projects/${encodeURIComponent(projectId)}/builder/message`,
        { method: 'POST', body: JSON.stringify({ content }) },
      )
      if (!result.ok) {
        // Un `status: null` = réseau injoignable : on ne sait pas si le serveur a
        // agi. On le dit comme une interruption, pas comme un échec prouvé.
        setStream((current) =>
          result.error.status === null
            ? markStreamInterrupted(current, result.error.message)
            : { ...current, phase: 'failed', label: 'Tour en échec', detail: result.error.message },
        )
        setError(result.error)
        return
      }
      setStream({
        ...INITIAL_STREAM_PROGRESS,
        phase: 'completed',
        label: 'Tour terminé',
        detail: 'La réponse est persistée dans le fil du projet.',
      })
      setDraftMessage('')
      refresh()
    },
    [projectId, refresh],
  )

  /**
   * Le tour d'architecte EN FLUX — le chemin normal.
   *
   * La route décide du mode sur `?stream=1` OU un `Accept: text/event-stream`
   * (`wantsStream()`), et on envoie les deux : le paramètre survit à un proxy
   * qui réécrirait les en-têtes.
   *
   * Trois issues sont distinguées, jamais confondues :
   *  · terminal reçu       → succès ou échec, selon ce que le serveur a dit ;
   *  · flux coupé sans terminal → `interrupted` : résultat INCONNU ;
   *  · flux impossible à ouvrir → repli sur le POST JSON.
   */
  const sendMessage = useCallback(async () => {
    const content = draftMessage.trim()
    if (content.length === 0) return
    setBusy('message')
    setError(null)
    setStream(openingStreamProgress())

    let response: Response
    try {
      response = await fetch(
        `/api/agent-ops/projects/${encodeURIComponent(projectId)}/builder/message?stream=1`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ content }),
        },
      )
    } catch (err) {
      // La requête n'est jamais partie proprement : on ne sait pas si le serveur
      // a agi. Aucun repli ici — le rejouer risquerait un second tour facturé.
      const message = err instanceof Error ? err.message : 'requête impossible'
      setStream((current) => markStreamInterrupted(current, message))
      setError({ kind: 'failure', message, status: null })
      setBusy(null)
      return
    }

    // Erreur AVANT tout flux : la route a répondu en JSON (503 / 400 / 404 / 409).
    if (!response.ok) {
      let body: unknown = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      const message =
        body !== null && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : `HTTP ${response.status}`
      const failure = classify(response.status, message)
      setStream((current) => ({
        ...current,
        phase: 'failed',
        label: 'Tour refusé',
        detail: message,
      }))
      setError(failure)
      setBusy(null)
      return
    }

    // Le serveur a répondu 200 mais SANS flux lisible (proxy qui met en tampon,
    // navigateur sans corps streamable) : repli sur le POST JSON.
    const isEventStream = (response.headers.get('content-type') ?? '').includes('text/event-stream')
    if (!response.body || !isEventStream) {
      await sendMessageBuffered(content)
      setBusy(null)
      return
    }

    try {
      const result = await consumeSSE<ProjectBuilderStreamEvent>(
        response.body,
        (event) => setStream((current) => reduceStreamEvent(current, event)),
        { isTerminal: isProjectBuilderTerminal, requireTerminal: true },
      )
      // `requireTerminal` garantit un terminal ici ; seul un terminal de succès
      // vide le brouillon et recharge la lecture serveur.
      const terminal = result.terminalEvent
      if (terminal !== null && isProjectBuilderTerminal(terminal)) {
        if (terminal.lifecycle === 'completed') {
          setDraftMessage('')
          refresh()
        } else {
          setError({ kind: 'failure', message: terminal.error, status: null })
        }
      }
    } catch (err) {
      // EOF avant terminal, ou lecture interrompue. Le serveur a PU terminer :
      // ni succès ni échec — inconnu, et l'écran le dit comme tel.
      setStream((current) =>
        markStreamInterrupted(current, err instanceof Error ? err.message : null),
      )
    } finally {
      setBusy(null)
    }
  }, [draftMessage, projectId, refresh, sendMessageBuffered])

  const selectOption = useCallback(
    async (optionId: string) => {
      setBusy('select')
      setError(null)
      const result = await mutate(
        `/api/agent-ops/projects/${encodeURIComponent(projectId)}/builder/preview/select`,
        { method: 'POST', body: JSON.stringify({ optionId }) },
      )
      setBusy(null)
      if (!result.ok) {
        setError(result.error)
        return
      }
      refresh()
    },
    [projectId, refresh],
  )

  const startDraft = useCallback(async () => {
    setBusy('draft')
    setError(null)
    const result = await mutate(
      `/api/agent-ops/projects/${encodeURIComponent(projectId)}/builder/create-draft`,
      { method: 'POST', body: JSON.stringify({}) },
    )
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const runState = (result.body as { runState?: BuilderRunState | null } | null)?.runState ?? null
    setLiveRun(runState)
    refresh()
  }, [projectId, refresh])

  const decide = useCallback(
    async (approved: boolean) => {
      setBusy('decision')
      setError(null)
      const result = await mutate(
        `/api/agent-ops/projects/${encodeURIComponent(projectId)}/builder/create-draft`,
        { method: 'POST', body: JSON.stringify({ approved }) },
      )
      setBusy(null)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setLiveRun(null)
      refresh()
    },
    [projectId, refresh],
  )

  /* ── Mutations costées : elles passent TOUTES par le dialog (décision D2) ── */

  const requestSendMessage = () => {
    confirmer.request(
      {
        title: 'Envoyer un tour à l’architecte',
        description:
          'Le message part vers l’architecte, qui peut lire le dépôt lié avant de répondre.',
        effects: [
          'Un appel modèle facturé est émis (jusqu’à 8 allers-retours d’outils de lecture du dépôt).',
          'Le dépôt lié est lu en LECTURE SEULE — aucune écriture GitHub.',
          'Le message et la réponse sont persistés dans le fil du projet.',
        ],
        estimatedCost: null,
        confirmLabel: 'Envoyer',
      },
      sendMessage,
    )
  }

  const requestStartDraft = () => {
    confirmer.request(
      {
        title: 'Lancer la matérialisation du draft',
        description:
          'Le graphe LangGraph démarre et s’arrête au point d’approbation humaine. Rien n’est créé à cette étape.',
        effects: [
          'Un run LangGraph facturé démarre sur le serveur d’agents.',
          'Le graphe s’interrompt au checkpoint HITL : aucun agent n’est créé tant que vous n’avez pas approuvé.',
          'Aucune écriture GitHub, aucun push.',
        ],
        estimatedCost: null,
        confirmLabel: 'Lancer le run',
      },
      startDraft,
    )
  }

  const requestDecision = (approved: boolean) => {
    if (!approved) {
      // Refuser ne coûte rien et ne crée rien : pas de dialog de coût.
      void decide(false)
      return
    }
    confirmer.request(
      {
        title: 'Approuver — créer le draft',
        description:
          'L’approbation reprend le graphe au point d’arrêt et matérialise un agent en statut draft.',
        effects: [
          'Le graphe reprend : l’outil retenu au checkpoint s’exécute.',
          'Un copilot DRAFT est créé et rattaché à ce projet, puis son assistant est provisionné chez le provider — c’est une étape facturée.',
          'Aucune promotion en production, aucune écriture GitHub.',
        ],
        estimatedCost: null,
        confirmLabel: 'Approuver et créer',
      },
      () => decide(true),
    )
  }

  /* ─────────────────────────────── Rendu ──────────────────────────────── */

  // Lecture impossible : on ne rend AUCUN champ plutôt que des champs vides.
  if (backendUnavailable || unreadable || !conversation) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3">
        <header className="shrink-0 px-1">
          <Heading level={1}>{projectName}</Heading>
          <Text className="mt-1">{repoFullName ?? 'aucun dépôt lié'}</Text>
        </header>
        <Panel title="Conversation d’authoring" className="min-h-0 flex-1">
          <Unavailable
            reason="unread"
            detail={
              backendUnavailable
                ? 'Le backend live n’est pas configuré. La conversation d’authoring n’a pas pu être lue — ce n’est pas un fil vide, c’est un fil inconnu.'
                : 'La conversation d’authoring n’a pas pu être lue.'
            }
          />
          {failure ? <Text className="mt-3 text-center font-mono text-xs">{failure}</Text> : null}
        </Panel>
      </div>
    )
  }

  const draftCreatedId = preview?.createdCopilotId ?? bundle?.createdCopilotId ?? null

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3">
      <header className="flex shrink-0 flex-wrap items-center gap-2 px-1">
        <div className="min-w-0 flex-1">
          <Heading level={1} className="truncate">
            {projectName}
          </Heading>
          <Text className="mt-1 truncate">
            {repoFullName ?? 'aucun dépôt lié — l’architecte ne peut pas lire de code'}
          </Text>
        </div>
        <Badge color={conversation.status === 'draft_created' ? 'emerald' : 'zinc'}>
          {conversation.status}
        </Badge>
      </header>

      {error ? (
        <div className="shrink-0 px-1">
          <ErrorNote error={error} />
        </div>
      ) : null}

      {/* Grille bornée : c'est ELLE qui tient le zéro-scroll. Chaque panneau
          défile dans sa propre boîte, la page jamais. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-2 xl:grid-cols-3">
        <Panel
          title="Conversation"
          hint={`${lines.length} message${lines.length > 1 ? 's' : ''}`}
          className="min-h-0 xl:col-span-1"
          padded={false}
          bodyClassName="flex flex-col min-h-0"
        >
          <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
            {/* `emptyProven` était câblé en dur à `true` — la branche `'unread'`
             * de `ChatThread` était donc MORTE, et un fil dont la lecture avait
             * échoué affirmait « la lecture a réussi et le fil est réellement
             * vide ». Le vide n'est prouvé que si la lecture a abouti ET a
             * ramené un bundle : sinon on ne sait pas ce que contient le fil. */}
            <ChatThread lines={lines} emptyProven={!unreadable && bundle !== null} />
          </div>
          <div className="shrink-0 border-t border-zinc-950/5 p-3 dark:border-white/5">
            {/* La progression réelle du tour — ce que le flux dit, borné et scrollable. */}
            {stream.phase !== 'idle' ? (
              <div className="mb-3">
                <StreamProgressNote progress={stream} />
              </div>
            ) : null}
            <Textarea
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              rows={3}
              placeholder={
                capability.canSendMessage
                  ? 'Décrire l’agent voulu…'
                  : 'La conversation n’accepte plus de tour.'
              }
              disabled={!capability.canSendMessage || busy !== null}
            />
            <div className="mt-2 flex items-center gap-2">
              <Button
                onClick={requestSendMessage}
                disabled={
                  !capability.canSendMessage || busy !== null || draftMessage.trim().length === 0
                }
              >
                {/* Plus d'état aveugle : le libellé nomme la phase réelle du flux. */}
                {busy === 'message' ? stream.label : 'Envoyer'}
              </Button>
              <Text className="text-xs">Appel modèle facturé — confirmation demandée.</Text>
            </div>
            {/* Résultat INCONNU : la seule action honnête est de relire le serveur. */}
            {stream.phase === 'interrupted' ? (
              <div className="mt-2">
                <Button plain onClick={refresh}>
                  Recharger pour lire l’état réel
                </Button>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="Spécification"
          hint={preview?.readyForApproval ? 'prête' : 'en cours'}
          className="min-h-0"
          padded={false}
          bodyClassName="overflow-y-auto"
        >
          <SpecPanel
            preview={preview}
            onSelectOption={selectOption}
            selecting={busy === 'select'}
            canSelect={capability.canSendMessage && busy === null}
          />
        </Panel>

        <Panel
          title="Matérialisation"
          hint={hitl.label}
          className="min-h-0 lg:col-span-2 xl:col-span-1"
          padded={false}
          bodyClassName="overflow-y-auto"
        >
          <div className="flex flex-col">
            <HitlPanel hitl={hitl} onDecide={requestDecision} pending={busy === 'decision'} />

            <Divider soft />

            <div className="flex flex-col gap-2 p-4">
              {draftCreatedId ? (
                <div className="rounded-lg border border-dashed border-emerald-500/40 p-3">
                  <Text className="font-medium">Draft créé</Text>
                  <Text className="mt-1 font-mono text-xs break-words">{draftCreatedId}</Text>
                  <Text className="mt-1 text-xs">
                    C’est la preuve de sortie de cette surface : un agent en statut draft, rattaché
                    au projet. Sa qualification et sa promotion se font ailleurs.
                  </Text>
                </div>
              ) : (
                <>
                  <Button
                    onClick={requestStartDraft}
                    disabled={!capability.canStartDraft || busy !== null}
                  >
                    {busy === 'draft' ? 'Lancement…' : 'Matérialiser le draft'}
                  </Button>
                  {/* Un bouton fermé dit toujours POURQUOI il est fermé. */}
                  {capability.draftBlockedReason ? (
                    <Text className="text-xs">{capability.draftBlockedReason}</Text>
                  ) : (
                    <Text className="text-xs">
                      Démarre un run LangGraph facturé qui s’arrête au point d’approbation humaine.
                    </Text>
                  )}
                </>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <Text className="shrink-0 px-1 text-xs">
        Aucune action de cette surface n’écrit sur GitHub. Toute mutation facturée passe par une
        confirmation explicite.
      </Text>

      {confirmer.descriptor ? (
        <CostedConfirmDialog
          open={confirmer.open}
          descriptor={confirmer.descriptor}
          pending={confirmer.running}
          onConfirm={() => void confirmer.confirm()}
          onClose={confirmer.close}
        />
      ) : null}
    </div>
  )
}
