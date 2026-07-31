/**
 * Le COCKPIT de qualification — l'écran de décision d'un candidat.
 *
 * CE QUI A CHANGÉ, ET POURQUOI
 * ----------------------------
 * L'écran précédent posait dix panneaux de même poids dans une grille
 * `auto-rows-fr`, ce qui forçait quatre cartes SANS AUCUNE MESURE (qualification,
 * shadow, replay, amélioration) à la même hauteur que les panneaux denses :
 * des centaines de pixels pour dire « rien ». Il séparait aussi la gate de
 * release et la gate de promotion, alors que `PromotionGateResult` intègre déjà
 * le rollup de la première — deux vues d'UNE décision, que l'opérateur devait
 * croiser à la main. Et il alignait quatorze boutons de même importance dans un
 * « poste de commande » détaché des étapes qu'ils concernent.
 *
 * La recomposition tient en quatre gestes :
 *
 *  1. **Un en-tête qui répond aux quatre questions** — quel candidat, quelle
 *     version sert la production, quel est l'état global, où est la fiche agent.
 *  2. **Un pipeline** `Tests → Benchmark → Shadow → Replay → Gate` où chaque
 *     étape porte SA commande. Une étape sans mesure reste une LIGNE, jamais
 *     une carte vide (`PipelineStep.compact`).
 *  3. **Une colonne de décision unique**, fusionnant les deux gates, qui nomme
 *     la cause exacte du blocage et ne propose qu'UNE action primaire.
 *  4. **Une zone secondaire repliée** pour l'historique, les versions et les
 *     suites — présentes, mais qui ne dominent plus l'écran.
 *
 * CE QUI N'A PAS CHANGÉ
 * ---------------------
 * Aucune règle métier, aucune RPC, aucune gate, aucune politique de sécurité.
 * `promotable` reste ce que le serveur dit ; les mutations partent toujours du
 * même composant client vers les mêmes routes gardées, avec le même dialogue de
 * confirmation et le même armement du mode live. Toutes les données affichées
 * avant le sont encore.
 *
 * SCROLL : un seul conteneur défilant, celui de la page. Aucun panneau ne porte
 * de `overflow-y-auto` — les onze mini-scrolls imbriqués de la version
 * précédente rendaient toute lecture continue impossible.
 */
import { Badge } from '@/components/ui/badge'
import { Divider } from '@/components/ui/divider'
import { Heading, Subheading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import QualificationConsole from './console'
import { Note } from './atoms'
import {
  buildDecision,
  buildPipeline,
  nextAction,
  GLOBAL_STATE_COLOR,
  GLOBAL_STATE_LABEL,
  STEP_STATE_COLOR,
  STEP_STATE_LABEL,
  type DecisionCondition,
  type PipelineStep,
} from './cockpit-model'
import { buildConsoleTarget, type QualificationDetail } from './detail-contract'
import type { ConsoleSection } from './console'
import { PROMOTION_STATUS_MEANING } from './model'

/* ────────────────────────────── En-tête ────────────────────────────── */

/**
 * Les quatre faits qu'un opérateur doit lire en une seconde : le candidat, la
 * production, l'état global, et le chemin vers la fiche complète.
 */
function CockpitHeader({
  detail,
  state,
}: Readonly<{ detail: QualificationDetail; state: keyof typeof GLOBAL_STATE_LABEL }>) {
  const { copilotName, candidateVersion, productionVersionId, productionRead, versions } = detail
  const productionVersion = productionVersionId
    ? versions.find((v) => v.id === productionVersionId) ?? null
    : null

  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Heading level={1} className="min-w-0 truncate">
            {copilotName}
          </Heading>
          <Badge color={GLOBAL_STATE_COLOR[state]}>{GLOBAL_STATE_LABEL[state]}</Badge>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Text className="text-sm">
            Candidat évalué :{' '}
            {candidateVersion ? (
              <Strong>{candidateVersion.label}</Strong>
            ) : (
              <span className="text-amber-700 dark:text-amber-500">aucune version candidate</span>
            )}
          </Text>
          <Text className="text-sm">
            En production :{' '}
            {!productionRead ? (
              <span className="text-zinc-500">non lue</span>
            ) : productionVersion ? (
              <Strong>{productionVersion.label}</Strong>
            ) : productionVersionId ? (
              <Strong>{productionVersionId}</Strong>
            ) : (
              <span className="text-amber-700 dark:text-amber-500">aucune</span>
            )}
          </Text>
        </div>
      </div>

      <Link
        href={`/agents/${detail.copilotId}`}
        className="shrink-0 text-sm underline underline-offset-4"
      >
        Fiche complète de l’agent
      </Link>
    </header>
  )
}

