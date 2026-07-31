'use client'

/**
 * Le POSTE DE LIVRAISON — le seul composant client de cette surface, et le seul
 * qui mute.
 *
 * POURQUOI UN `fetch` ET PAS UNE SERVER ACTION
 * --------------------------------------------
 * Une Server Action POSTe vers la route de la PAGE. `/delivery/...` n'est pas
 * sous `/api/agent-ops/**`, donc pas dans le `matcher` de `src/proxy.ts` : ce
 * serait une quatrième frontière de confiance, mutante et non gardée, ouverte
 * par simple commodité d'écriture. Toutes les mutations partent donc d'ici en
 * `fetch` vers des routes `/api/agent-ops/**` déjà gardées, avec
 * `credentials: 'same-origin'` pour que le cookie de session HMAC voyage.
 *
 * LA RÈGLE CARDINALE DE CE FICHIER
 * --------------------------------
 * **Le dry-run est le défaut, et le mode réel n'est jamais préarmé.** Chaque
 * descripteur s'ouvre sans `confirm` dans son corps ; cocher la confirmation est
 * un geste explicite, et la case se DÉSARME à chaque fermeture du dialogue. Un
 * dialogue rouvert repart en dry-run, jamais sur l'armement précédent.
 *
 * **Le second verrou n'appartient pas à cette interface.** Une écriture GitHub
 * réelle exige aussi une variable d'environnement serveur. Cet écran la LIT
 * (via `realDeliveryEnabled`, un seul booléen) pour dire honnêtement ce qui va
 * se passer — il ne l'arme pas, ne la nomme pas, et n'explique nulle part
 * comment l'ouvrir. Un plan de contrôle qui documenterait le contournement de sa
 * propre garantie ne serait plus une garantie.
 *
 * **C'est le SERVEUR qui dit si une écriture a eu lieu.** `readPushOutcome` lit
 * `dryRun` dans la RÉPONSE, jamais l'intention du clic. Une confirmation cochée
 * sur un serveur verrouillé rend `dryRun: true` — et l'écran annonce alors un
 * dry-run, parce que c'est ce qui s'est passé.
 *
 * CE QUE CE COMPOSANT NE FAIT PAS
 * -------------------------------
 * · Il ne recalcule AUCUN état de livraison : ils arrivent dérivés du serveur.
 * · Il n'invente aucun coût. Le coût d'une écriture distante n'est pas mesurable
 *   d'ici — c'est dit avec ce mot, jamais avec un chiffre.
 */
import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox, CheckboxField } from '@/components/ui/checkbox'
import { Description, Label } from '@/components/ui/fieldset'
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Strong, Text } from '@/components/ui/text'

import {
  PROVISION_DRY_RUN,
  PROVISION_REAL,
  PUSH_DRY_RUN,
  PUSH_REAL,
  SANDBOX_DRY_RUN,
  SANDBOX_EXECUTE,
  describeStatus,
  readPushOutcome,
  type MutationCost,
  type MutationDescriptor,
  type PushResult,
} from './actions'
import { Note } from './atoms'

/* ═════════════════ Le contrat d'entrée ═════════════════ */

export interface DeliveryConsoleTarget {
  copilotId: string
  copilotName: string
  /** `null` ⇒ aucun projet : aucune route de livraison n'est adressable. */
  projectId: string | null
  /** `null` ⇒ aucun dépôt cible : une livraison est IMPOSSIBLE, pas « en attente ». */
  repoFullName: string | null
  /** `false` ⇒ la lecture du projet a échoué — distinct de « pas de projet ». */
  projectRead: boolean
  /**
   * Le serveur peut-il écrire réellement sur GitHub ? UN booléen, comme la route
   * `delivery-capability` — jamais le détail de quel verrou manque.
   */
  realDeliveryEnabled: boolean
}

/* ═════════════════ Le moteur d'appel ═════════════════ */

type Phase = 'idle' | 'running' | 'ok' | 'error'

