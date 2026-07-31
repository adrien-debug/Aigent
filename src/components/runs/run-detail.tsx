/**
 * Panneau de DÉTAIL d'un run — la moitié droite du maître-détail.
 *
 * Server Component : il ne fait que rendre le run que la page lui passe. Aucune
 * lecture, aucun état, aucune mutation (la PR est en lecture seule : pas de
 * resume, pas de re-run — un bouton inerte serait un mensonge d'affordance).
 *
 * CE QUE CE PANNEAU TIENT
 * -----------------------
 * Chaque fait passe par un `RunFact` (`run-view-model.ts`), donc chaque champ
 * arrive déjà qualifié : mesuré, non mesuré, ou non lisible. Le composant ne
 * décide de rien — il rend un `Badge`+raison pour les deux absences et la valeur
 * pour la mesure. Il n'existe aucun chemin dans ce fichier où un champ absent
 * sort en tiret muet.
 *
 * TIMELINE / ÉVÉNEMENTS — l'absence structurelle, dite comme telle.
 * `AgentRun.stepIds` porte les IDENTIFIANTS des étapes, mais AUCUNE fonction de
 * `src/lib/**` ne lit leurs corps (`agent_run_steps` n'est lu que par la route
 * runtime `/api/runtime/v1/runs/:id/events`, en SQL inline, derrière un jeton
 * consommateur — pas un loader réutilisable). La timeline annonce donc combien
 * d'étapes existent, et dit qu'elle ne peut pas les ouvrir. Elle n'affiche pas
 * une liste vide : « 0 étape affichée » sur 7 étapes réelles serait faux.
 */
import { Badge } from '@/components/ui/badge'
import { Divider } from '@/components/ui/divider'
import { Subheading } from '@/components/ui/heading'
import { Strong, Text } from '@/components/ui/text'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRun } from '@/lib/agent-mission-control/types'
import { formatDuration } from '@/lib/runs-console/runs-metrics'
import { AbsentMark, Unavailable } from '@/components/cockpit/primitives'
import {
  RUN_STATUS_BADGE,
  RUN_STATUS_LABEL,
  runCostFact,
  runDurationFact,
  runErrorFact,
  runInterruptFact,
  runModelFact,
  runProviderFact,
  runToolCallsFact,
  runTraceFact,
  runUnsafeFact,
} from './run-view-model'
import type { RunFact } from './run-view-model'

/**
 * Une ligne « libellé / fait ». Les deux formes d'absence sont visuellement
 * DIFFÉRENTES d'une valeur : un badge zinc portant le mot, plus la raison en
 * dessous. Impossible de la lire comme une mesure.
 */
function Fact({ label, fact }: Readonly<{ label: string; fact: RunFact }>) {
  return (
    <div className="min-w-0 py-2">
      <Text className="truncate text-xs uppercase">{label}</Text>
      {fact.state === 'measured' ? (
        <Strong className="block wrap-break-word tabular-nums">{fact.value}</Strong>
      ) : (
        <div className="mt-0.5">
          <Badge color="zinc">{fact.state === 'not-measured' ? 'Non mesuré' : 'Non lisible'}</Badge>
          <Text className="mt-1 block text-xs wrap-break-word">{fact.why}</Text>
        </div>
      )}
    </div>
  )
}

/** Bloc de texte libre (entrée / sortie d'un run), avec son absence qualifiée. */
function SummaryBlock({ label, text }: Readonly<{ label: string; text: string }>) {
  const trimmed = text?.trim() ?? ''
  return (
    <div className="min-w-0">
      <Text className="text-xs uppercase">{label}</Text>
      {trimmed === '' ? (
        <div className="mt-1">
          <AbsentMark />
          <Text className="mt-1 block text-xs">Aucun résumé n&apos;a été enregistré pour ce run.</Text>
        </div>
      ) : (
        <pre className="mt-1 max-h-32 overflow-y-auto rounded-md bg-zinc-950/3 p-2 font-mono text-xs whitespace-pre-wrap text-zinc-700 dark:bg-white/5 dark:text-zinc-300">
          {trimmed}
        </pre>
      )}
    </div>
  )
}

/**
 * La timeline. Elle dit ce qu'elle sait (le NOMBRE d'étapes, qui est réel) et ce
 * qu'elle ne peut pas ouvrir (leur contenu). Deux cas seulement, et aucun ne
 * produit de fausse liste vide.
 */
