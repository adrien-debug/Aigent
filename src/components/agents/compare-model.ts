/**
 * Modèle de la comparaison V1 / V2 — pur, testable, sans React.
 *
 * POURQUOI CE FICHIER EXISTE. `compareImprovementVersions` tourne DÉJÀ à chaque
 * lecture de la fiche agent (`agent-detail.ts` → `AgentDetail.improveComparison`),
 * avec son aller-retour live, et le résultat était jeté : aucun composant ne le
 * rendait. On demandait donc à un humain d'approuver une V2 sans lui montrer ce
 * qui change. Ce module ne mesure RIEN de neuf — il met en forme ce qui est déjà
 * payé, plus les champs de version/manifeste que la fiche a déjà en main.
 *
 * LA RÈGLE QUI GOUVERNE TOUT ICI : une valeur non mesurée reste `null` et se
 * rend avec le mot d'absence du produit. Un score jamais mesuré n'est pas 0 ; un
 * coût jamais mesuré n'est pas gratuit. Ces deux coercions sont exactement ce
 * que `AGENTS.md` § Vérité des données interdit, et une comparaison est le pire
 * endroit où les commettre : elle sert à DÉCIDER, et un faux zéro d'un côté
 * fabrique un delta qui n'existe pas.
 *
 * Ce module ne décide rien et ne promeut rien : il n'expose aucune mutation.
 */
import type { ImprovementProposal, VersionComparison } from '@/lib/agent-mission-control/improvement-loop'
import type { AgentManifest, CopilotVersion } from '@/lib/agent-mission-control/types'

/**
 * Pourquoi il n'y a pas d'écran de comparaison à afficher.
 *
 * Ces quatre cas sont des états DISTINCTS et ne se replient jamais l'un sur
 * l'autre : « aucune proposition » n'est pas « lecture impossible », et ni l'un
 * ni l'autre n'est « aucune différence ». Un écran de comparaison vide qui
 * ressemblerait à « la V2 ne change rien » serait un mensonge lisible.
 */
export type CompareAbsence =
  /** Le résolveur n'a jamais trouvé de proposition d'amélioration. */
  | 'no-proposal'
  /** Une proposition existe mais aucune V2 n'a encore été matérialisée. */
  | 'no-v2'
  /** La lecture de la proposition ou de la comparaison a échoué. */
  | 'unread'

export const COMPARE_ABSENCE_DETAIL: Record<CompareAbsence, string> = {
  'no-proposal':
    'Aucun cycle d’amélioration n’a été ouvert pour cet agent. Il n’y a donc pas de V2 à comparer — ce n’est pas « la V2 ne change rien ».',
  'no-v2':
    'Un cycle d’amélioration est ouvert, mais aucun brouillon V2 n’a encore été matérialisé. Il n’y a rien à comparer tant que la V2 n’existe pas.',
  unread:
    'La comparaison V1 / V2 n’a pas pu être lue. Ce n’est pas « aucune différence » — c’est une lecture qui a échoué.',
}

/** Une valeur mesurée, ou une absence explicite. Jamais un zéro de repli. */
export type Measured<T> = { state: 'measured'; value: T } | { state: 'not-measured' }

export function measured<T>(value: T): Measured<T> {
  return { state: 'measured', value }
}

export const NOT_MEASURED = { state: 'not-measured' } as const

/**
 * `null`/`undefined`/non-fini → absence. Un `0` réel reste un `0` mesuré : c'est
 * toute la distinction que ce module existe pour tenir.
 */
export function numericMeasure(value: number | null | undefined): Measured<number> {
  if (value == null || !Number.isFinite(value)) return NOT_MEASURED
  return measured(value)
}

/** `null`/`undefined`/chaîne vide → absence. */
export function fromNullableText(value: string | null | undefined): Measured<string> {
  if (value == null || value.trim() === '') return NOT_MEASURED
  return measured(value.trim())
}

