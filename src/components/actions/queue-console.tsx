'use client'

/**
 * La file opérateur — le seul composant client de `/actions`, et le seul qui
 * mute.
 *
 * POURQUOI UN `fetch` ET PAS UNE SERVER ACTION
 * --------------------------------------------
 * Même raison que le poste de commande de Qualification, et c'est un contrat du
 * repo, pas une préférence : une Server Action POSTe vers la route de la PAGE
 * (`/actions`), qui n'est pas sous `/api/agent-ops/**`, donc hors du `matcher`
 * de `src/proxy.ts`. Ce serait une quatrième frontière de confiance, mutante et
 * non gardée. La reprise part donc d'ici en `fetch` vers la route déjà gardée,
 * avec `credentials: 'same-origin'` pour que le cookie de session HMAC voyage.
 *
 * CE QUE CE COMPOSANT NE FAIT PAS
 * -------------------------------
 * · Il ne recalcule AUCUN statut ni aucune priorité : tout arrive dérivé du
 *   serveur (`operator-queue.ts`). Recalculer ici, c'est promettre à l'écran ce
 *   que l'API refusera.
 * · Il n'invente aucune action. Une ligne sans `mutation` n'affiche QU'UN lien
 *   « Ouvrir le contexte ». Pas de bouton grisé : l'absence de mutation sûre
 *   est un fait affiché, pas une capacité suggérée.
 * · Il ne crée aucun mécanisme d'exécution parallèle : une seule reprise à la
 *   fois (`busyId`), et la route elle-même refuse la double soumission par
 *   compare-and-swap atomique.
 *
 * DOUBLE CONFIRMATION
 * -------------------
 * Reprendre un run, c'est autoriser l'outil que le manifeste jugeait digne
 * d'une signature humaine. Le dialogue exige donc DEUX gestes distincts : armer
 * la case « je comprends », puis cliquer. Approuver et refuser sont deux boutons
 * séparés — jamais un même bouton dont le sens dépend d'un état.
 */
import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox, CheckboxField } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Description, Label } from '@/components/ui/fieldset'
import { Strong, Text } from '@/components/ui/text'
import { Unavailable } from '@/components/cockpit/primitives'
import {
  deriveQueueFilters,
  filterQueue,
  isDiscriminating,
  QUEUE_KIND_LABEL,
  type OperatorQueue,
  type OperatorQueueItem,
  type OperatorQueueKind,
} from '@/lib/agent-mission-control/operator-queue'
import type { ObsidianConfig } from '@/lib/agent-mission-control/obsidian-bridge'
import { ObsidianNoteButton } from '@/components/learning/obsidian-buttons'

type BadgeColor = 'red' | 'amber' | 'emerald' | 'zinc' | 'blue'

/** Couleur par catégorie — dérivée du sens, jamais décorative. */
function kindColor(kind: OperatorQueueKind): BadgeColor {
  if (kind === 'run_needs_confirmation') return 'red'
  if (kind === 'release_gate_red' || kind === 'sandbox_failed' || kind === 'mission_blocked')
    return 'red'
  if (kind === 'data_unavailable') return 'zinc'
  if (kind === 'improvement_decision') return 'blue'
  return 'amber'
}

/**
 * Un filtre à deux états.
 *
 * `Button` porte une union DISCRIMINÉE (`color` xor `plain` xor `outline`) :
 * passer `plain={boolean}` ne compile pas, et c'est voulu — le kit refuse
 * qu'une variante soit décidée par une expression qui pourrait valoir
 * `undefined`. On rend donc deux éléments distincts, et `aria-pressed` porte
 * l'état pour les lecteurs d'écran, que la couleur seule ne renseigne pas.
 */
function FilterButton({
  active,
  onClick,
  children,
}: Readonly<{ active: boolean; onClick: () => void; children: ReactNode }>) {
  return active ? (
    <Button color="dark" aria-pressed onClick={onClick}>
      {children}
    </Button>
  ) : (
    <Button plain aria-pressed={false} onClick={onClick}>
      {children}
    </Button>
  )
}

