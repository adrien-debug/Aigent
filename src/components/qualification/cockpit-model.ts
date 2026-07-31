/**
 * Le modèle du cockpit de qualification — dérivation PURE, zéro I/O, zéro JSX.
 *
 * POURQUOI CE MODULE EXISTE
 * -------------------------
 * L'écran de détail affichait dix panneaux de même poids et laissait
 * l'opérateur reconstituer lui-même les trois questions qui comptent :
 * « où en est le parcours ? », « pourquoi la promotion est-elle bloquée ? »,
 * « que dois-je faire maintenant ? ». Ces réponses se DÉRIVENT de données déjà
 * lues ; les calculer ici, hors du rendu, les rend testables sans DOM et
 * empêche l'écran d'inventer une règle au passage.
 *
 * CE QUE CE MODULE NE FAIT PAS
 * ----------------------------
 * · Il ne recalcule AUCUNE gate. `promotable` vient du serveur
 *   (`ReleaseGate.promotable` / `PromotionGateResult.promotable`) et n'est
 *   jamais re-dérivé depuis les checks : recalculer, c'est promettre à l'écran
 *   ce que la RPC refusera.
 * · Il ne fabrique aucune mesure. Une étape sans preuve est `sans-mesure`, pas
 *   « échouée » — une absence de lecture n'est pas un échec.
 * · Il ne décide d'aucune sécurité. La prochaine action proposée est une
 *   SUGGESTION de lecture ; l'autorisation reste celle des routes et de la RPC.
 */
import type { ReleaseGate } from '@/lib/agent-mission-control/release-gate'
import type { PromotionGateResult } from '@/lib/agent-mission-control/promotion-gate'
import type { QualificationRun } from '@/lib/agent-mission-control/qualification-orchestrator'
import { sortPromotionChecks, sortReleaseChecks } from './model'

/* ───────────────────────────── Le pipeline ───────────────────────────── */

/**
 * L'état d'une étape du parcours.
 *
 * `sans-mesure` et `indisponible` sont DEUX choses différentes, et les
 * confondre est le défaut que cet écran doit éviter : la première dit « la
 * lecture a réussi, il n'y a rien », la seconde « la lecture a échoué, je ne
 * sais pas ». Une carte vide géante disait les deux de la même façon.
 */
export type StepState = 'reussi' | 'echoue' | 'en-cours' | 'sans-mesure' | 'indisponible' | 'non-requis'

export type PipelineStepId = 'tests' | 'benchmark' | 'shadow' | 'replay' | 'gate'

export type PipelineStep = {
  id: PipelineStepId
  /** Libellé français affiché — jamais un identifiant technique. */
  label: string
  state: StepState
  /** Résumé d'UNE ligne. `null` quand il n'y a rien de mesuré à résumer. */
  summary: string | null
  /** Pourquoi c'est indisponible, quand ça l'est. Jamais inventé. */
  detail: string | null
  /**
   * Une étape « dense » mérite sa carte ; une étape sans mesure reste une
   * LIGNE compacte. C'est ce drapeau qui empêche quatre cartes vides de
   * remplir l'écran.
   */
  compact: boolean
}

export const STEP_STATE_LABEL: Record<StepState, string> = {
  reussi: 'réussi',
  echoue: 'échoué',
  'en-cours': 'en cours',
  'sans-mesure': 'sans mesure',
  indisponible: 'indisponible',
  'non-requis': 'non requis',
}

export const STEP_STATE_COLOR: Record<StepState, 'emerald' | 'red' | 'amber' | 'zinc'> = {
  reussi: 'emerald',
  echoue: 'red',
  'en-cours': 'amber',
  'sans-mesure': 'zinc',
  indisponible: 'zinc',
  'non-requis': 'zinc',
}

/** Les preuves du pipeline, telles que la fiche les a déjà lues. */
export type PipelineInput = {
  releaseGate: ReleaseGate | null
  releaseGateFailure: string | null
  promotionGate: PromotionGateResult | null
  promotionGateFailure: string | null
  qualificationRun: QualificationRun | null
  qualificationFailure: string | null
  shadowVerdict: string | null
  shadowFailure: string | null
  shadowPresent: boolean
  replayVerdict: string | null
  replayFailure: string | null
  replayPresent: boolean
}