/* ───────────────────────────── Le pipeline ───────────────────────────── */

/**
 * La commande qui appartient à chaque étape — plus de poste détaché.
 *
 * ATTENTION AUX DOUBLONS : les sections de la console regroupent PLUSIEURS
 * étapes (« suites » porte tests ET benchmark, « shadowReplay » porte shadow ET
 * replay). Rendre la section sur chaque étape afficherait donc deux fois les
 * mêmes boutons — c'est exactement ce que ce rework doit supprimer. La section
 * est donc ancrée sur UNE seule étape, la première qu'elle concerne ; les
 * autres n'affichent aucune commande.
 */
const STEP_SECTION: Record<string, ConsoleSection | null> = {
  tests: 'suites',
  benchmark: null,
  shadow: 'shadowReplay',
  replay: null,
  gate: null,
}

/**
 * Une étape du parcours.
 *
 * `compact` gouverne la densité : une étape sans mesure tient sur une ligne,
 * une étape mesurée déplie son résumé. C'est ce qui remplace les quatre cartes
 * vides de plusieurs centaines de pixels.
 */
function StepRow({
  step,
  target,
  showCommand,
}: Readonly<{
  step: PipelineStep
  target: ReturnType<typeof buildConsoleTarget>
  showCommand: boolean
}>) {
  const section = STEP_SECTION[step.id] ?? null

  // `xl:flex-row` et non `sm:` : les commandes d'une étape font jusqu'à quatre
  // boutons `shrink-0`. En dessous de `xl` elles écrasaient le texte au point de
  // le casser caractère par caractère (« 5/5 / cas / · / 100 % » en colonne,
  // constaté à 1280 px). Sous ce seuil, la commande passe SOUS son étape : elle
  // reste dans son contexte, sans le comprimer.
  return (
    <li className="flex flex-col gap-2 py-3 xl:flex-row xl:items-start xl:justify-between xl:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Strong className="text-sm">{step.label}</Strong>
          <Badge color={STEP_STATE_COLOR[step.state]}>{STEP_STATE_LABEL[step.state]}</Badge>
          {/* `whitespace-nowrap` : « 5/5 cas · 100 % » est UNE unité de sens,
              jamais un texte à couper au milieu. */}
          {step.summary ? (
            <Text className="text-sm whitespace-nowrap">{step.summary}</Text>
          ) : null}
        </div>
        {step.detail ? <Text className="mt-1 text-xs">{step.detail}</Text> : null}
      </div>

      {/* La console rend un `flex flex-col gap-4` qui contient, en plus des
          boutons, sa zone de résultat et son `Dialog`. Ces deux-là sont vides
          au repos mais participent AU GAP : mesuré, 104 px de conteneur pour
          56 px de contenu utile, soit une bande vide sous chaque étape.
          `gap-0` sur l'enfant direct supprime l'écart sans rien masquer — le
          résultat d'une action reste rendu quand il existe, avec sa propre
          marge. Corrigé ici, dans le consommateur, plutôt que dans le composant
          partagé par le reste de la surface. */}
      {/* `[&_.flex-wrap]:justify-end` : les boutons s'alignent à droite quand
          ils passent à la ligne, au lieu de flotter au milieu. Pas de
          `shrink-0` ici — c'est lui qui écrasait le texte de l'étape en le
          coupant caractère par caractère. */}
      {showCommand && section ? (
        <div className="[&>div]:gap-0 xl:max-w-[60%] [&_.flex-wrap]:justify-end">
          <QualificationConsole target={target} sections={[section]} bare />
        </div>
      ) : null}
    </li>
  )
}

/* ──────────────────────── La colonne de décision ──────────────────────── */