/**
 * Un sélecteur de filtre — rendu UNIQUEMENT s'il discrimine.
 *
 * `isDiscriminating` exige au moins deux valeurs distinctes : sur une file qui
 * ne contient qu'un seul agent, un menu « agent » ne retirerait jamais rien.
 * Un contrôle inerte suggère un tri impossible et laisse croire à une variété
 * de données qui n'existe pas — on ne le rend pas du tout.
 */
function FilterSelect({
  label,
  allLabel,
  values,
  selected,
  onSelect,
  resolveLabel,
}: Readonly<{
  label: string
  allLabel: string
  values: readonly string[]
  selected: string | null
  onSelect: (value: string | null) => void
  resolveLabel: (value: string) => string
}>) {
  if (!isDiscriminating(values)) return null

  return (
    // Le `<select>` est natif — le kit n'en fournit pas. `aig-panel` lui donne
    // le fond, le liseré et le rayon du produit ; `aig-line` monte le trait
    // d'un cran parce qu'un contrôle cliquable doit se distinguer d'un panneau
    // passif. La paire claire/sombre codée en dur a disparu : le document est
    // sombre au niveau de `<html>`, la branche claire ne servait plus.
    <select
      aria-label={label}
      className="aig-panel aig-line px-3 py-1.5 text-sm"
      value={selected ?? ''}
      onChange={(event) => onSelect(event.target.value || null)}
    >
      <option value="">{allLabel}</option>
      {values.map((value) => (
        <option key={value} value={value}>
          {resolveLabel(value)}
        </option>
      ))}
    </select>
  )
}

type MutationState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'ok'; message: string }
  | { phase: 'error'; message: string }

