'use client'

/**
 * Le POSTE DE COMMANDE de la qualification — le seul composant client de cette
 * surface, et le seul qui mute.
 *
 * POURQUOI UN `fetch` ET PAS UNE SERVER ACTION
 * --------------------------------------------
 * Une Server Action POSTe vers la route de la PAGE. `/qualification/...` n'est
 * pas sous `/api/agent-ops/**`, donc pas dans le `matcher` de `src/proxy.ts` :
 * ce serait une quatrième frontière de confiance, mutante et non gardée, ouverte
 * par simple commodité d'écriture. Toutes les mutations partent donc d'ici en
 * `fetch` vers des routes `/api/agent-ops/**` déjà gardées par le proxy, avec
 * `credentials: 'same-origin'` pour que le cookie de session HMAC voyage.
 *
 * CE QUE CE COMPOSANT NE FAIT PAS
 * -------------------------------
 * · Il ne recalcule AUCUN statut. `canRun`, `promotable`, les états de la gate :
 *   tout arrive déjà dérivé du serveur. Recalculer ici, c'est promettre à
 *   l'écran ce que l'API refusera.
 * · Il ne contourne rien. La promotion passe par la route, qui ré-évalue la
 *   gate, qui persiste l'évaluation, que la RPC transactionnelle relit avant
 *   d'écrire. Trois verrous que cette interface se contente de déclencher.
 * · Il ne lance jamais rien en LIVE par défaut. Chaque exécution s'ouvre en
 *   fixture / dry-run ; passer en live est une case à cocher explicite dans le
 *   dialogue de confirmation.
 *
 * ÉTATS : chaque action porte `idle` / `running` / `ok` / `error`, et une erreur
 * distingue le CODE (invariant refusé vs panne) du détail renvoyé par la route.
 */
import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox, CheckboxField } from '@/components/ui/checkbox'
import { Description, Field, Label } from '@/components/ui/fieldset'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Divider } from '@/components/ui/divider'
import { Strong, Text } from '@/components/ui/text'
import {
  ANALYZE,
  CREATE_V2,
  DECIDE_APPROVE,
  DECIDE_REJECT,
  GENERATE_SUITE,
  PROMOTE,
  ROLLBACK,
  RUN_BENCHMARK,
  RUN_QUALIFICATION,
  RUN_REPLAY_FIXTURE,
  RUN_REPLAY_LIVE,
  RUN_SHADOW_FIXTURE,
  RUN_SHADOW_LIVE,
  RUN_SWEEP,
  RUN_TESTS,
  describeStatus,
  type MutationDescriptor,
  type MutationCost,
} from './actions'
import { Note } from './atoms'
// Le parseur de modèles est une règle PURE (et une décision de coût : une ligne
// mal formée n'est jamais devinée). Il vit dans `model.ts`, où il se teste sans
// DOM — ce composant se contente de l'appeler.
import { parseModelList } from './model'

/* ─────────────────── Le contrat d'entrée ─────────────────── */

export interface ConsoleTarget {
  copilotId: string
  /** La version candidate résolue par le serveur. `null` ⇒ rien à qualifier. */
  candidateVersionId: string | null
  candidateLabel: string | null
  /**
   * Le registre des suites a-t-il été LU ?
   *
   * `false` ⇒ `testSuiteId` / `benchmarkSuiteId` sont `null` par IGNORANCE, pas
   * parce qu'aucune suite n'existe. La distinction est la seule qui coûte de
   * l'argent réel sur cette surface : sans elle, une panne de lecture rallumait
   * « Générer la suite », c'est-à-dire une génération LLM facturée de suites
   * probablement déjà présentes.
   */
  suitesRead: boolean
  /**
   * La génération de suites — FACTURÉE — est-elle légitime ?
   *
   * Dérivé serveur (`canGenerateSuites`), jamais recalculé ici. `false` sur un
   * registre non lu : dans le doute, l'action qui coûte de l'argent reste éteinte.
   */
  canGenerateSuites: boolean
  /** La suite de test à exécuter. `null` ⇒ aucune suite n'existe encore (si `suitesRead`). */
  testSuiteId: string | null
  benchmarkSuiteId: string | null
  /** Le registre des versions a-t-il été lu ? (cible de retour arrière) */
  versionsRead: boolean
  /** Pointeur de production, tel que lu. `null` ⇒ aucune baseline. */
  productionVersionId: string | null
  /** La lecture du pointeur de production a-t-elle réussi ? */
  productionRead: boolean
  /** Une version archivée vers laquelle un retour arrière est possible. */
  rollbackTargetId: string | null
  rollbackTargetLabel: string | null
  /** État de la boucle d'amélioration, dérivé serveur. */
  openProposalId: string | null
  proposalId: string | null
  proposalStatus: string | null
  /** La gate serveur dit-elle ce candidat promouvable ? Jamais recalculé ici. */
  promotable: boolean
  /**
   * Les raisons concrètes pour lesquelles un run serait refusé — la liste
   * produite côté serveur depuis le contrat canonique. Vide ⇒ la garde
   * accepterait.
   */
  runBlockers: string[]
}