interface Outcome {
  phase: Phase
  title: string
  /** Le détail renvoyé par la route, brut, jamais réécrit. */
  detail: string | null
  /** `true` quand la route a REFUSÉ délibérément (409/422), pas planté. */
  refused: boolean
  /**
   * L'issue de livraison telle que le SERVEUR l'a rapportée. `null` pour une
   * mutation qui n'est pas une livraison, ou tant qu'aucune réponse n'est là.
   */
  wrote: boolean | null
}

const IDLE: Outcome = { phase: 'idle', title: '', detail: null, refused: false, wrote: null }

/**
 * Une mutation en attente de confirmation.
 *
 * `realDescriptor` / `realBody` décrivent la variante qui ÉCRIT. Ils ne sont
 * jamais utilisés tant que l'opérateur n'a pas armé la confirmation, et le corps
 * par défaut ne porte pas `confirm` du tout.
 */
interface Pending {
  descriptor: MutationDescriptor
  path: string
  body: Record<string, unknown>
  /** La variante qui écrit réellement, quand la mutation en propose une. */
  realDescriptor?: MutationDescriptor
  realBody?: Record<string, unknown>
  /** Ce que l'action produira si elle réussit — affiché AVANT, pas après. */
  consequence: string
  /** `true` quand la réponse est un `PushResult` à interpréter. */
  isDelivery?: boolean
}

interface ActionButtonProps {
  job: Pending
  busy: boolean
  onOpen: (job: Pending) => void
  disabled?: boolean
  /** Pourquoi le bouton est éteint — la RAISON, jamais un bouton muet. */
  disabledReason?: string
}

type DeliveryConsoleProps = { target: DeliveryConsoleTarget }