/** Formate un pourcentage sans jamais transformer une absence en zéro. */
function percent(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return `${Math.round(value * 1000) / 10} %`
}

/**
 * L'étape « tests » — lue depuis les PREUVES de la release gate, pas depuis une
 * table de runs : c'est la gate qui décide ce qui compte comme preuve valable
 * (`execution_mode=live`), et l'écran ne doit pas proposer une seconde
 * définition.
 */
function testsStep(input: PipelineInput): PipelineStep {
  if (input.releaseGateFailure) {
    return {
      id: 'tests',
      label: 'Tests',
      state: 'indisponible',
      summary: null,
      detail: input.releaseGateFailure,
      compact: true,
    }
  }
  const run = input.releaseGate?.evidence?.testRun ?? null
  if (!run) {
    return {
      id: 'tests',
      label: 'Tests',
      state: 'sans-mesure',
      summary: null,
      detail: 'Aucun run de test live épinglé au candidat.',
      compact: true,
    }
  }
  const rate = percent(run.passRate)
  const failed = run.total - run.passed
  return {
    id: 'tests',
    label: 'Tests',
    state: run.hasRecursionError || failed > 0 ? 'echoue' : 'reussi',
    summary: `${run.passed}/${run.total} cas${rate ? ` · ${rate}` : ''}`,
    detail: run.hasRecursionError ? 'Le runtime n’a pas terminé proprement (récursion).' : null,
    compact: false,
  }
}

function benchmarkStep(input: PipelineInput): PipelineStep {
  if (input.releaseGateFailure) {
    return {
      id: 'benchmark',
      label: 'Benchmark',
      state: 'indisponible',
      summary: null,
      detail: input.releaseGateFailure,
      compact: true,
    }
  }
  const bench = input.releaseGate?.evidence?.benchmark ?? null
  if (!bench) {
    return {
      id: 'benchmark',
      label: 'Benchmark',
      state: 'sans-mesure',
      summary: null,
      detail: 'Aucun benchmark live épinglé au candidat.',
      compact: true,
    }
  }
  return {
    id: 'benchmark',
    label: 'Benchmark',
    state: 'reussi',
    summary: `score ${bench.score}/100`,
    detail: null,
    compact: false,
  }
}

/**
 * Shadow et replay partagent la même forme : une preuve optionnelle dont
 * l'absence n'est PAS un échec. La gate elle-même les traite comme « non
 * requis » quand aucune expérience n'existe — l'écran dit la même chose.
 */
function evidenceStep(
  id: 'shadow' | 'replay',
  label: string,
  present: boolean,
  verdict: string | null,
  failure: string | null
): PipelineStep {
  if (failure) {
    return { id, label, state: 'indisponible', summary: null, detail: failure, compact: true }
  }
  if (!present) {
    return {
      id,
      label,
      state: 'non-requis',
      summary: null,
      detail: 'Aucune expérience enregistrée — la gate ne l’exige pas.',
      compact: true,
    }
  }
  const ok = verdict === 'pass' || verdict === 'agree' || verdict === 'identical'
  return {
    id,
    label,
    state: ok ? 'reussi' : 'echoue',
    summary: verdict ? `verdict « ${verdict} »` : null,
    detail: null,
    compact: false,
  }
}

/** L'étape terminale : la décision, telle que le serveur la rend. */
function gateStep(input: PipelineInput): PipelineStep {
  if (input.promotionGateFailure && input.releaseGateFailure) {
    return {
      id: 'gate',
      label: 'Gate',
      state: 'indisponible',
      summary: null,
      detail: input.promotionGateFailure,
      compact: true,
    }
  }
  const promotable = input.promotionGate?.promotable ?? input.releaseGate?.promotable ?? null
  if (promotable === null) {
    return {
      id: 'gate',
      label: 'Gate',
      state: 'sans-mesure',
      summary: null,
      detail: 'Aucune évaluation de gate n’a été lue.',
      compact: true,
    }
  }
  const checks = input.promotionGate?.checks ?? []
  const failed = checks.filter((c) => c.status === 'FAIL').length
  return {
    id: 'gate',
    label: 'Gate',
    state: promotable ? 'reussi' : 'echoue',
    summary: promotable
      ? 'toutes les conditions tiennent'
      : `${failed || 1} condition(s) bloquante(s)`,
    detail: null,
    compact: false,
  }
}