/* ─────────────────── Le moteur d'appel ─────────────────── */

type Phase = 'idle' | 'running' | 'ok' | 'error'

interface Outcome {
  phase: Phase
  /** Le titre du résultat — jamais un code nu. */
  title: string
  /** Le détail renvoyé par la route, brut, jamais réécrit. */
  detail: string | null
  /** `true` quand la route a REFUSÉ délibérément (409/422), pas planté. */
  refused: boolean
}

const IDLE: Outcome = { phase: 'idle', title: '', detail: null, refused: false }

/**
 * Le corps d'une mutation, avec son mode d'exécution.
 *
 * `live` n'est jamais implicite : quand une mutation propose les deux modes, le
 * descripteur live est un objet DIFFÉRENT du descripteur fixture, choisi par
 * l'opérateur dans le dialogue.
 */
interface Pending {
  descriptor: MutationDescriptor
  path: string
  body: Record<string, unknown>
  /** Le descripteur alternatif en mode live, quand la mutation en propose un. */
  liveDescriptor?: MutationDescriptor
  /** Le corps à envoyer si l'opérateur arme le mode live. */
  liveBody?: Record<string, unknown>
  /** Ce que l'action produira si elle réussit — affiché avant, pas après. */
  consequence: string
  /**
   * `true` quand la mutation exige que l'opérateur NOMME les modèles à balayer.
   *
   * Le balayage n'a pas de liste par défaut, et il ne doit pas en avoir : cette
   * surface n'a aucune source de vérité sur « les modèles à comparer », et en
   * fabriquer une reviendrait à proposer jusqu'à huit exécutions facturées que
   * personne n'a choisies. Les modèles sont donc saisis, un par ligne, dans le
   * dialogue — le champ vide laisse le bouton de confirmation éteint.
   */
  needsModels?: boolean
}

interface ActionButtonProps {
  job: Pending
  busy: boolean
  onOpen: (job: Pending) => void
  disabled?: boolean
  /** Pourquoi le bouton est éteint — la RAISON, jamais un bouton muet. */
  disabledReason?: string
  color?: 'red' | 'zinc'
}

type QualificationConsoleProps = { target: ConsoleTarget }