/**
 * Le sens d'un écart, pour un lecteur pressé.
 *
 * `unknown` n'est PAS un synonyme de « pas de changement » : il dit qu'au moins
 * un des deux côtés n'a pas été mesuré, donc que l'écart est INCALCULABLE. Le
 * confondre avec `same` affirmerait une stabilité que personne n'a constatée.
 */
export type Direction = 'better' | 'worse' | 'same' | 'unknown'

/**
 * Direction d'un écart numérique. `higherIsBetter` porte la polarité : un score
 * qui monte est un progrès, un coût qui monte ne l'est pas.
 */
export function directionOf(
  v1: Measured<number>,
  v2: Measured<number>,
  higherIsBetter: boolean,
): Direction {
  if (v1.state !== 'measured' || v2.state !== 'measured') return 'unknown'
  if (v1.value === v2.value) return 'same'
  const v2IsHigher = v2.value > v1.value
  return v2IsHigher === higherIsBetter ? 'better' : 'worse'
}

/** Une ligne de comparaison textuelle (prompt, modèle, politique, outils…). */
export type TextRow = {
  key: string
  label: string
  /** Ce que la ligne mesure, en une phrase — porté en `title`, jamais deviné. */
  meaning: string
  v1: Measured<string>
  v2: Measured<string>
  /** `true` seulement quand LES DEUX côtés sont mesurés ET diffèrent. */
  changed: boolean
  /** La justification produite par la boucle, quand elle existe. */
  why: Measured<string>
}

/** Une ligne de comparaison numérique (scores, coûts, limites). */
export type NumberRow = {
  key: string
  label: string
  meaning: string
  v1: Measured<number>
  v2: Measured<number>
  direction: Direction
  /** Comment rendre la valeur : le composant ne devine pas l'unité. */
  format: 'ratio' | 'usd' | 'count' | 'score100'
}

export type CompareGroup = {
  key: string
  title: string
  description: string
  textRows: TextRow[]
  numberRows: NumberRow[]
}

export type CompareView = {
  v1Label: Measured<string>
  v2Label: Measured<string>
  proposalStatus: ImprovementProposal['status']
  summary: Measured<string>
  groups: CompareGroup[]
  /**
   * Nombre de lignes dont les DEUX côtés sont mesurés et diffèrent. Zéro ici
   * signifie « rien de mesurable n'a changé », pas « rien n'a changé » : les
   * lignes non mesurées sont comptées à part.
   */
  changedCount: number
  /** Lignes dont au moins un côté n'a pas été mesuré — l'écart est inconnu. */
  unknownCount: number
}

function textRow(
  key: string,
  label: string,
  meaning: string,
  v1: Measured<string>,
  v2: Measured<string>,
  why: Measured<string> = NOT_MEASURED,
): TextRow {
  const changed =
    v1.state === 'measured' && v2.state === 'measured' && v1.value !== v2.value
  return { key, label, meaning, v1, v2, changed, why }
}

function numberRow(
  key: string,
  label: string,
  meaning: string,
  v1: Measured<number>,
  v2: Measured<number>,
  higherIsBetter: boolean,
  format: NumberRow['format'],
): NumberRow {
  return { key, label, meaning, v1, v2, direction: directionOf(v1, v2, higherIsBetter), format }
}

function listText(items: readonly string[] | null | undefined): Measured<string> {
  if (items == null) return NOT_MEASURED
  // Une liste VIDE est un fait mesuré (« aucune action interdite »), pas une
  // absence : la coercer en « Indisponible » effacerait une vraie information.
  if (items.length === 0) return measured('aucune')
  return measured(items.join(' · '))
}

/**
 * Le taux de réussite d'une version, depuis `scores` — mais uniquement quand
 * `scoresEvidence` prouve que des runs réels l'ont pinné.
 *
 * SANS CE GARDE, LA COMPARAISON MENT. `copilot_versions.scores` est un `jsonb`
 * dont le brouillon V2 est écrit avec `testPassRate: 0` à la création : une V2
 * fraîche afficherait donc « 0 % » face à une V1 à 92 %, c'est-à-dire une
 * RÉGRESSION MASSIVE inventée de toutes pièces, sur l'écran même qui sert à
 * décider d'approuver. `scoresEvidence === 'none'` est exactement ce cas, et il
 * doit se lire « non mesuré ».
 */