export function buildPipeline(input: PipelineInput): PipelineStep[] {
  return [
    testsStep(input),
    benchmarkStep(input),
    evidenceStep('shadow', 'Shadow', input.shadowPresent, input.shadowVerdict, input.shadowFailure),
    evidenceStep('replay', 'Replay', input.replayPresent, input.replayVerdict, input.replayFailure),
    gateStep(input),
  ]
}

/* ───────────────────────── La décision fusionnée ───────────────────────── */

/**
 * L'état global du candidat — ce que l'en-tête doit crier.
 *
 * Trois valeurs seulement. « en cours » existe parce qu'un run de qualification
 * en vol n'est ni un blocage ni une autorisation : le dire « bloqué » pousserait
 * l'opérateur à agir pendant qu'une exécution tourne.
 */
export type GlobalState = 'bloque' | 'promouvable' | 'en-cours'

export const GLOBAL_STATE_LABEL: Record<GlobalState, string> = {
  bloque: 'Promotion bloquée',
  promouvable: 'Promouvable',
  'en-cours': 'Qualification en cours',
}

export const GLOBAL_STATE_COLOR: Record<GlobalState, 'red' | 'emerald' | 'amber'> = {
  bloque: 'red',
  promouvable: 'emerald',
  'en-cours': 'amber',
}

/**
 * Les libellés de gate, en français.
 *
 * Les deux gates produisent leurs libellés en anglais — elles sont des modules
 * serveur, partagés avec des surfaces non-UI, et les traduire À LA SOURCE
 * changerait de la donnée métier pour un besoin d'affichage. La traduction vit
 * donc ici, à la frontière du rendu.
 *
 * Un libellé ABSENT de cette table est affiché TEL QUEL : mieux vaut un mot
 * anglais lisible qu'un texte inventé ou qu'une clé technique nue. Cette table
 * se complète, elle ne masque rien.
 */
const GATE_LABEL_FR: Record<string, string> = {
  // Release gate
  'No undecided improvement cycle': 'Aucun cycle d’amélioration en attente',
  'Tests pass rate': 'Taux de réussite des tests',
  'Benchmark recorded': 'Benchmark enregistré',
  'Benchmark ≥ production': 'Benchmark au niveau de la production',
  'Unsafe actions': 'Actions non sûres',
  'Confirmation mistakes': 'Erreurs de confirmation',
  'No runtime recursion crash': 'Aucune récursion du runtime',
  'Read-only tool policy': 'Outils en lecture seule',
  'Candidate is a release candidate': 'Le candidat est en stade « release candidate »',
  // Promotion gate
  'Controlled release gate (tests, benchmark, unsafe, draft…)':
    'Gate de release contrôlée (tests, benchmark, sûreté, stade)',
  'Runtime has a real engine': 'Le runtime dispose d’un moteur réel',
  'All declared tools resolve to certified tools':
    'Tous les outils déclarés résolvent vers des outils certifiés',
  'Shadow experiment proved the candidate': 'Une expérience shadow a prouvé le candidat',
  'Replay comparison vs production': 'Comparaison replay face à la production',
}

/** Le libellé français d'une condition, ou le libellé d'origine s'il est inconnu. */
export function frenchGateLabel(label: string): string {
  return GATE_LABEL_FR[label] ?? label
}

/**
 * La valeur OBSERVÉE, francisée.
 *
 * Ces chaînes sont des phrases composées côté serveur (« 1 release check(s)
 * failed »), pas des identifiants : on ne peut pas les mapper une à une. On
 * traduit donc les tournures récurrentes, en gardant les nombres et les valeurs
 * mesurées intacts. Ce qui n'est pas reconnu passe TEL QUEL — jamais réécrit,
 * jamais tronqué.
 */