type ConfirmBodyProps = {
  job: Pending
  armReal: boolean
  onArmReal: (v: boolean) => void
  realDeliveryEnabled: boolean
  repoFullName: string | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

function blockedDeliveryReason(target: DeliveryConsoleTarget): string | undefined {
  if (!target.projectRead) {
    return 'Le projet de cet agent n’a pas pu être LU : impossible de savoir s’il a un dépôt cible. Ce n’est pas « aucun dépôt » — c’est une ignorance, et on ne livre pas dans le doute.'
  }
  if (target.projectId === null) {
    return 'Cet agent n’est rattaché à aucun projet : il n’existe aucun dépôt vers lequel livrer.'
  }
  if (target.repoFullName === null) {
    return 'Le projet de cet agent n’a aucun dépôt GitHub lié. Une livraison est IMPOSSIBLE — la route répondrait 400.'
  }
  return undefined
}

function mutationCostColor(kind: MutationCost['kind']): 'emerald' | 'amber' | 'red' {
  if (kind === 'free') return 'emerald'
  if (kind === 'compute') return 'amber'
  return 'red'
}

function mutationCostLabel(kind: MutationCost['kind']): string {
  if (kind === 'free') return 'aucune écriture'
  if (kind === 'compute') return 'exécution longue'
  return 'écriture distante réelle'
}

function confirmDescription(
  isDelivery: boolean | undefined,
  realDeliveryEnabled: boolean,
): string {
  if (!isDelivery) return ''
  if (realDeliveryEnabled) {
    return 'Le verrou serveur est OUVERT : cette confirmation suffira à écrire réellement.'
  }
  return 'Le verrou serveur est FERMÉ : même confirmée, la route retombera en dry-run et le répondra. Rien ne sera écrit.'
}

type OutcomeNoteProps = { outcome: Outcome }

function OutcomeNote({ outcome }: OutcomeNoteProps) {
  if (outcome.phase === 'running') {
    return (
      <Note tone="info" title={outcome.title}>
        L’action est partie. Cette surface n’a pas de canal de progression : le résultat
        arrivera avec la réponse de la route.
      </Note>
    )
  }
  if (outcome.phase === 'ok') {
    return (
      <Note
        // Une écriture réelle est signalée en `warn`, pas en `info` : elle
        // a changé un dépôt qui ne nous appartient pas.
        tone={outcome.wrote === true ? 'warn' : 'info'}
        title={outcome.title}
      >
        {outcome.detail}
      </Note>
    )
  }
  const fallbackDetail = outcome.refused
    ? 'La route a refusé sans détail supplémentaire.'
    : 'Aucun détail n’a été renvoyé par la route.'
  return (
    <Note tone={outcome.refused ? 'warn' : 'blocked'} title={outcome.title}>
      {outcome.detail ?? fallbackDetail}
    </Note>
  )
}

/**
 * Un bouton qui OUVRE son dialogue — jamais une mutation en un clic.
 *
 * Déclaré au niveau module, et pas dans le rendu : un composant recréé à chaque
 * passe réinitialiserait son état (règle `react-hooks/static-components`).
 */
function ActionButton({ job, busy, onOpen, disabled, disabledReason }: ActionButtonProps) {
  const title = disabled ? disabledReason : job.descriptor.intent
  return (
    <Button type="button" outline disabled={disabled || busy} title={title} onClick={() => onOpen(job)}>
      {job.descriptor.label}
    </Button>
  )
}

export default function DeliveryConsole({ target }: DeliveryConsoleProps) {
  const router = useRouter()
  const [pending, setPending] = useState<Pending | null>(null)
  const [armReal, setArmReal] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)
  const [busy, setBusy] = useState(false)

  const close = useCallback(() => {
    if (busy) return
    setPending(null)
    // Le mode réel se DÉSARME à la fermeture : un dialogue rouvert repart en
    // dry-run, jamais sur l'armement précédent.
    setArmReal(false)
  }, [busy])

  const open = useCallback((next: Pending) => {
    setOutcome(IDLE)
    setArmReal(false)
    setPending(next)
  }, [])

  /**
   * Exécute la mutation. Une seule à la fois (`busy`), et la page est re-rendue
   * côté serveur au succès (`router.refresh()`) plutôt que d'ajuster un état
   * local — l'écran doit RELIRE la vérité, pas la deviner. C'est d'autant plus
   * vrai ici : ce qui a réellement été écrit sur un dépôt tiers ne se déduit pas
   * d'un état React.
   */
  const execute = useCallback(
    async (job: Pending, real: boolean) => {
      const descriptor = real && job.realDescriptor ? job.realDescriptor : job.descriptor
      const body = real && job.realBody ? job.realBody : job.body
      setBusy(true)
      setOutcome({ phase: 'running', title: `${descriptor.label}…`, detail: null, refused: false, wrote: null })
      try {
        const res = await fetch(job.path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body),
        })
        // La réponse peut ne pas être du JSON (proxy en amont, 504 de
        // plateforme) : ne jamais laisser un `.json()` jeter par-dessus le vrai
        // statut, qui est l'information utile.
        const payload: unknown = await res.json().catch(() => null)
        const message =
          payload && typeof payload === 'object' && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : null

        if (!res.ok) {
          setOutcome({
            phase: 'error',
            title: describeStatus(res.status),
            detail: message,
            // 409 et 422 sont des REFUS d'invariant, pas des pannes.
            refused: res.status === 409 || res.status === 422,
            wrote: null,
          })
          return
        }

        // Livraison : c'est le SERVEUR qui dit si une écriture a eu lieu. On lit
        // `dryRun` dans la réponse — jamais l'intention du clic.
        if (job.isDelivery && payload && typeof payload === 'object') {
          const read = readPushOutcome(payload as PushResult)
          setOutcome({
            phase: 'ok',
            title: read.title,
            detail: read.wrote
              ? 'Aigent s’arrête ici. Le merge, l’activation et le déploiement appartiennent au dépôt du consommateur, et Aigent n’a aucun canal pour les observer.'
              : 'Aucun commit, aucune branche, aucune PR n’a été créée. Rien n’a été persisté dans `agent_delivery_events` — seules les livraisons réelles y entrent.',
            refused: false,
            wrote: read.wrote,
          })
        } else {
          setOutcome({ phase: 'ok', title: job.consequence, detail: null, refused: false, wrote: null })
        }

        setPending(null)
        setArmReal(false)
        router.refresh()
      } catch (err) {
        // Panne réseau côté navigateur : l'action a PU partir. Le dire — sur une
        // écriture distante, c'est l'information la plus importante possible.
        setOutcome({
          phase: 'error',
          title: 'La requête n’a pas abouti côté navigateur.',
          detail: `${err instanceof Error ? err.message : 'erreur réseau'} — l’action a pu partir sans que sa réponse revienne. Relire l’état du dépôt cible AVANT de relancer : une seconde livraison sur une première qui a abouti produit un conflit de branche.`,
          refused: false,
          wrote: null,
        })
      } finally {
        setBusy(false)
      }
    },
    [router],
  )

  const projectBase = target.projectId
    ? '/api/agent-ops/projects/' + encodeURIComponent(target.projectId)
    : null
  const copilotBase = '/api/agent-ops/copilots/' + encodeURIComponent(target.copilotId)

  // La raison d'extinction, dans l'ordre de précision : une lecture ratée n'est
  // pas une absence de dépôt, et une absence de dépôt n'est pas une absence de
  // projet.
  const blockedReason = blockedDeliveryReason(target)
  const blocked = blockedReason !== undefined || projectBase === null

  return (
    <div className="flex flex-col gap-4">
      {/* ─── Ce que cet environnement peut réellement faire ─── */}
      {target.realDeliveryEnabled ? (
        <Note tone="warn" title="Écriture GitHub réelle possible sur ce serveur">
          Le verrou d’environnement est ouvert. Une livraison CONFIRMÉE écrira réellement sur{' '}
          <Strong>{target.repoFullName ?? 'le dépôt cible'}</Strong>. Le dry-run reste le mode par
          défaut de chaque formulaire ci-dessous, et la confirmation se désarme à chaque fermeture.
        </Note>
      ) : (
        <Note title="Shipping désactivé — toute livraison partira en dry-run">
          Une écriture GitHub réelle exige DEUX verrous : la confirmation de l’opérateur ET un verrou
          d’environnement côté serveur. Le second est fermé ici. Vous pouvez cocher la confirmation,
          la route retombera quand même en dry-run et le répondra honnêtement — l’écran affichera
          alors « dry-run », pas « livré ». Ce n’est pas une panne : c’est ce qui empêche une écriture
          accidentelle sur le dépôt d’un client.
        </Note>
      )}

      {blockedReason !== undefined ? (
        <Note tone="blocked" title="Aucune livraison n’est adressable pour cet agent">
          {blockedReason}
        </Note>
      ) : null}

      {/* ─── Livraison de l'agent ─── */}
      <section className="flex flex-col gap-2">
        <Strong>Livraison de l’agent</Strong>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            busy={busy}
            onOpen={open}
            disabled={blocked}
            disabledReason={blockedReason}
            job={{
              descriptor: PUSH_DRY_RUN,
              // `projectBase` est non-null dès que `blocked` est faux ; la garde
              // ci-dessous satisfait le typage sans masquer un cas réel.
              path: (projectBase ?? '') + '/push-agent',
              // PAS de `confirm` : la route calcule `dryRun = true` par
              // construction, quelle que soit la configuration du serveur.
              body: { copilotId: target.copilotId, deliveryMode: 'pull_request' },
              realDescriptor: PUSH_REAL,
              realBody: { copilotId: target.copilotId, deliveryMode: 'pull_request', confirm: true },
              consequence:
                'Le paquet de l’agent a été construit et validé. Rien n’a été écrit sur le dépôt cible.',
              isDelivery: true,
            }}
          />
        </div>
        <Text className="text-xs">
          La livraison exige une version PROMUE en production : une version brouillon est refusée par
          la route (422). C’est la maturité, pas l’interface, qui décide.
        </Text>
      </section>

      {/* ─── Sandbox du dépôt cible ─── */}
      <section className="flex flex-col gap-2">
        <Strong>Sandbox du dépôt cible</Strong>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            busy={busy}
            onOpen={open}
            disabled={blocked}
            disabledReason={blockedReason}
            job={{
              descriptor: SANDBOX_DRY_RUN,
              path: copilotBase + '/target-sandbox',
              body: { mode: 'dry_run' },
              realDescriptor: SANDBOX_EXECUTE,
              realBody: { mode: 'execute', installMode: 'auto' },
              consequence:
                'Rapport de sandbox produit et persisté. Aucune écriture sur le dépôt cible.',
            }}
          />
        </div>
        <Text className="text-xs">
          Le mode « execute » clone le dépôt dans un espace jetable et exécute ses propres scripts. Il
          n’écrit jamais sur le dépôt distant — c’est une exécution, pas une livraison.
        </Text>
      </section>

      {/* ─── Provisioning du workspace consommateur ─── */}
      <section className="flex flex-col gap-2">
        <Strong>Provisioning du workspace consommateur</Strong>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            busy={busy}
            onOpen={open}
            disabled={blocked}
            disabledReason={blockedReason}
            job={{
              descriptor: PROVISION_DRY_RUN,
              path: (projectBase ?? '') + '/provision-consumer',
              body: { deliveryMode: 'pull_request' },
              realDescriptor: PROVISION_REAL,
              realBody: { deliveryMode: 'pull_request', confirm: true },
              consequence:
                'Le pack d’accueil consommateur a été construit et listé. Rien n’a été écrit sur le dépôt cible.',
              isDelivery: true,
            }}
          />
        </div>
        <Text className="text-xs">
          Le pack installe le canal de retour (registre, bindings, client de télémétrie). Il n’active
          aucun agent : activer, rebinder et déployer sont des gestes du consommateur, qu’Aigent ne
          voit pas.
        </Text>
      </section>

      {/* ─── Résultat de la dernière action ─── */}
      {outcome.phase !== 'idle' ? (
        <div aria-live="polite">
          <OutcomeNote outcome={outcome} />
        </div>
      ) : null}

      {/* ─── Le dialogue de confirmation ─── */}
      <Dialog open={pending !== null} onClose={close} size="xl">
        {pending ? (
          <ConfirmBody
            job={pending}
            armReal={armReal}
            onArmReal={setArmReal}
            realDeliveryEnabled={target.realDeliveryEnabled}
            repoFullName={target.repoFullName}
            busy={busy}
            onCancel={close}
            onConfirm={() => void execute(pending, armReal)}
          />
        ) : null}
      </Dialog>
    </div>
  )
}