/**
 * Le sens de chaque état, en infobulle.
 *
 * Ces phrases viennent de `PROMOTION_STATUS_MEANING` (`model.ts`), qui porte
 * déjà la distinction la plus subtile de cette surface : une preuve ABSENTE
 * bloque sans rien affirmer contre le candidat, alors qu'une preuve qui VIOLE
 * l'exigence est un fait établi. Les réécrire ici aurait dupliqué cette
 * doctrine — et l'aurait laissée dériver.
 */
const CONDITION_TITLE: Record<'tenue' | 'bloquante' | 'sans preuve', string> = {
  tenue: PROMOTION_STATUS_MEANING.PASS,
  bloquante: PROMOTION_STATUS_MEANING.FAIL,
  'sans preuve': PROMOTION_STATUS_MEANING.INSUFFICIENT_EVIDENCE,
}

function ConditionRow({ condition }: Readonly<{ condition: DecisionCondition }>) {
  const color = condition.satisfied === true ? 'emerald' : condition.satisfied === false ? 'red' : 'zinc'
  const label = condition.satisfied === true ? 'tenue' : condition.satisfied === false ? 'bloquante' : 'sans preuve'

  return (
    <li className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <Text className="text-sm">{condition.label}</Text>
        {condition.observed ? <Text className="text-xs">{condition.observed}</Text> : null}
      </div>
      <Badge color={color} className="shrink-0" title={CONDITION_TITLE[label]}>
        {label}
      </Badge>
    </li>
  )
}

/* ────────────────────────────── L'écran ────────────────────────────── */