export function frenchObserved(observed: string): string {
  return observed
    .replace(/^(\d+) release check\(s\) failed$/, '$1 condition de release en échec')
    .replace(/^(\d+) release check\(s\) have no evidence$/, '$1 condition de release sans preuve')
    .replace(/^(\d+)\/(\d+) release checks pass$/, '$1/$2 conditions de release tenues')
    .replace(/^not required$/, 'non exigé')
    .replace(/^no shadow experiment \(not required\)$/, 'aucune expérience shadow (non exigée)')
    .replace(/^no replay comparison \(not required\)$/, 'aucune comparaison replay (non exigée)')
    .replace(/^expected: /, 'exigé : ')
    .replace(/\bexpected\b/, 'exigé')
    .replace(/\bproduction\b/, 'production')
}

/** Une condition de la décision, quelle que soit la gate qui la produit. */
export type DecisionCondition = {
  label: string
  /** `true` = tenue, `false` = bloquante, `null` = sans preuve (ni l'un ni l'autre). */
  satisfied: boolean | null
  /** La valeur observée, telle que le serveur la rapporte. */
  observed: string
  /** De quelle gate vient la condition — la provenance reste visible. */
  source: 'release' | 'promotion'
}

export type Decision = {
  state: GlobalState
  /** La cause EXACTE du blocage, en une phrase. `null` si non bloqué. */
  blockingCause: string | null
  /** Les conditions bloquantes, en tête. */
  blocking: DecisionCondition[]
  /** Les preuves manquantes — distinctes d'un échec. */
  missing: DecisionCondition[]
  /** Les conditions satisfaites, repliables. */
  satisfied: DecisionCondition[]
  /** La promotion est-elle autorisée ? Vient du serveur, jamais recalculée. */
  promotable: boolean
  /** Les deux gates ont-elles pu être lues ? */
  readable: boolean
}

export type DecisionInput = PipelineInput & { runInProgress: boolean }

/**
 * Fusionne release gate et promotion gate en UNE décision.
 *
 * Ce n'est pas une commodité d'affichage : `PromotionGateResult` intègre déjà
 * le rollup de la release gate (`rollupReleaseGate`), donc les deux panneaux
 * décrivaient littéralement la même décision sous deux formes. Les séparer
 * obligeait l'opérateur à croiser deux listes pour trouver une seule cause.
 */
export function buildDecision(input: DecisionInput): Decision {
  const conditions: DecisionCondition[] = []

  // Les deux gates portent DÉJÀ leur ordre de gravité (`sortReleaseChecks` /
  // `sortPromotionChecks` : ce qui bloque avant ce qui manque, avant ce qui
  // passe). On le réutilise au lieu d'en inventer un second — la première
  // condition listée est donc bien la plus grave, ce dont dépend
  // `blockingCause`.
  for (const check of sortReleaseChecks(input.releaseGate?.checks ?? [])) {
    conditions.push({
      label: frenchGateLabel(check.label),
      satisfied: check.status === 'pass' ? true : check.status === 'fail' ? false : null,
      observed: frenchObserved(check.observed ?? ''),
      source: 'release',
    })
  }

  for (const check of sortPromotionChecks(input.promotionGate?.checks ?? [])) {
    // Quatre statuts (`PromotionCheckStatus`), trois lectures :
    //  · PASS                  → tenue ;
    //  · FAIL                  → bloquante ;
    //  · NOT_CONFIGURED        → la condition n'est pas EXIGÉE pour ce candidat
    //                            (shadow/replay absents, par exemple) : ce n'est
    //                            ni un échec ni une preuve manquante, donc elle
    //                            ne doit pas alarmer ;
    //  · INSUFFICIENT_EVIDENCE → preuve manquante, `null` : la gate ne sait pas.
    // Confondre les deux derniers ferait passer « rien à prouver » pour
    // « preuve absente », et inversement.
    conditions.push({
      label: frenchGateLabel(check.label),
      satisfied:
        check.status === 'PASS' || check.status === 'NOT_CONFIGURED'
          ? true
          : check.status === 'FAIL'
            ? false
            : null,
      observed: frenchObserved(check.reason),
      source: 'promotion',
    })
  }

  const blocking = conditions.filter((c) => c.satisfied === false)
  const missing = conditions.filter((c) => c.satisfied === null)
  const satisfied = conditions.filter((c) => c.satisfied === true)

  const readable = !(input.releaseGateFailure && input.promotionGateFailure)
  const promotable = input.promotionGate?.promotable ?? input.releaseGate?.promotable ?? false

  let state: GlobalState = 'bloque'
  if (input.runInProgress) state = 'en-cours'
  else if (promotable) state = 'promouvable'

  // La cause EXACTE : la première condition bloquante, sinon la première preuve
  // manquante, sinon une panne de lecture. Une cause vague (« la gate échoue »)
  // ne dit pas quoi corriger.
  let blockingCause: string | null = null
  if (!promotable) {
    if (blocking.length > 0) {
      blockingCause = `${blocking[0].label} — ${blocking[0].observed}`
    } else if (missing.length > 0) {
      blockingCause = `Preuve manquante : ${missing[0].label} — ${missing[0].observed}`
    } else if (!readable) {
      blockingCause = 'Les deux gates sont illisibles : la décision est inconnue, pas défavorable.'
    } else {
      blockingCause = 'La gate serveur refuse la promotion sans condition en échec explicite.'
    }
  }

  return { state, blockingCause, blocking, missing, satisfied, promotable, readable }
}