function versionScore(
  version: CopilotVersion | undefined,
  field: 'testPassRate' | 'benchmarkScore' | 'unsafeActionCount',
): Measured<number> {
  if (version === undefined) return NOT_MEASURED
  if (version.scoresEvidence === 'none') return NOT_MEASURED
  return numericMeasure(version.scores?.[field])
}

/**
 * Le taux de réussite agrégé des suites, depuis la comparaison LIVE
 * (`compareImprovementVersions`) — la source la plus fiable des deux, parce
 * qu'elle relit les `test_runs` réellement terminés et pinnés à la version.
 *
 * `null` quand AUCUNE suite n'a de run terminé pour ce côté : une moyenne sur
 * zéro suite est indéfinie, pas nulle.
 */
export function aggregatePassRate(
  comparison: VersionComparison | null,
  side: 'v1' | 'v2',
): Measured<number> {
  if (comparison === null || comparison.corpus.status !== 'MATCHED') return NOT_MEASURED
  const rates = comparison.tests
    .map((suite) => suite[side])
    .filter((run): run is NonNullable<typeof run> => run != null)
    .map((run) => run.passRate)
    .filter((rate): rate is number => typeof rate === 'number' && Number.isFinite(rate))
  if (rates.length === 0) return NOT_MEASURED
  return measured(rates.reduce((sum, r) => sum + r, 0) / rates.length)
}

/** Idem pour les benchmarks — moyenne des scores réellement lus. */
export function aggregateBenchmarkScore(
  comparison: VersionComparison | null,
  side: 'v1' | 'v2',
): Measured<number> {
  if (comparison === null || comparison.corpus.status !== 'MATCHED') return NOT_MEASURED
  const scores = comparison.benchmarks
    .map((suite) => suite[side])
    .filter((run): run is NonNullable<typeof run> => run != null)
    .map((run) => run.score)
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score))
  if (scores.length === 0) return NOT_MEASURED
  return measured(scores.reduce((sum, s) => sum + s, 0) / scores.length)
}

function comparisonContentHash(
  comparison: VersionComparison | null,
  side: 'v1' | 'v2',
): Measured<string> {
  if (comparison === null) return NOT_MEASURED
  const hashes = [
    ...comparison.tests.map((item) => item[side]?.contentHash ?? null),
    ...comparison.benchmarks.map((item) => item[side]?.contentHash ?? null),
  ]
  if (hashes.length === 0 || hashes.some((hash) => hash === null)) return NOT_MEASURED
  const unique = [...new Set(hashes as string[])]
  return measured(unique.length === 1 ? unique[0] : `MISMATCH: ${unique.join(', ')}`)
}

/**
 * Assemble la vue de comparaison à partir de ce que la fiche a DÉJÀ lu.
 *
 * Aucun aller-retour supplémentaire : `proposal`, `comparison` et `versions`
 * viennent tous de `getAgentDetail`, et `manifest` est le manifeste courant que
 * la section Configuration rend déjà.
 *
 * NOTE SUR LE CÔTÉ V2 DU MANIFESTE. Le manifeste V2 n'est PAS chargé par le
 * résolveur (il vit sous `proposal.v2ManifestId`), et le charger serait
 * précisément l'aller-retour que la mission interdit. La V2 se lit donc par
 * `proposal.manifestChanges`, qui porte les couples `{from, to, why}` produits
 * par la boucle — la source AUTORITAIRE de ce qui change, puisque c'est elle qui
 * a écrit le manifeste V2. Un champ absent de `manifestChanges` est un champ que
 * la boucle n'a PAS touché : sa V2 vaut alors la V1, et c'est un fait, pas une
 * absence.
 */