/* ═════════════════ Le corps du dialogue ═════════════════ */

/**
 * Ce qui va être fait, sur QUELLE CIBLE, ce que ça coûte, ce que ça produira —
 * AVANT le clic.
 *
 * LA CIBLE EST AFFICHÉE, TOUJOURS. Une mutation irréversible sur un dépôt tiers
 * sans le nom du dépôt sous les yeux est exactement le geste qu'on regrette.
 *
 * La confirmation ne se préarme jamais, et son libellé dit ce que l'écriture
 * réelle implique. Quand le verrou serveur est fermé, la case reste offerte —
 * mais l'encadré dit franchement que la route retombera en dry-run. Griser la
 * case laisserait croire que le verrou client suffit d'habitude.
 */
function ConfirmBody({
  job,
  armReal,
  onArmReal,
  realDeliveryEnabled,
  repoFullName,
  busy,
  onCancel,
  onConfirm,
}: ConfirmBodyProps) {
  const effective = armReal && job.realDescriptor ? job.realDescriptor : job.descriptor
  const costColor = mutationCostColor(effective.cost.kind)
  const costLabel = mutationCostLabel(effective.cost.kind)

  // La vérité opérationnelle : armer la confirmation ne suffit pas si le verrou
  // serveur est fermé. On le dit AVANT, pas après la réponse.
  const wouldActuallyWrite = armReal && realDeliveryEnabled

  return (
    <>
      <DialogTitle>{effective.label}</DialogTitle>
      <DialogDescription>{effective.intent}</DialogDescription>
      <DialogBody>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={costColor}>{costLabel}</Badge>
            {job.realDescriptor ? (
              <Badge
                color={armReal ? 'amber' : 'sky'}
                title="Toute livraison proposée par cette surface s’ouvre en dry-run. Le mode réel est un choix explicite."
              >
                {armReal ? 'mode réel armé' : 'dry-run (défaut)'}
              </Badge>
            ) : null}
          </div>

          {/* LA CIBLE — jamais implicite sur une écriture distante. */}
          <div className="rounded-md border border-zinc-950/10 bg-zinc-950/2.5 px-3 py-2 dark:border-white/10 dark:bg-white/2.5">
            <Text className="text-xs">Dépôt cible</Text>
            <Text className="mt-0.5">
              <Strong>{repoFullName ?? 'aucun dépôt cible résolu'}</Strong>
            </Text>
          </div>

          <Text>{effective.cost.detail}</Text>

          <div className="rounded-md border border-zinc-950/10 bg-zinc-950/2.5 px-3 py-2 dark:border-white/10 dark:bg-white/2.5">
            <Text className="text-xs">Ce que cette action NE fait PAS</Text>
            <Text className="mt-0.5">{effective.doesNot}</Text>
          </div>

          <div className="rounded-md border border-zinc-950/10 bg-zinc-950/2.5 px-3 py-2 dark:border-white/10 dark:bg-white/2.5">
            <Text className="text-xs">Si l’action réussit</Text>
            <Text className="mt-0.5">{job.consequence}</Text>
          </div>

          {job.realDescriptor ? (
            <CheckboxField>
              <Checkbox name="confirm" checked={armReal} onChange={onArmReal} disabled={busy} />
              <Label>
                {job.isDelivery ? 'Demander une écriture RÉELLE' : 'Exécuter réellement les scripts du dépôt'}
              </Label>
              <Description>
                {job.realDescriptor.cost.detail}{' '}
                {confirmDescription(job.isDelivery, realDeliveryEnabled)}
              </Description>
            </CheckboxField>
          ) : null}

          {/* Ce qui va RÉELLEMENT se passer, en une phrase, juste au-dessus du
              bouton. C'est la dernière chose lue avant le clic. */}
          {job.isDelivery ? (
            <Note
              tone={wouldActuallyWrite ? 'warn' : 'info'}
              title={
                wouldActuallyWrite
                  ? 'Cette action écrira réellement sur un dépôt tiers'
                  : 'Cette action n’écrira rien'
              }
            >
              {wouldActuallyWrite
                ? 'Une pull request sera ouverte sur le dépôt cible. Après cela, Aigent ne saura plus rien : ni si elle est mergée, ni si l’agent est activé.'
                : 'Le paquet sera construit et validé, puis jeté. Aucun commit, aucune branche, aucune PR.'}
            </Note>
          ) : null}

          {/* Le coût, dit honnêtement : il n'est pas mesurable d'ici. */}
          <Text className="text-xs">
            Coût : <Strong>non mesuré</Strong>. Cette surface n’a aucun moyen de chiffrer une écriture
            distante ou une exécution de scripts dans un dépôt tiers — elle ne l’estime donc pas.
          </Text>
        </div>
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onCancel} disabled={busy}>
          Annuler
        </Button>
        {/* Une action sans écriture est neutre ; tout ce qui écrit à distance
            porte le bouton ROUGE. Deux branches distinctes : `color` et
            `outline` de Catalyst s'excluent. */}
        {effective.cost.kind === 'free' ? (
          <Button outline onClick={onConfirm} disabled={busy}>
            {busy ? 'En cours…' : effective.label}
          </Button>
        ) : (
          <Button color="red" onClick={onConfirm} disabled={busy}>
            {busy ? 'En cours…' : effective.label}
          </Button>
        )}
      </DialogActions>
    </>
  )
}