/** Une ligne de file. */
function QueueRow({
  item,
  obsidian,
  origin,
  state,
  busy,
  onResume,
}: Readonly<{
  item: OperatorQueueItem
  obsidian: ObsidianConfig
  origin: string
  state: MutationState
  busy: boolean
  onResume: (item: OperatorQueueItem) => void
}>) {
  const isExternal = item.href.startsWith('http')

  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={kindColor(item.kind)}>{QUEUE_KIND_LABEL[item.kind]}</Badge>
          {item.risk === 'high' ? <Badge color="red">risque élevé</Badge> : null}
          {item.mutation === null ? <Badge color="zinc">lecture seule</Badge> : null}
        </div>
        <Strong className="mt-2 block wrap-break-word">{item.title}</Strong>
        <Text className="mt-1 wrap-break-word">{item.meta}</Text>

        {state.phase === 'ok' ? (
          <Text className="mt-2 text-(--aig-severity-good)">{state.message}</Text>
        ) : null}
        {state.phase === 'error' ? (
          <Text className="mt-2 text-(--aig-severity-bad)">{state.message}</Text>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <ObsidianNoteButton config={obsidian} item={item} origin={origin} />
        <Button
          plain
          href={item.href}
          {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {item.mutation === null ? 'Ouvrir le contexte' : item.buttonLabel}
        </Button>
        {item.mutation !== null ? (
          <Button
            color="dark"
            disabled={busy || state.phase === 'running'}
            onClick={() => onResume(item)}
          >
            {state.phase === 'running' ? 'Reprise…' : 'Traiter'}
          </Button>
        ) : null}
      </div>
    </li>
  )
}

export default function QueueConsole({
  queue,
  obsidian,
  origin,
  proposalScanTruncated,
  proposalScanCount,
}: Readonly<{
  queue: OperatorQueue
  obsidian: ObsidianConfig
  /**
   * Origine publique, résolue CÔTÉ SERVEUR et passée en prop.
   *
   * Lire `window.location.origin` dans ce composant produirait deux rendus
   * différents (chaîne vide au SSR, origine réelle au client) et donc une
   * erreur d'hydratation — constatée en console avant cette correction, pas
   * théorique.
   */
  origin: string
  proposalScanTruncated: boolean
  proposalScanCount: number
}>) {
  const router = useRouter()

  const [kind, setKind] = useState<OperatorQueueKind | null>(null)
  const [copilotId, setCopilotId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [riskOnly, setRiskOnly] = useState(false)
  const [actionableOnly, setActionableOnly] = useState(false)

  const [pending, setPending] = useState<OperatorQueueItem | null>(null)
  const [armed, setArmed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [states, setStates] = useState<Record<string, MutationState>>({})

  const filters = useMemo(() => deriveQueueFilters(queue.items), [queue.items])
  const visible = useMemo(
    () =>
      filterQueue(queue.items, {
        kind,
        copilotId,
        projectId,
        status,
        riskOnly,
        actionableOnly,
      }),
    [queue.items, kind, copilotId, projectId, status, riskOnly, actionableOnly],
  )

  const openConfirm = useCallback((item: OperatorQueueItem) => {
    setPending(item)
    setArmed(false)
  }, [])

  const closeConfirm = useCallback(() => {
    setPending(null)
    setArmed(false)
  }, [])

  /**
   * Exécute la reprise. `approved` est explicite : la route attend un booléen
   * et distingue approuver de refuser — les deux sont des décisions réelles,
   * aucune n'est un « annuler ».
   */
  const runResume = useCallback(
    async (item: OperatorQueueItem, approved: boolean) => {
      const mutation = item.mutation
      if (!mutation) return

      setBusyId(item.id)
      setStates((prev) => ({ ...prev, [item.id]: { phase: 'running' } }))
      closeConfirm()

      try {
        const response = await fetch(mutation.endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ approved }),
        })
        const payload: unknown = await response.json().catch(() => null)

        if (!response.ok) {
          // On rend le message de la route tel quel : elle distingue déjà 409
          // (déjà repris / thread perdu), 503 (backend absent), 504 (timeout).
          const detail =
            payload && typeof payload === 'object' && 'error' in payload
              ? String((payload as { error: unknown }).error)
              : `échec (HTTP ${response.status})`
          setStates((prev) => ({
            ...prev,
            [item.id]: { phase: 'error', message: detail },
          }))
          return
        }

        const status =
          payload && typeof payload === 'object' && 'status' in payload
            ? String((payload as { status: unknown }).status)
            : 'traité'
        setStates((prev) => ({
          ...prev,
          [item.id]: {
            phase: 'ok',
            message:
              status === 'needs-confirmation'
                ? 'Un autre outil demande une approbation : la ligne reste dans la file.'
                : `Run ${status}.`,
          },
        }))
        // La file est dérivée côté serveur : on la relit plutôt que de muter un
        // état local qui divergerait de la vérité.
        router.refresh()
      } catch {
        setStates((prev) => ({
          ...prev,
          [item.id]: {
            phase: 'error',
            message: 'La reprise a échoué : réseau ou serveur injoignable.',
          },
        }))
      } finally {
        setBusyId(null)
      }
    },
    [closeConfirm, router],
  )

  const failedSources = queue.sources.filter((source) => !source.ok)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Pannes de source — nommées, jamais fondues dans un compteur. Elles
          DOIVENT ressortir : `aig-panel-raised` monte la boîte d'un palier et
          le liseré ambre porte la gravité. L'aplat `bg-amber-50/60` qui vivait
          ici était calibré pour un fond blanc. */}
      {failedSources.length > 0 || queue.dataWarnings.length > 0 ? (
        <section className="aig-panel-raised border-[color-mix(in_oklab,var(--aig-severity-warn)_40%,transparent)] p-4">
          <Strong className="block">Sources partiellement lues</Strong>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {failedSources.map((source) => (
              <li key={source.source}>
                <Text>{source.detail ?? `Source « ${source.source} » indisponible.`}</Text>
              </li>
            ))}
            {queue.dataWarnings.map((warning) => (
              <li key={warning}>
                <Text>{warning}</Text>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Filtres — dérivés des lignes réelles, jamais d'une liste codée en dur. */}
      <section className="flex flex-wrap items-center gap-2">
        <FilterButton active={kind === null} onClick={() => setKind(null)}>
          Tout ({queue.items.length})
        </FilterButton>
        {filters.kinds.map((candidate) => (
          <FilterButton
            key={candidate}
            active={kind === candidate}
            onClick={() => setKind(candidate === kind ? null : candidate)}
          >
            {QUEUE_KIND_LABEL[candidate]}
          </FilterButton>
        ))}

        {/* Chaque sélecteur n'apparaît QUE s'il discrimine (≥ 2 valeurs). Un
            filtre inerte suggère un tri impossible et ment sur la variété des
            données — voir `isDiscriminating`. */}
        <FilterSelect
          label="Filtrer par agent"
          allLabel="Tous les agents"
          values={filters.copilotIds}
          selected={copilotId}
          onSelect={setCopilotId}
          resolveLabel={(id) => queue.labels.copilots[id] ?? id}
        />
        <FilterSelect
          label="Filtrer par projet"
          allLabel="Tous les projets"
          values={filters.projectIds}
          selected={projectId}
          onSelect={setProjectId}
          resolveLabel={(id) => queue.labels.projects[id] ?? id}
        />
        <FilterSelect
          label="Filtrer par statut"
          allLabel="Tous les statuts"
          values={filters.statuses}
          selected={status}
          onSelect={setStatus}
          resolveLabel={(value) => value}
        />

        {filters.hasRisk ? (
          <FilterButton active={riskOnly} onClick={() => setRiskOnly(!riskOnly)}>
            Risque élevé
          </FilterButton>
        ) : null}
        {filters.hasMutation ? (
          <FilterButton active={actionableOnly} onClick={() => setActionableOnly(!actionableOnly)}>
            Actionnables
          </FilterButton>
        ) : null}
      </section>

      {/* La file. Boîte bornée, la data défile DEDANS. `aig-panel` remplace le
          trio fond / anneau / ombre codé en dur — un seul jeton pour la même
          brique de surface que les autres écrans. */}
      <section className="aig-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6">
              <Unavailable
                reason="no-data"
                detail={
                  queue.items.length === 0
                    ? "Aucune action en attente. Les sources ont été lues : c'est une file vide mesurée, pas une lecture manquée."
                    : 'Aucune ligne ne correspond à ce filtre.'
                }
              />
            </div>
          ) : (
            <ul className="divide-y aig-line-soft">
              {visible.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  obsidian={obsidian}
                  origin={origin}
                  state={states[item.id] ?? { phase: 'idle' }}
                  busy={busyId !== null && busyId !== item.id}
                  onResume={openConfirm}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Pas de gouttière ici : la colonne entière de `/actions` en réserve
            déjà une sous `lg` (voir `src/app/actions/page.tsx`). En ajouter une
            seconde décalerait le pied sans raison. */}
        <footer className="aig-line-soft shrink-0 border-t px-4 py-2">
          <Text className="text-xs">
            {visible.length} ligne(s) affichée(s) sur {queue.items.length} · composée le{' '}
            {new Date(queue.composedAt).toLocaleString('fr-FR')}
            {proposalScanTruncated
              ? ` · décisions V2 scannées sur ${proposalScanCount} agents seulement`
              : ''}
          </Text>
        </footer>
      </section>

      {/* Double confirmation. */}
      <Dialog open={pending !== null} onClose={closeConfirm}>
        <DialogTitle>Reprendre un run en attente de confirmation</DialogTitle>
        <DialogDescription>
          {pending?.meta} — cette décision reprend le thread LangGraph et laisse l’outil approuvé
          s’exécuter réellement. Elle est irréversible.
        </DialogDescription>
        <DialogBody>
          <CheckboxField>
            <Checkbox name="armed" checked={armed} onChange={setArmed} />
            <Label>Je comprends que l’outil en attente va s’exécuter</Label>
            <Description>
              L’approbation autorise une action que le manifeste de l’agent a marquée comme exigeant
              une signature humaine. Refuser est aussi une décision : le run se termine en « bloqué
              ».
            </Description>
          </CheckboxField>
        </DialogBody>
        <DialogActions>
          <Button plain onClick={closeConfirm}>
            Annuler
          </Button>
          <Button
            color="zinc"
            disabled={!armed || pending === null}
            onClick={() => pending && runResume(pending, false)}
          >
            Refuser
          </Button>
          <Button
            color="dark"
            disabled={!armed || pending === null}
            onClick={() => pending && runResume(pending, true)}
          >
            Approuver et exécuter
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