/* ─────────────────────── La prochaine action utile ─────────────────────── */

export type NextAction = {
  /** Le libellé de l'action, en français. */
  label: string
  /** Pourquoi c'est la prochaine chose à faire. */
  rationale: string
  /** L'étape du pipeline concernée — l'UI y ancre son bouton. */
  step: PipelineStepId | 'promotion'
}

/**
 * UNE seule action primaire, déduite de l'état réel.
 *
 * L'écran précédent proposait quatorze boutons de même poids, dont deux
 * chemins concurrents pour la même chose (« Lancer la qualification » et
 * « Avancer d'une étape »). Ici la prochaine action est CALCULÉE : la première
 * étape du parcours qui n'a pas de preuve, sinon la promotion.
 */
export function nextAction(pipeline: PipelineStep[], decision: Decision): NextAction {
  if (decision.state === 'en-cours') {
    return {
      label: 'Qualification en cours',
      rationale: 'Une exécution est en vol : attendez son issue avant d’agir.',
      step: 'gate',
    }
  }

  if (decision.promotable) {
    return {
      label: 'Promouvoir en production',
      rationale: 'Toutes les conditions de la gate tiennent.',
      step: 'promotion',
    }
  }

  const firstUnproven = pipeline.find(
    (step) => step.state === 'sans-mesure' && step.id !== 'gate'
  )
  if (firstUnproven) {
    return {
      label: `Exécuter : ${firstUnproven.label}`,
      rationale: `${firstUnproven.label} n’a aucune preuve épinglée au candidat — c’est ce qui bloque la gate.`,
      step: firstUnproven.id,
    }
  }

  const firstFailed = pipeline.find((step) => step.state === 'echoue' && step.id !== 'gate')
  if (firstFailed) {
    return {
      label: `Corriger : ${firstFailed.label}`,
      rationale: `${firstFailed.label} est en échec. Une nouvelle exécution est nécessaire après correction.`,
      step: firstFailed.id,
    }
  }

  // Le pipeline est complet mais la gate refuse : la cause n'est PAS une étape
  // manquante, elle est dans les conditions de la gate elle-même (stage du
  // candidat, cycle non approuvé…). Renvoyer vers « relancer le parcours »
  // serait un mauvais conseil : rien ne changerait. On nomme la vraie cause.
  if (decision.blockingCause) {
    return {
      label: 'Lever la condition bloquante',
      rationale: `Le parcours est complet ; c'est la gate qui refuse. ${decision.blockingCause}`,
      step: 'gate',
    }
  }

  return {
    label: 'Relancer la qualification',
    rationale: 'Le parcours complet réévalue chaque étape puis la gate.',
    step: 'gate',
  }
}