type ConfirmBodyProps = {
  job: Pending
  armLive: boolean
  onArmLive: (v: boolean) => void
  models: string
  onModels: (v: string) => void
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

function mutationCostColor(kind: MutationCost['kind']): 'emerald' | 'amber' | 'red' {
  if (kind === 'free') return 'emerald'
  if (kind === 'billed') return 'amber'
  return 'red'
}

function mutationCostLabel(kind: MutationCost['kind']): string {
  if (kind === 'free') return 'aucun coût'
  if (kind === 'billed') return 'exécution facturée'
  return 'écriture irréversible'
}

function suiteGenerateDisabledReason(target: ConsoleTarget): string {
  if (!target.suitesRead) {
    return 'Le registre des suites n’a pas pu être lu : impossible de savoir si des suites existent déjà. La génération est facturée — elle reste éteinte tant que la lecture n’a pas abouti, plutôt que de payer pour regénérer ce qui existe peut-être.'
  }
  return 'Des suites existent déjà pour ce copilot — la génération est idempotente et ne referait rien.'
}

function suiteRunDisabledReason(target: ConsoleTarget): string {
  if (!target.suitesRead) {
    return 'Le registre des suites n’a pas pu être lu : aucune suite à exécuter n’est identifiable. Ce n’est pas « aucune suite n’existe ».'
  }
  return 'Aucune suite de test n’existe : il n’y a rien à exécuter. Générer la suite d’abord.'
}

function benchmarkRunDisabledReason(target: ConsoleTarget): string {
  if (!target.suitesRead) {
    return 'Le registre des suites n’a pas pu être lu : aucune suite de benchmark n’est identifiable. Ce n’est pas « aucune suite n’existe ».'
  }
  return 'Aucune suite de benchmark n’existe pour ce copilot.'
}

function benchmarkSweepDisabledReason(target: ConsoleTarget): string {
  if (!target.suitesRead) {
    return 'Le registre des suites n’a pas pu être lu : aucune suite à balayer n’est identifiable. Un balayage est la mutation la plus coûteuse de cette surface — il ne part pas sur une ignorance.'
  }
  return 'Aucune suite de benchmark n’existe pour ce copilot — il n’y a rien à balayer.'
}

function replayDisabledReason(
  version: string | null,
  target: ConsoleTarget,
): string {
  if (version === null) {
    return 'Aucune version candidate ne résout pour ce copilot.'
  }
  if (target.productionRead) {
    return 'Aucune version de production n’existe : le replay n’a rien à comparer et la route refuse de partir (409). Ce n’est pas un replay échoué — c’est une dépendance circulaire, il faut une première promotion pour créer la baseline.'
  }
  return 'Le pointeur de production n’a pas pu être lu — impossible de dire si un replay serait possible.'
}

function promoteDisabledReason(version: string | null): string {
  if (version === null) {
    return 'Aucune version candidate ne résout pour ce copilot.'
  }
  return 'La gate serveur ne dit pas ce candidat promouvable. Le bouton suit la gate — il ne la devance pas, et le serveur la ré-évaluerait de toute façon avant d’écrire.'
}

function rollbackDisabledReason(target: ConsoleTarget): string {
  if (!target.versionsRead) {
    return 'Le registre des versions n’a pas pu être lu : aucune cible de retour arrière n’est identifiable. Ce n’est pas « aucune version archivée n’existe ».'
  }
  return 'Aucune version archivée n’existe : il n’y a aucune version précédemment servie vers laquelle revenir. La route refuse toute cible qui ne soit pas archivée — c’est ce qui empêche un brouillon non qualifié d’atteindre la production par ce chemin.'
}

function rejectDisabledReason(target: ConsoleTarget): string {
  if (target.proposalId === null) {
    return 'Aucune proposition n’existe pour ce copilot.'
  }
  return 'Cette proposition est déjà décidée — une décision ne se rejoue pas (409).'
}

function modelsSelectionSummary(
  parsedModels: { modelProvider: string; model: string }[],
): string {
  if (parsedModels.length === 0) {
    return 'Aucune ligne valide — le balayage ne peut pas partir.'
  }
  const listed = parsedModels.map((m) => m.modelProvider + ':' + m.model).join(', ')
  return parsedModels.length + ' modèle(s) retenu(s) : ' + listed
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
    return <Note tone="info" title={outcome.title} />
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
 *
 * Les deux variantes sont rendues dans des branches JSX distinctes parce que
 * `ButtonProps` de Catalyst est une union discriminée : `color` et `outline`
 * s'excluent. On n'altère pas le kit — on l'appelle correctement.
 *
 * Un bouton désactivé porte TOUJOURS sa raison en `title` : « ce bouton ne
 * marche pas » sans explication est précisément ce qui envoie un opérateur
 * chercher une panne là où il n'y a qu'un invariant.
 */
function ActionButton({ job, busy, onOpen, disabled, disabledReason, color }: ActionButtonProps) {
  const title = disabled ? disabledReason : job.descriptor.intent
  const isDisabled = disabled || busy
  if (color) {
    return (
      <Button type="button" color={color} disabled={isDisabled} title={title} onClick={() => onOpen(job)}>
        {job.descriptor.label}
      </Button>
    )
  }
  return (
    <Button type="button" outline disabled={isDisabled} title={title} onClick={() => onOpen(job)}>
      {job.descriptor.label}
    </Button>
  )
}

export default function QualificationConsole({ target }: QualificationConsoleProps) {
  const router = useRouter()
  const [pending, setPending] = useState<Pending | null>(null)
  const [armLive, setArmLive] = useState(false)
  const [models, setModels] = useState('')
  const [outcome, setOutcome] = useState<Outcome>(IDLE)
  const [busy, setBusy] = useState(false)

  const close = useCallback(() => {
    if (busy) return
    setPending(null)
    // Le mode live se DÉSARME à la fermeture : un dialogue rouvert repart en
    // fixture, jamais sur l'armement précédent.
    setArmLive(false)
    setModels('')
  }, [busy])

  const open = useCallback((next: Pending) => {
    setOutcome(IDLE)
    setArmLive(false)
    setModels('')
    setPending(next)
  }, [])

  /**
   * Exécute la mutation. Une seule à la fois (`busy`), et la page est
   * re-rendue côté serveur au succès (`router.refresh()`) plutôt que d'ajuster
   * un état local — l'écran doit relire la vérité, pas la deviner.
   */
  const execute = useCallback(
    async (job: Pending, live: boolean, modelList: string) => {
      const descriptor = live && job.liveDescriptor ? job.liveDescriptor : job.descriptor
      const baseBody = live && job.liveBody ? job.liveBody : job.body
      // La liste de modèles n'est ajoutée QUE si la mutation la réclame, et
      // seulement telle que l'opérateur l'a saisie — aucune valeur par défaut.
      const body = job.needsModels ? { ...baseBody, models: parseModelList(modelList) } : baseBody
      setBusy(true)
      setOutcome({ phase: 'running', title: `${descriptor.label}…`, detail: null, refused: false })
      try {
        const res = await fetch(job.path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Le cookie de session HMAC est ce que `src/proxy.ts` vérifie.
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
            // 409 et 422 sont des REFUS d'invariant, pas des pannes : le produit
            // fonctionne exactement comme prévu.
            refused: res.status === 409 || res.status === 422,
          })
          return
        }
        setOutcome({ phase: 'ok', title: job.consequence, detail: null, refused: false })
        setPending(null)
        setArmLive(false)
        setModels('')
        router.refresh()
      } catch (err) {
        // Panne réseau côté navigateur : l'action a PU partir. Le dire.
        setOutcome({
          phase: 'error',
          title: 'La requête n’a pas abouti côté navigateur.',
          detail: `${err instanceof Error ? err.message : 'erreur réseau'} — l’action a pu partir sans que sa réponse revienne. Relire l’état avant de relancer.`,
          refused: false,
        })
      } finally {
        setBusy(false)
      }
    },
    [router],
  )

  const base = '/api/agent-ops/copilots/' + encodeURIComponent(target.copilotId)
  const version = target.candidateVersionId

  return (
    <div className="flex flex-col gap-4">
      {/* ─── Ce que la garde d'exécution refuserait ─── */}
      {target.runBlockers.length > 0 ? (
        <Note tone="blocked" title={`La garde d’exécution refuserait un lancement — ${target.runBlockers.length} raison(s)`}>
          Les trois conditions doivent tenir ensemble : statut « active », aucun outil non résolu,
          runtime « langgraph ». Les actions qui exécutent réellement l’agent restent proposées, mais
          la route répondra 409 avec ces mêmes raisons — l’écran ne masque pas un refus qu’il ne
          contrôle pas.
        </Note>
      ) : null}

      {/* ─── Suites & exécutions ─── */}
      <section className="flex flex-col gap-2">
        <Strong>Tests & benchmarks</Strong>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            busy={busy}
            onOpen={open}
            job={{
              descriptor: GENERATE_SUITE,
              path: `${base}/tests/generate`,
              body: {},
              consequence:
                'Suite de tests et suite de benchmark générées et persistées. Rien n’a été exécuté.',
            }}
            // Dans le doute, l'action FACTURÉE reste éteinte. Un registre non
            // lu ne prouve pas qu'aucune suite n'existe, et payer une
            // génération LLM sur cette ignorance est le seul geste de cette
            // surface qui coûte réellement de l'argent. La règle vient du
            // serveur (`canGenerateSuites`) — elle n'est pas rejouée ici.
            disabled={!target.canGenerateSuites}
            disabledReason={suiteGenerateDisabledReason(target)}
          />
          <ActionButton
            busy={busy}
            onOpen={open}
            job={{
              descriptor: RUN_TESTS,
              path: `${base}/tests/run`,
              body: { suiteId: target.testSuiteId, versionId: version ?? undefined },
              consequence: 'Suite exécutée : test_runs et test_results persistés.',
            }}
            disabled={target.testSuiteId === null}
            disabledReason={suiteRunDisabledReason(target)}
          />
          <ActionButton
            busy={busy}
            onOpen={open}
            job={{
              descriptor: RUN_BENCHMARK,
              path: `${base}/benchmarks/run`,
              body: { suiteId: target.benchmarkSuiteId, versionId: version ?? undefined },
              consequence: 'Benchmark exécuté : benchmark_runs et benchmark_results persistés.',
            }}
            disabled={target.benchmarkSuiteId === null}
            disabledReason={benchmarkRunDisabledReason(target)}
          />
          <ActionButton
            busy={busy}
            onOpen={open}
            job={{
              descriptor: RUN_SWEEP,
              path: `${base}/benchmarks/sweep`,
              // Les modèles sont SAISIS dans le dialogue : cette surface n'a
              // aucune source de vérité sur « les modèles à comparer », et en
              // fabriquer une reviendrait à proposer jusqu'à huit exécutions
              // facturées que personne n'a choisies.
              body: { suiteId: target.benchmarkSuiteId, versionId: version ?? undefined },
              needsModels: true,
              consequence: 'Balayage terminé : un verdict par modèle, jamais un score fabriqué.',
            }}
            disabled={target.benchmarkSuiteId === null}
            disabledReason={benchmarkSweepDisabledReason(target)}
          />
        </div>
      </section>

      <Divider soft />

      {/* ─── Qualification orchestrée ─── */}
      <section className="flex flex-col gap-2">
        <Strong>Qualification orchestrée</Strong>
        <Text>
          Le parcours tests → benchmark → shadow → replay → gate s’arrête à la gate. Il ne promeut
          jamais : « promouvable » est un état, pas un acte.
        </Text>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            busy={busy}
            onOpen={open}
            job={{
              descriptor: RUN_QUALIFICATION,
              path: `${base}/qualification`,
              body: { versionId: version, action: 'sweep' },
              consequence:
                'Parcours de qualification terminé — la gate a tranché. Aucune promotion n’a eu lieu.',
            }}
            disabled={version === null}
            disabledReason="Aucune version candidate ne résout pour ce copilot."
          />
          <ActionButton
            busy={busy}
            onOpen={open}
            job={{
              descriptor: { ...RUN_QUALIFICATION, label: 'Avancer d’une étape' },
              path: `${base}/qualification`,
              body: { versionId: version, action: 'advance' },
              consequence: 'Étape suivante exécutée, curseur avancé.',
            }}
            disabled={version === null}
            disabledReason="Aucune version candidate ne résout pour ce copilot."
          />
        </div>
      </section>

      <Divider soft />

      {/* ─── Shadow & replay ─── */}
      <section className="flex flex-col gap-2">
        <Strong>Shadow & replay</Strong>
        <Text>
          Fixture par défaut. Le mode live est un choix explicite, armé dans le dialogue de
          confirmation — et c’est le seul mode qu’une gate exigeante accepte.
        </Text>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            busy={busy}
            onOpen={open}
            job={{
              descriptor: RUN_SHADOW_FIXTURE,
              path: `${base}/versions/${encodeURIComponent(version ?? '')}/shadow`,
              body: { useFixture: true },
              liveDescriptor: RUN_SHADOW_LIVE,
              liveBody: { useFixture: false },
              consequence:
                'Expérience shadow terminée et persistée, avec son mode d’exécution réel enregistré.',
            }}
            disabled={version === null}
            disabledReason="Aucune version candidate ne résout pour ce copilot."
          />
          <ActionButton
            busy={busy}
            onOpen={open}
            job={{
              descriptor: RUN_REPLAY_FIXTURE,
              path: `${base}/versions/${encodeURIComponent(version ?? '')}/replay`,
              body: { useFixture: true },
              liveDescriptor: RUN_REPLAY_LIVE,
              liveBody: { useFixture: false },
              consequence: 'Comparaison replay terminée et persistée.',
            }}
            disabled={version === null || target.productionVersionId === null}
            disabledReason={replayDisabledReason(version, target)}
          />
        </div>
      </section>

      <Divider soft />

      {/* ─── Promotion ─── */}
      <section className="flex flex-col gap-2">
        <Strong>Promotion</Strong>
        <Text>
          Aucune promotion automatique n’existe. La RPC <code>promote_copilot_version</code> est
          l’unique voie, verrouillée en base à trois niveaux ; cette interface la déclenche, elle ne
          la contourne pas.
        </Text>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            busy={busy}
            onOpen={open}
            color="red"
            job={{
              descriptor: PROMOTE,
              path: `${base}/promotion`,
              body: {
                action: 'promote',
                versionId: version,
                previousProductionVersionId: target.productionVersionId,
              },
              // Même règle que le retour arrière : la version promue est
              // NOMMÉE dans la confirmation, pas laissée à la mémoire.
              consequence: target.candidateLabel
                ? `Version ${target.candidateLabel} promue en production : la précédente est archivée et le pointeur du copilot est déplacé.`
                : 'Version promue en production : la précédente est archivée et le pointeur du copilot est déplacé.',
            }}
            disabled={version === null || !target.promotable}
            disabledReason={promoteDisabledReason(version)}
          />
          <ActionButton
            busy={busy}
            onOpen={open}
            color="red"
            job={{
              descriptor: ROLLBACK,
              path: `${base}/promotion`,
              body: {
                action: 'rollback',
                versionId: target.rollbackTargetId,
                previousProductionVersionId: target.productionVersionId,
              },
              // La conséquence NOMME la version cible : « revenir en arrière »
              // sans dire vers quoi est exactement le genre de confirmation
              // qu'on signe sans lire.
              consequence: target.rollbackTargetLabel
                ? `Production revenue à la version ${target.rollbackTargetLabel}, précédemment servie.`
                : 'Production revenue à la version précédemment servie.',
            }}
            disabled={target.rollbackTargetId === null}
            disabledReason={rollbackDisabledReason(target)}
          />
        </div>
      </section>

      <Divider soft />

      {/* ─── Boucle d'amélioration & décision humaine ─── */}
      <section className="flex flex-col gap-2">
        <Strong>Boucle d’amélioration · décision humaine</Strong>
        {target.openProposalId ? (
          <Note tone="info" title="Une boucle d’amélioration est déjà ouverte">
            La base n’en tolère qu’une seule par copilot : une nouvelle analyse serait refusée (409).
            Ce n’est pas une erreur — c’est l’invariant qui vous demande de DÉCIDER celle-ci d’abord.
          </Note>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <ActionButton
            busy={busy}
            onOpen={open}
            job={{
              descriptor: ANALYZE,
              path: `${base}/improve/analyze`,
              body: { triggeredBy: 'operator' },
              consequence: 'Analyse terminée : une proposition d’amélioration a été persistée.',
            }}
            disabled={target.openProposalId !== null}
            disabledReason="Une boucle est déjà ouverte pour ce copilot. Décidez-la avant d’en ouvrir une autre."
          />
          <ActionButton
            busy={busy}
            onOpen={open}
            job={{
              descriptor: CREATE_V2,
              path: `${base}/improve/create-v2`,
              body: { proposalId: target.proposalId },
              consequence:
                'V2 matérialisée en brouillon, assistant re-provisionné. Rien n’est promu.',
            }}
            disabled={target.proposalStatus !== 'proposed'}
            disabledReason="La matérialisation n’est possible que sur une proposition à l’état « proposée »."
          />
          <ActionButton
            busy={busy}
            onOpen={open}
            job={{
              descriptor: DECIDE_APPROVE,
              path: `${base}/improve/decision`,
              body: { proposalId: target.proposalId, decision: 'approved', decidedBy: 'operator' },
              consequence: 'Décision humaine enregistrée : boucle approuvée. Rien n’a été promu.',
            }}
            disabled={target.proposalStatus !== 'v2-created'}
            disabledReason="Une approbation exige que la V2 existe déjà : la route refuse une approbation sans V2 (409)."
          />
          <ActionButton
            busy={busy}
            onOpen={open}
            color="zinc"
            job={{
              descriptor: DECIDE_REJECT,
              path: `${base}/improve/decision`,
              body: { proposalId: target.proposalId, decision: 'rejected', decidedBy: 'operator' },
              consequence: 'Décision humaine enregistrée : boucle rejetée.',
            }}
            disabled={target.proposalId === null || target.proposalStatus === 'approved' || target.proposalStatus === 'rejected'}
            disabledReason={rejectDisabledReason(target)}
          />
        </div>
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
            armLive={armLive}
            onArmLive={setArmLive}
            models={models}
            onModels={setModels}
            busy={busy}
            onCancel={close}
            onConfirm={() => void execute(pending, armLive, models)}
          />
        ) : null}
      </Dialog>
    </div>
  )
}