export default function QualificationCockpitScreen({
  detail,
}: Readonly<{ detail: QualificationDetail }>) {
  const target = buildConsoleTarget(detail)

  const pipelineInput = {
    releaseGate: detail.releaseGate,
    releaseGateFailure: detail.releaseGateFailure,
    promotionGate: detail.promotionGate,
    promotionGateFailure: detail.promotionGateFailure,
    qualificationRun: detail.qualificationRun,
    qualificationFailure: detail.qualificationFailure,
    shadowVerdict: detail.shadow?.verdict ?? null,
    shadowFailure: detail.shadowFailure,
    shadowPresent: detail.shadow !== null,
    replayVerdict: detail.replay?.verdict ?? null,
    replayFailure: detail.replayFailure,
    replayPresent: detail.replay !== null,
  }

  const pipeline = buildPipeline(pipelineInput)
  const decision = buildDecision({
    ...pipelineInput,
    runInProgress: detail.qualificationRun?.status === 'running',
  })
  const action = nextAction(pipeline, decision)

  return (
    // UN SEUL conteneur de scroll : celui-ci. Aucun panneau n'en porte un
    // second. `min-h-svh` (et non `h-svh`) parce que cet écran est un document
    // qui s'allonge — le borner couperait la zone secondaire.
    <div className="shell-page-document max-lg:pl-14">
      <CockpitHeader detail={detail} state={decision.state} />

      {detail.agent === null ? (
        <div className="mt-4">
          <Note tone="warn" title="Aucune ligne canonique ne résout pour ce copilot">
            Le contrat canonique ne rend rien pour cet identifiant : les conditions de la garde
            d’exécution sont INCONNUES, pas fausses. Cet écran ne les invente pas.
          </Note>
        </div>
      ) : null}

      <Divider soft className="my-4" />

      {/* Deux colonnes à partir de `lg` : le parcours à gauche, la décision à
          droite et STICKY — elle doit rester lisible pendant qu'on parcourt les
          étapes. En dessous, une seule colonne, décision EN PREMIER : sur
          mobile, la question « pourquoi c'est bloqué » prime sur le détail. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] [&>*]:min-w-0">
        {/* ── Décision — première dans le DOM sur mobile, à droite en desktop ── */}
        <section
          aria-labelledby="decision"
          className="lg:order-2 lg:sticky lg:top-4 lg:self-start"
        >
          <div className="rounded-lg bg-white p-4 shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Subheading level={2} id="decision">
                Décision
              </Subheading>
              <Badge color={GLOBAL_STATE_COLOR[decision.state]}>
                {GLOBAL_STATE_LABEL[decision.state]}
              </Badge>
            </div>

            <Text className="mt-1 text-xs">
              Gate de release et gate de promotion réunies : la seconde intègre la première.
            </Text>

            {decision.blockingCause ? (
              <div className="mt-3 rounded-lg border border-red-500/25 bg-red-50/60 p-3 dark:bg-red-950/20">
                <Strong className="block text-sm">Cause du blocage</Strong>
                <Text className="mt-1 text-sm">{decision.blockingCause}</Text>
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-50/60 p-3 dark:bg-emerald-950/20">
                <Text className="text-sm">Toutes les conditions de la gate tiennent.</Text>
              </div>
            )}

            {/* L'action primaire — UNE seule, celle que l'état réel appelle. */}
            <div className="mt-4">
              <Strong className="block text-xs uppercase">Prochaine action</Strong>
              <Text className="mt-1 text-sm">{action.rationale}</Text>
              <div className="mt-2">
                {decision.promotable ? (
                  <QualificationConsole target={target} sections={['promotion']} />
                ) : (
                  <QualificationConsole target={target} sections={['qualification']} bare />
                )}
              </div>
              {!decision.promotable ? (
                <Text className="mt-2 text-xs">
                  La promotion reste indisponible tant que la gate échoue : la RPC
                  <code className="mx-1">promote_copilot_version</code>
                  refuserait l’écriture.
                </Text>
              ) : null}
            </div>

            {/* La garde d'exécution — rendue ICI, une seule fois, plutôt que
                répétée par chaque console d'étape. Elle explique pourquoi un
                lancement serait refusé par la route (409), ce qui est une
                information de DÉCISION, pas de commande. */}
            {target.runBlockers.length > 0 ? (
              <div className="mt-4">
                <Note
                  tone="blocked"
                  title={`La garde d’exécution refuserait un lancement — ${target.runBlockers.length} raison(s)`}
                >
                  <ul className="mt-1 list-disc pl-4">
                    {target.runBlockers.map((blocker) => (
                      <li key={blocker}>
                        <Text className="text-sm">{blocker}</Text>
                      </li>
                    ))}
                  </ul>
                </Note>
              </div>
            ) : null}

            {decision.blocking.length > 0 ? (
              <div className="mt-4">
                <Strong className="block text-xs uppercase">Conditions bloquantes</Strong>
                <ul className="mt-1 divide-y divide-zinc-950/5 dark:divide-white/10">
                  {decision.blocking.map((c) => (
                    <ConditionRow key={`${c.source}-${c.label}`} condition={c} />
                  ))}
                </ul>
              </div>
            ) : null}

            {decision.missing.length > 0 ? (
              <div className="mt-4">
                <Strong className="block text-xs uppercase">Preuves manquantes</Strong>
                <ul className="mt-1 divide-y divide-zinc-950/5 dark:divide-white/10">
                  {decision.missing.map((c) => (
                    <ConditionRow key={`${c.source}-${c.label}`} condition={c} />
                  ))}
                </ul>
              </div>
            ) : null}

            {decision.satisfied.length > 0 ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs uppercase text-zinc-500 dark:text-zinc-400">
                  {decision.satisfied.length} condition(s) satisfaite(s)
                </summary>
                <ul className="mt-1 divide-y divide-zinc-950/5 dark:divide-white/10">
                  {decision.satisfied.map((c) => (
                    <ConditionRow key={`${c.source}-${c.label}`} condition={c} />
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </section>

        {/* ── Pipeline ── */}
        <section aria-labelledby="parcours" className="lg:order-1">
          <div className="rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
              <Subheading level={2} id="parcours">
                Parcours de qualification
              </Subheading>
              <Text className="text-xs">Tests → Benchmark → Shadow → Replay → Gate</Text>
            </div>
            <ul className="divide-y divide-zinc-950/5 px-4 pb-2 dark:divide-white/10">
              {pipeline.map((step) => (
                <StepRow
                  key={step.id}
                  step={step}
                  target={target}
                  showCommand={step.id !== 'gate'}
                />
              ))}
            </ul>
          </div>

          {/* ── Zone secondaire : présente, repliée, jamais dominante ── */}
          <div className="mt-4 flex flex-col gap-2">
            <details className="rounded-lg bg-white px-4 py-3 shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
              <summary className="cursor-pointer text-sm font-medium">
                Historique des gates{' '}
                <span className="text-zinc-500">
                  ({detail.gateHistoryFailure ? 'illisible' : detail.gateHistory.length})
                </span>
              </summary>
              <div className="mt-2">
                {detail.gateHistoryFailure ? (
                  <Text className="text-sm">{detail.gateHistoryFailure}</Text>
                ) : detail.gateHistory.length === 0 ? (
                  <Text className="text-sm">Aucune évaluation persistée pour ce copilot.</Text>
                ) : (
                  <ul className="divide-y divide-zinc-950/5 dark:divide-white/10">
                    {detail.gateHistory.map((entry) => (
                      <li key={entry.id} className="flex items-center justify-between gap-3 py-1.5">
                        <Text className="min-w-0 truncate text-xs">
                          {entry.evaluatedAt
                            ? new Date(entry.evaluatedAt).toLocaleString('fr-FR')
                            : 'date inconnue'}{' '}
                          · {entry.versionId}
                        </Text>
                        <Badge color={entry.promotable ? 'emerald' : 'red'} className="shrink-0">
                          {entry.promotable ? 'promouvable' : 'bloquée'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>

            <details className="rounded-lg bg-white px-4 py-3 shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
              <summary className="cursor-pointer text-sm font-medium">
                Versions{' '}
                <span className="text-zinc-500">
                  ({detail.versionsFailure ? 'illisible' : detail.versions.length})
                </span>
              </summary>
              <div className="mt-2">
                {detail.versionsFailure ? (
                  <Text className="text-sm">{detail.versionsFailure}</Text>
                ) : (
                  <ul className="divide-y divide-zinc-950/5 dark:divide-white/10">
                    {detail.versions.map((version) => (
                      <li key={version.id} className="flex items-center justify-between gap-3 py-1.5">
                        <Text className="min-w-0 truncate text-sm">{version.label}</Text>
                        <div className="flex shrink-0 items-center gap-1">
                          <Badge color="zinc">{version.stage}</Badge>
                          {version.id === detail.productionVersionId ? (
                            <Badge color="emerald">en service</Badge>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>

            <details className="rounded-lg bg-white px-4 py-3 shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
              <summary className="cursor-pointer text-sm font-medium">
                Suites{' '}
                <span className="text-zinc-500">
                  {detail.testSuitesFailure || detail.benchmarkSuitesFailure
                    ? '(illisible)'
                    : `(${detail.testSuites.length} test · ${detail.benchmarkSuites.length} benchmark)`}
                </span>
              </summary>
              <div className="mt-2">
                <ul className="divide-y divide-zinc-950/5 dark:divide-white/10">
                  {detail.testSuites.map((suite) => (
                    <li key={suite.id} className="flex items-center justify-between gap-3 py-1.5">
                      <Text className="min-w-0 truncate text-sm">{suite.name}</Text>
                      <Badge color="zinc" className="shrink-0">
                        {suite.caseIds.length} cas
                      </Badge>
                    </li>
                  ))}
                  {detail.benchmarkSuites.map((suite) => (
                    <li key={suite.id} className="flex items-center justify-between gap-3 py-1.5">
                      <Text className="min-w-0 truncate text-sm">{suite.name}</Text>
                      <Badge color="zinc" className="shrink-0">
                        {suite.taskCount} tâches
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </details>

            {/* Actions avancées et destructrices : rangées, jamais alignées
                avec le reste. La boucle d'amélioration et le retour arrière ne
                sont pas des gestes de parcours courant. */}
            <details className="rounded-lg bg-white px-4 py-3 shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
              <summary className="cursor-pointer text-sm font-medium">Actions avancées</summary>
              <div className="mt-3 flex flex-col gap-4">
                <QualificationConsole target={target} sections={['improvement']} />
                {!decision.promotable ? (
                  <QualificationConsole target={target} sections={['promotion']} />
                ) : null}
              </div>
            </details>
          </div>
        </section>
      </div>
    </div>
  )
}