export function buildCompareView({
  proposal,
  comparison,
  versions,
  manifest,
}: Readonly<{
  proposal: ImprovementProposal
  comparison: VersionComparison | null
  versions: readonly CopilotVersion[]
  manifest: AgentManifest | undefined
}>): CompareView {
  const v1 = versions.find((v) => v.id === proposal.baseVersionId)
  const v2 = versions.find((v) => v.id === proposal.v2VersionId)
  const changes = proposal.manifestChanges ?? {}

  /**
   * La valeur V2 d'un champ de manifeste. Quand la boucle n'a pas touché le
   * champ, la V2 vaut la V1 — un report explicite, pas une absence.
   */
  const carried = <T,>(
    change: { from: T; to: T; why: string } | undefined,
    v1Value: Measured<string>,
    render: (value: T) => Measured<string>,
  ): { v2: Measured<string>; why: Measured<string> } =>
    change === undefined
      ? { v2: v1Value, why: NOT_MEASURED }
      : { v2: render(change.to), why: fromNullableText(change.why) }

  /* ───────── Comportement : prompt et garde-fous ───────── */

  const promptV1 = fromNullableText(
    changes.systemPromptSummary?.from ?? manifest?.systemPromptSummary,
  )
  const prompt = carried(changes.systemPromptSummary, promptV1, (v) => fromNullableText(v))

  const forbiddenV1 = listText(changes.forbiddenActions?.from ?? manifest?.forbiddenActions)
  const forbidden = carried(changes.forbiddenActions, forbiddenV1, listText)

  const confirmV1 = fromNullableText(
    changes.confirmationPolicy?.from ?? manifest?.confirmationPolicy,
  )
  const confirm = carried(changes.confirmationPolicy, confirmV1, (v) => fromNullableText(v))

  const alwaysConfirmV1 = listText(
    changes.alwaysConfirmActions?.from ?? manifest?.alwaysConfirmActions,
  )
  const alwaysConfirm = carried(changes.alwaysConfirmActions, alwaysConfirmV1, listText)

  const invariantsV1 = listText(
    changes.outputContractInvariants?.from ?? manifest?.outputContract?.invariants,
  )
  const invariants = carried(changes.outputContractInvariants, invariantsV1, listText)

  /* ───────── Modèle et outils ───────── */

  const modelV1 = fromNullableText(v1?.model)
  const modelV2 = fromNullableText(v2?.model)
  const providerV1 = fromNullableText(v1?.modelProvider)
  const providerV2 = fromNullableText(v2?.modelProvider)

  /*
   * LES OUTILS NE CHANGENT PAS, ET C'EST UNE GARANTIE, PAS UN OUBLI.
   * Le prompt système de la boucle impose « tools are read-only and MUST NOT be
   * added, removed or renamed », et `createV2FromProposal` recopie littéralement
   * `tool_ids` de la V1. La ligne est donc rendue avec la MÊME valeur des deux
   * côtés, et son `meaning` dit pourquoi — l'omettre laisserait un lecteur
   * supposer que la V2 pourrait avoir gagné un outil mutant en silence.
   */
  const toolCount = manifest?.toolIds?.length
  const toolsText: Measured<string> =
    toolCount == null ? NOT_MEASURED : measured(`${toolCount} outil(s)`)

  /* ───────── Limites ───────── */

  const maxStepsV1 = numericMeasure(
    changes.maxStepsPerRun?.from ?? manifest?.maxStepsPerRun,
  )
  const maxStepsV2 =
    changes.maxStepsPerRun === undefined
      ? maxStepsV1
      : numericMeasure(changes.maxStepsPerRun.to)

  // Le plafond de coût est recopié tel quel par `createV2FromProposal` : la
  // boucle n'a pas le droit de le changer, donc les deux côtés sont égaux.
  const maxCost = numericMeasure(manifest?.maxCostPerRunUsd)
  const provenance = measured(
    Object.entries(proposal.sources)
      .filter(([, available]) => available)
      .map(([source]) => source)
      .join(', ') || 'aucune source disponible',
  )
  const downstreamEvidence = [
    proposal.sourceRunId && `run:${proposal.sourceRunId}`,
    proposal.qualificationRunId && `qualification:${proposal.qualificationRunId}`,
    proposal.shadowExperimentId && `shadow:${proposal.shadowExperimentId}`,
    proposal.replayComparisonId && `replay:${proposal.replayComparisonId}`,
  ].filter((value): value is string => value !== null)
  const downstreamEvidenceText =
    downstreamEvidence.length > 0 ? measured(downstreamEvidence.join(' · ')) : NOT_MEASURED

  const groups: CompareGroup[] = [
    {
      key: 'behaviour',
      title: 'Comportement',
      description:
        'La charte de comportement et le modèle qui l’exécute. C’est ce que la boucle d’amélioration a le droit de réécrire.',
      textRows: [
        textRow(
          'prompt',
          'Prompt système',
          'Le résumé de la charte de comportement porté par le manifeste.',
          promptV1,
          prompt.v2,
          prompt.why,
        ),
        textRow(
          'model',
          'Modèle',
          'Le modèle pinné sur la version. La boucle ne le change pas : un écart ici vient d’une autre opération.',
          modelV1,
          modelV2,
        ),
        textRow(
          'provider',
          'Provider',
          'Le provider pinné sur la version. Non résolu se dit non résolu — jamais « openai » par défaut.',
          providerV1,
          providerV2,
        ),
        textRow(
          'tools',
          'Outils montés',
          'Les outils sont en lecture seule pour la boucle d’amélioration : une V2 ne peut ni en ajouter, ni en retirer, ni en renommer.',
          toolsText,
          toolsText,
        ),
      ],
      numberRows: [],
    },
    {
      key: 'guardrails',
      title: 'Garde-fous',
      description:
        'Actions interdites et politique de confirmation. La boucle ne peut que durcir la confirmation, jamais l’affaiblir.',
      textRows: [
        textRow(
          'forbidden',
          'Actions interdites',
          'Les comportements refusés par la garde runtime. « aucune » est un fait mesuré, pas une absence.',
          forbiddenV1,
          forbidden.v2,
          forbidden.why,
        ),
        textRow(
          'confirmation',
          'Politique de confirmation',
          'never → risky-only → always. La boucle ne peut que monter dans cet ordre.',
          confirmV1,
          confirm.v2,
          confirm.why,
        ),
        textRow(
          'always-confirm',
          'Confirmation systématique',
          'Les actions qui exigent une confirmation humaine quelle que soit la politique.',
          alwaysConfirmV1,
          alwaysConfirm.v2,
          alwaysConfirm.why,
        ),
        textRow(
          'invariants',
          'Invariants de sortie',
          'Le contrat de sortie que chaque réponse doit respecter.',
          invariantsV1,
          invariants.v2,
          invariants.why,
        ),
      ],
      numberRows: [],
    },
    {
      key: 'limits',
      title: 'Limites',
      description: 'Les plafonds appliqués avant chaque appel facturé.',
      textRows: [],
      numberRows: [
        numberRow(
          'max-steps',
          'Étapes max / run',
          'Le nombre d’étapes qu’un run peut consommer avant d’être arrêté.',
          maxStepsV1,
          maxStepsV2,
          // Plus d'étapes n'est ni bon ni mauvais en soi ; on ne prétend pas
          // trancher. `same` sortira naturellement quand rien ne bouge.
          false,
          'count',
        ),
        numberRow(
          'max-cost',
          'Coût max / run',
          'Le plafond de coût vérifié avant chaque appel. La boucle d’amélioration ne le modifie pas.',
          maxCost,
          maxCost,
          false,
          'usd',
        ),
      ],
    },
    {
      key: 'evidence',
      title: 'Scores et coûts observés',
      description:
        'Ce que des runs réels ont prouvé sur chaque version. Un score jamais mesuré n’est pas un score de 0.',
      textRows: [
        textRow(
          'comparison-read',
          'Lecture des mesures comparées',
          'Une lecture indisponible conserve les changements de manifeste visibles, mais interdit tout delta de score.',
          measured(comparison ? 'lue' : 'indisponible'),
          measured(comparison ? 'lue' : 'indisponible'),
        ),
        textRow(
          'content-hash',
          'Empreinte du corpus',
          'SHA-256 canonique versionné. Une différence interdit toute conclusion V1/V2.',
          comparisonContentHash(comparison, 'v1'),
          comparisonContentHash(comparison, 'v2'),
          comparison ? measured(comparison.corpus.reason) : undefined,
        ),
        textRow(
          'corpus-verdict',
          'Comparabilité du corpus',
          'MATCHED seulement si tous les runs V1 et V2 portent exactement le hash de la proposition.',
          comparison ? measured(comparison.corpus.status) : NOT_MEASURED,
          comparison ? measured(comparison.corpus.status) : NOT_MEASURED,
          comparison ? measured(comparison.corpus.reason) : undefined,
        ),
        textRow(
          'provenance',
          'Provenance des signaux',
          'Sources réellement disponibles lors de l’analyse ayant produit la proposition.',
          provenance,
          provenance,
        ),
        textRow(
          'evidence-links',
          'Chaîne de preuves',
          'Identifiants persistés reliant run, qualification, shadow et replay.',
          downstreamEvidenceText,
          downstreamEvidenceText,
        ),
      ],
      numberRows: [
        numberRow(
          'pass-rate',
          'Taux de réussite des tests',
          'Moyenne des taux de réussite des suites ayant un run terminé pinné sur la version.',
          aggregatePassRate(comparison, 'v1'),
          aggregatePassRate(comparison, 'v2'),
          true,
          'ratio',
        ),
        numberRow(
          'benchmark',
          'Score de benchmark',
          'Moyenne des scores de benchmark des suites ayant un run terminé pinné sur la version.',
          aggregateBenchmarkScore(comparison, 'v1'),
          aggregateBenchmarkScore(comparison, 'v2'),
          true,
          'score100',
        ),
        numberRow(
          'version-pass-rate',
          'Taux de réussite (version)',
          'Le score stocké sur la ligne de version, retenu seulement quand des runs réels l’ont pinné.',
          versionScore(v1, 'testPassRate'),
          versionScore(v2, 'testPassRate'),
          true,
          'ratio',
        ),
        numberRow(
          'unsafe',
          'Actions unsafe comptées',
          'Zéro signifie « un run a regardé et n’a rien trouvé » — l’affirmation la plus forte du système. Non mesuré ne vaut jamais zéro.',
          versionScore(v1, 'unsafeActionCount'),
          versionScore(v2, 'unsafeActionCount'),
          false,
          'count',
        ),
        numberRow(
          'cycle-cost',
          'Coût du cycle d’analyse',
          'Ce que l’analyse ayant produit cette proposition a coûté. Il n’est pas imputé à la V2.',
          NOT_MEASURED,
          numericMeasure(proposal.costUsd),
          false,
          'usd',
        ),
      ],
    },
  ]

  let changedCount = 0
  let unknownCount = 0
  for (const group of groups) {
    for (const row of group.textRows) {
      if (row.changed) changedCount += 1
      else if (row.v1.state !== 'measured' || row.v2.state !== 'measured') unknownCount += 1
    }
    for (const row of group.numberRows) {
      if (row.direction === 'unknown') unknownCount += 1
      else if (row.direction !== 'same') changedCount += 1
    }
  }

  return {
    v1Label: fromNullableText(v1?.label),
    v2Label: fromNullableText(v2?.label),
    proposalStatus: proposal.status,
    summary: fromNullableText(proposal.summary),
    groups,
    changedCount,
    unknownCount,
  }
}