/* ─────────────────── Le corps du dialogue ─────────────────── */

/**
 * Ce qui va être fait, ce que ça coûte, ce que ça produira — AVANT le clic.
 *
 * Le mode live n'est jamais préarmé : la case s'ouvre décochée, et son libellé
 * dit ce que le live coûte réellement. C'est la traduction littérale de la règle
 * « pas de mutation facturée en un clic ».
 */
function ConfirmBody({
  job,
  armLive,
  onArmLive,
  models,
  onModels,
  busy,
  onCancel,
  onConfirm,
}: ConfirmBodyProps) {
  const effective = armLive && job.liveDescriptor ? job.liveDescriptor : job.descriptor
  // Les lignes RETENUES, pas les lignes saisies : une ligne mal formée est
  // silencieusement écartée du corps, donc elle doit l'être aussi du compte
  // affiché — sinon l'opérateur croit balayer huit modèles et en balaie trois.
  const parsedModels = job.needsModels ? parseModelList(models) : []
  // Une mutation qui exige des modèles reste inconfirmable tant qu'aucune ligne
  // valide n'est saisie : la route répondrait 400, autant le dire ici.
  const blockedOnModels = job.needsModels === true && parsedModels.length === 0
  const costColor = mutationCostColor(effective.cost.kind)
  const costLabel = mutationCostLabel(effective.cost.kind)

  return (
    <>
      <DialogTitle>{effective.label}</DialogTitle>
      <DialogDescription>{effective.intent}</DialogDescription>
      <DialogBody>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={costColor}>{costLabel}</Badge>
            {job.liveDescriptor ? (
              <Badge
                color={armLive ? 'amber' : 'sky'}
                title="Toute exécution proposée par cette surface s’ouvre en fixture. Le live est un choix explicite."
              >
                {armLive ? 'mode live armé' : 'mode fixture (défaut)'}
              </Badge>
            ) : null}
          </div>

          <Text>{effective.cost.detail}</Text>

          <div className="rounded-md border border-zinc-950/10 bg-zinc-950/2.5 px-3 py-2 dark:border-white/10 dark:bg-white/2.5">
            <Text className="text-xs">Si l’action réussit</Text>
            <Text className="mt-0.5">{job.consequence}</Text>
          </div>

          {job.liveDescriptor ? (
            <CheckboxField>
              <Checkbox
                name="live"
                checked={armLive}
                onChange={onArmLive}
                disabled={busy}
              />
              <Label>Passer en exécution LIVE</Label>
              <Description>
                {job.liveDescriptor.cost.detail} La fixture reste le défaut : décocher revient à une
                preuve à coût nul, qui ne débloque aucune promotion.
              </Description>
            </CheckboxField>
          ) : null}

          {/* Le balayage n'a AUCUNE liste par défaut, et n'en aura pas : les
              modèles sont nommés ici, ligne par ligne. Un champ vide laisse la
              confirmation éteinte plutôt que de partir sur une liste inventée. */}
          {job.needsModels ? (
            <Field>
              <Label>Modèles à balayer</Label>
              <Description>
                Une paire <code>provider:modèle</code> par ligne — par exemple{' '}
                <code>openai:gpt-4o-mini</code>. Providers acceptés :{' '}
                <code>openai</code>, <code>google</code>, <code>local</code>. Huit au maximum, et
                chaque ligne est une exécution complète de la suite, facturée séparément. Une ligne
                mal formée est écartée : elle n’est ni devinée ni envoyée.
              </Description>
              <Textarea
                name="models"
                rows={4}
                value={models}
                disabled={busy}
                onChange={(event) => onModels(event.target.value)}
              />
              <Text className="mt-1 text-xs">{modelsSelectionSummary(parsedModels)}</Text>
            </Field>
          ) : null}
        </div>
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onCancel} disabled={busy}>
          Annuler
        </Button>
        {/* Une action gratuite est neutre ; tout ce qui est facturé ou
            irréversible porte le bouton ROUGE. Deux branches distinctes : la
            prop `color` et la prop `outline` de Catalyst s'excluent. */}
        {effective.cost.kind === 'free' ? (
          <Button outline onClick={onConfirm} disabled={busy || blockedOnModels}>
            {busy ? 'En cours…' : effective.label}
          </Button>
        ) : (
          <Button color="red" onClick={onConfirm} disabled={busy || blockedOnModels}>
            {busy ? 'En cours…' : effective.label}
          </Button>
        )}
      </DialogActions>
    </>
  )
}