function Timeline({ run }: Readonly<{ run: AgentRun }>) {
  const stepCount = Array.isArray(run.stepIds) ? run.stepIds.length : null

  if (stepCount === null) {
    return (
      <Unavailable
        reason="unread"
        detail="Les identifiants d'étapes n'ont pas été lus pour ce run."
      />
    )
  }

  if (stepCount === 0) {
    return (
      <Unavailable
        reason="no-data"
        detail="Ce run n'a enregistré aucune étape. La lecture a réussi — c'est une absence mesurée, pas une lecture manquée."
      />
    )
  }

  return (
    <div className="rounded-md border border-dashed border-zinc-950/10 p-3 dark:border-white/10">
      <div className="flex items-center gap-2">
        <Badge color="zinc">Non lisible</Badge>
        <Text className="tabular-nums">
          <Strong>{stepCount}</Strong> étape{stepCount > 1 ? 's' : ''} enregistrée
          {stepCount > 1 ? 's' : ''}
        </Text>
      </div>
      <Text className="mt-2 block text-xs">
        Le nombre est réel — il vient des identifiants portés par le run. Leur CONTENU (nature,
        titre, durée, statut de chaque étape) n&apos;est exposé par aucun loader du plan de
        contrôle : la seule lecture de `agent_run_steps` vit derrière la surface runtime, réservée
        aux produits consommateurs. Aucune étape n&apos;est donc affichée ici, et aucune n&apos;est
        inventée.
      </Text>
    </div>
  )
}

export default function RunDetail({
  run,
  agentName,
  projectName,
  nowMs,
}: Readonly<{
  run: AgentRun
  /** `null` quand la lecture du roster a échoué — l'id brut est alors affiché. */
  agentName: string | null
  projectName: string | null
  nowMs: number
}>) {
  const durationFact = runDurationFact(formatDuration(run.latencyMs))
  const errorFact = runErrorFact(run)
  const startedMs = Date.parse(run.startedAt)
  const startedLabel = Number.isFinite(startedMs)
    ? new Date(startedMs).toISOString().replace('T', ' ').slice(0, 19)
    : null
  // L'instant de rendu est injecté par la page : jamais de `Date.now()` ici.
  const ageSeconds = Number.isFinite(startedMs) ? Math.max(0, Math.round((nowMs - startedMs) / 1000)) : null

  return (
    <div>
      {/* ── En-tête : identité du run ── */}
      <div className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge color={RUN_STATUS_BADGE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
          {run.unsafeAttemptCount > 0 ? (
            <Badge color="red">{run.unsafeAttemptCount} bloquée(s)</Badge>
          ) : null}
        </div>
        <Subheading level={2} className="mt-1.5 truncate font-mono text-sm">
          {run.id}
        </Subheading>
        <Text className="truncate">
          {agentName ?? <span className="font-mono">{run.copilotId}</span>}
          {' · '}
          {projectName ?? (run.projectId ? <span className="font-mono">{run.projectId}</span> : 'sans projet')}
        </Text>
        <Text className="mt-0.5 tabular-nums">
          {startedLabel === null ? (
            <AbsentMark />
          ) : (
            <>
              {startedLabel} UTC
              {ageSeconds !== null ? ` · il y a ${formatAge(ageSeconds)}` : ''}
            </>
          )}
        </Text>
      </div>

      <Divider soft />

      <div className="px-4 py-3">
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <Fact label="Durée" fact={durationFact} />
          <Fact label="Coût" fact={runCostFact(run, (n) => formatUsd(n))} />
          <Fact label="Modèle" fact={runModelFact(run)} />
          <Fact label="Provider" fact={runProviderFact(run)} />
          <Fact label="Appels d'outils" fact={runToolCallsFact(run)} />
          <Fact label="Tentatives bloquées" fact={runUnsafeFact(run)} />
        </div>

        {errorFact ? (
          <>
            <Divider soft className="my-3" />
            <Fact label="Cause de l'échec" fact={errorFact} />
          </>
        ) : null}

        <Divider soft className="my-3" />
        <Fact label="Interruption humaine" fact={runInterruptFact(run)} />

        <Divider soft className="my-3" />
        <Fact label="Trace externe" fact={runTraceFact(run)} />

        <Divider soft className="my-3" />
        <Text className="mb-2 text-xs uppercase">Timeline des étapes</Text>
        <Timeline run={run} />

        <Divider soft className="my-3" />
        <div className="space-y-3">
          <SummaryBlock label="Entrée" text={run.inputSummary} />
          <SummaryBlock label="Sortie" text={run.outputSummary} />
        </div>
      </div>
    </div>
  )
}

/** Âge lisible. Purement présentationnel — jamais une mesure dérivée. */
function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.round(hours / 24)} j`
}
