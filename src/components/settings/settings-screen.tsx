/**
 * Surface « Réglages » — la posture de configuration du plan de contrôle,
 * EN LECTURE SEULE.
 *
 * CE QUE CET ÉCRAN EST. Un miroir de ce qui est branché ici et maintenant :
 * quels providers sont câblés, quel runtime exécute vraiment, quels endpoints
 * sont résolus, quels plafonds de coût s'appliquent, si LangGraph est joignable,
 * si l'ingestion de télémétrie est ouverte. Un opérateur y répond à une seule
 * question : « pourquoi cet agent ne peut-il pas tourner ? ».
 *
 * CE QUE CET ÉCRAN N'EST PAS. Un formulaire. Il n'y a ici aucun champ, aucun
 * bouton de mutation, aucune action distante — et ce n'est pas un manque. La
 * configuration d'Aigent vit dans l'environnement du serveur ; l'éditer depuis
 * une page web voudrait dire l'écrire quelque part, donc lire et réécrire des
 * secrets à travers le navigateur. La lecture seule est la conception, pas une
 * étape intermédiaire.
 *
 * LES SECRETS. Aucune valeur de secret n'atteint ce composant : le contrat
 * serveur (`settings-posture.ts`) n'expose que des booléens, des statuts, des
 * messages et des endpoints déjà assainis. Les seules chaînes ressemblant à de
 * la configuration rendues ici sont des NOMS de variables, littéraux, écrits
 * dans ce fichier — jamais lus depuis l'environnement.
 *
 * QUATRE ÉTATS. `configuré` / `partiel` / `indisponible` / `non configuré` sont
 * distincts partout, et « non configuré » n'est jamais peint comme une panne :
 * un environnement sans Langfuse n'est pas cassé. L'échec de lecture global est
 * traité par la page, qui rend `SurfaceUnavailable` — « je n'ai pas pu lire »
 * n'est pas « tout est absent ».
 */
import { Panel } from '@/components/cockpit/primitives'
import { PageBody, PageHeader } from '@/components/app-shell'
import { SeverityChip, SurfaceStat } from '@/components/surface-primitives'
import type {
  SettingsCostLimit,
  SettingsPostureSnapshot,
  SettingsProviderSignal,
  SettingsRuntimeSignal,
} from '@/lib/agent-mission-control/settings-posture'

import { CapabilityRow, EndpointLine, EnvVarNames, StatusChip } from './atoms'

/**
 * Les variables consultées par chaque signal, en clair.
 *
 * Ce sont des NOMS, écrits ici en littéral : ils ne sont jamais lus depuis
 * `process.env`, et il est structurellement impossible qu'une valeur se glisse
 * dans cette table. Ils rendent la page actionnable — sans eux, « non
 * configuré » n'indique pas quoi renseigner.
 */
const PROVIDER_ENV_VARS: Record<SettingsProviderSignal['provider'], readonly string[]> = {
  openai: ['OPENAI_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  local: [
    'VLLM_LOCAL_API_KEY',
    'VLLM_GPU1_REASONING_URL',
    'VLLM_GPU2_LLAMA_URL',
    'VLLM_GPU1_QWEN32_URL',
    'VLLM_GPU1_QWEN7_URL',
  ],
  mistral: [],
}

const PROVIDER_LABEL: Record<SettingsProviderSignal['provider'], string> = {
  openai: 'OpenAI',
  google: 'Google (Gemini)',
  local: 'vLLM local',
  mistral: 'Mistral',
}

function ProviderRow({ item }: Readonly<{ item: SettingsProviderSignal }>) {
  return (
    <CapabilityRow
      label={PROVIDER_LABEL[item.provider]}
      status={item.status}
      message={item.message}
      provenance={item.provenance}
    >
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {/* Le câblage et la configuration sont deux faits SÉPARÉS. Un provider
            peut être exécutable sans clé (à renseigner) ou câblé nulle part (à
            coder). Les fusionner enverrait l'opérateur éditer un `.env` pour un
            provider qui n'a pas de code derrière. */}
        <SeverityChip
          tone={item.executable ? 'good' : 'neutral'}
          title={
            item.executable
              ? 'Câblé : du code de ce dépôt sait réellement appeler ce provider.'
              : 'Non câblé : aucun code n’appelle ce provider. Renseigner une clé n’y changerait rien.'
          }
        >
          {item.executable ? 'câblé' : 'non câblé'}
        </SeverityChip>
        <SeverityChip
          tone={item.configured ? 'good' : 'neutral'}
          title="Présence seule d’un identifiant dans l’environnement du serveur. Sa valeur n’est jamais lue par cette surface."
        >
          {item.configured ? 'identifiant présent' : 'identifiant absent'}
        </SeverityChip>
      </div>
      <EnvVarNames names={PROVIDER_ENV_VARS[item.provider]} />
    </CapabilityRow>
  )
}

function RuntimeRow({ item }: Readonly<{ item: SettingsRuntimeSignal }>) {
  return (
    <li className="aig-line-soft border-t px-4 py-3 first:border-t-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="aig-text min-w-0 truncate font-medium">{item.label}</span>
        <code className="aig-text-muted text-xs">{item.id}</code>
        <SeverityChip
          tone={item.executable ? 'good' : 'neutral'}
          title={
            item.executable
              ? 'Moteur réel — ce runtime exécute vraiment.'
              : 'Aucun moteur derrière cet identifiant : il ne s’exécute pas et ne peut pas être choisi à la création.'
          }
        >
          {item.executable ? `moteur ${item.engine}` : 'aucun moteur'}
        </SeverityChip>
        <span className="aig-text-faint text-xs">
          {item.creatable ? 'sélectionnable à la création' : 'non sélectionnable'}
        </span>
      </div>
      <p className="aig-text-muted mt-1 text-sm">{item.note}</p>
    </li>
  )
}

/**
 * Un plafond de coût. `limitUsd === null` ne rend JAMAIS `0` ni `—` muet :
 * l'absence de chiffre global est un fait qui s'écrit, et le niveau où le
 * plafond est réellement défini est dit à côté.
 */
function CostLimitRow({ item }: Readonly<{ item: SettingsCostLimit }>) {
  return (
    <li className="aig-line-soft border-t px-4 py-3 first:border-t-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="aig-text min-w-0 truncate font-medium">{item.scope}</span>
        {item.limitUsd === null ? (
          <SeverityChip
            tone="neutral"
            title="Aucun plafond global à ce niveau — la valeur est portée par chaque agent, pas par la configuration du serveur."
          >
            défini par agent
          </SeverityChip>
        ) : (
          <span className="aig-text tabular-nums font-medium">
            {item.limitUsd.toFixed(2)} USD
            <span className="aig-text-faint ml-1 text-xs font-normal">
              {item.unit === 'usd_per_run' ? '/ run' : '/ boucle'}
            </span>
          </span>
        )}
        <SeverityChip
          tone={item.enforced ? 'good' : 'warn'}
          title={
            item.enforced
              ? 'Plafond vérifié avant chaque appel facturé, pas constaté après coup.'
              : 'Plafond déclaré mais non vérifié à l’exécution.'
          }
        >
          {item.enforced ? 'appliqué' : 'non appliqué'}
        </SeverityChip>
      </div>
      <p className="aig-text-muted mt-1 text-sm">{item.detail}</p>
      <p className="aig-text-faint mt-1 text-xs">
        Défini dans&nbsp;: <code className="aig-text-faint">{item.source}</code>
      </p>
    </li>
  )
}

export default function SettingsScreen({
  posture,
}: Readonly<{ posture: SettingsPostureSnapshot }>) {
  const { runtimes, providers, observability, costLimits } = posture

  return (
    <>
      <PageHeader
        eyebrow="Plan de contrôle"
        title="Réglages"
        description="Posture de configuration du serveur, en lecture seule. Aucune valeur de secret n’est affichée."
        meta={
          <>
            <SurfaceStat label="Posture globale" value={<StatusChip status={posture.status} />} />
            <SurfaceStat
              label="Runtime actif"
              value={
                runtimes.active ? (
                  runtimes.active.label
                ) : (
                  <span className="aig-text-muted text-xs uppercase">aucun</span>
                )
              }
              hint={runtimes.active ? `moteur ${runtimes.active.engine}` : runtimes.message}
            />
            <SurfaceStat
              label="Providers exécutables prêts"
              value={
                <span className="tabular-nums">
                  {providers.items.filter((item) => item.executable && item.configured).length}
                  {' / '}
                  {providers.items.filter((item) => item.executable).length}
                </span>
              }
              hint="câblés et identifiant présent"
            />
            <SurfaceStat
              label="Relevé"
              value={<span className="tabular-nums">{posture.checkedAt}</span>}
              hint="instant de lecture, pas une moyenne"
            />
          </>
        }
      />

      <PageBody>
        {/* Le message d'ensemble d'abord : il dit en une phrase pourquoi la
            posture n'est pas « configuré », avant que l'œil descende. */}
        <p className="aig-text-muted text-sm">{posture.message}</p>

        {/* Deux colonnes en large, une seule en étroit. Aucune colonne n'est
            masquée sous un point de rupture : elles s'empilent — un état caché
            sur petit écran serait un écran qui ment par omission. */}
        <div className="grid min-w-0 gap-5 xl:grid-cols-2">
          <Panel
            title="Providers de modèle"
            hint={providers.message}
            padded={false}
            scrollable
            bodyClassName="max-h-[26rem]"
          >
            <div className="min-w-0">
              {providers.items.map((item) => (
                <ProviderRow key={item.provider} item={item} />
              ))}
            </div>
          </Panel>

          <Panel
            title="Runtime d’exécution"
            hint={runtimes.message}
            padded={false}
            scrollable
            bodyClassName="max-h-[26rem]"
          >
            <ul className="min-w-0">
              {runtimes.items.map((item) => (
                <RuntimeRow key={item.id} item={item} />
              ))}
            </ul>
          </Panel>

          <Panel title="Frontières et endpoints" padded={false} scrollable bodyClassName="max-h-[26rem]">
            <div className="min-w-0">
              <CapabilityRow
                label="Authentification opérateur"
                status={posture.operatorAuth.status}
                message={posture.operatorAuth.message}
                provenance={posture.operatorAuth.provenance}
              >
                <EnvVarNames
                  names={['AMC_SESSION_SECRET', 'AMC_ADMIN_PASSWORD_HASH', 'AMC_API_KEY']}
                />
              </CapabilityRow>

              <CapabilityRow
                label="Backend GPU1 (PostgREST)"
                status={posture.backendGpu1.status}
                message={posture.backendGpu1.message}
                provenance={posture.backendGpu1.provenance}
              >
                <EndpointLine endpoint={posture.backendGpu1.endpoint} />
                <EnvVarNames
                  names={['AMC_DATA_SOURCE', 'AMC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']}
                />
              </CapabilityRow>

              <CapabilityRow
                label="LangGraph Agent Server"
                status={posture.langgraph.status}
                message={posture.langgraph.message}
                provenance={posture.langgraph.provenance}
              >
                <EndpointLine endpoint={posture.langgraph.endpoint} />
                <EnvVarNames names={['LANGGRAPH_API_URL', 'LANGGRAPH_SERVER_SECRET']} />
              </CapabilityRow>

              <CapabilityRow
                label="Shipping GitHub"
                status={posture.githubShipping.status}
                message={posture.githubShipping.message}
                provenance={posture.githubShipping.provenance}
              >
                <EndpointLine endpoint={posture.githubShipping.endpoint} />
                <EnvVarNames names={['GITHUB_TOKEN', 'GITHUB_PUSH_ENABLED']} />
              </CapabilityRow>

              <CapabilityRow
                label="Learning runtime"
                status={posture.learningRuntime.status}
                message={posture.learningRuntime.message}
                provenance={posture.learningRuntime.provenance}
              >
                <EndpointLine endpoint={posture.learningRuntime.endpoint} />
                {/* `capabilities === null` = la liste n'a pas pu être lue. Une
                    liste vide dirait « aucune capacité », ce qui n'est pas su. */}
                {posture.learningRuntime.capabilities === null ? (
                  <p className="aig-text-faint mt-1 text-xs">
                    Capacités non lues — la liste est inconnue, pas vide.
                  </p>
                ) : posture.learningRuntime.capabilities.length === 0 ? (
                  <p className="aig-text-faint mt-1 text-xs">
                    Aucune capacité déclarée — lecture réussie, liste vide.
                  </p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {posture.learningRuntime.capabilities.map((capability) => (
                      <SeverityChip key={capability} tone="neutral">
                        {capability}
                      </SeverityChip>
                    ))}
                  </div>
                )}
              </CapabilityRow>
            </div>
          </Panel>

          <Panel title="Télémétrie et observabilité" padded={false} scrollable bodyClassName="max-h-[26rem]">
            <div className="min-w-0">
              <CapabilityRow
                label="Ingestion de télémétrie runtime"
                status={posture.telemetryIngestion.status}
                message={posture.telemetryIngestion.message}
                provenance={posture.telemetryIngestion.provenance}
              >
                <EndpointLine endpoint={posture.telemetryIngestion.endpoint} />
                <EnvVarNames names={['AIGENT_RUNTIME_TELEMETRY_TOKEN']} />
              </CapabilityRow>

              <CapabilityRow
                label="Export LangSmith"
                status={observability.langsmith.status}
                message={observability.langsmith.message}
                provenance={observability.langsmith.provenance}
              >
                <EndpointLine endpoint={observability.langsmith.endpoint} />
                <EnvVarNames
                  names={['LANGSMITH_API_KEY', 'LANGSMITH_ENDPOINT', 'LANGSMITH_TRACE_BASE_URL']}
                />
              </CapabilityRow>

              <CapabilityRow
                label="Export Langfuse"
                status={observability.langfuse.status}
                message={observability.langfuse.message}
                provenance={observability.langfuse.provenance}
              >
                <EndpointLine endpoint={observability.langfuse.endpoint} />
                <EnvVarNames
                  names={['LANGFUSE_HOST', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY']}
                />
              </CapabilityRow>
            </div>
          </Panel>

          <Panel
            title="Plafonds de coût"
            hint={costLimits.message}
            padded={false}
            scrollable
            bodyClassName="max-h-[26rem]"
            className="xl:col-span-2"
          >
            <ul className="min-w-0">
              {costLimits.items.map((item) => (
                <CostLimitRow key={item.scope} item={item} />
              ))}
            </ul>
          </Panel>
        </div>

        {/* Dit une fois, en bas, plutôt que répété sur chaque ligne : cette
            surface ne peut RIEN écrire, et aucune valeur de secret n'y transite.
            L'absence de bouton est une décision, elle mérite d'être écrite. */}
        <p className="aig-text-faint text-xs">
          Surface en lecture seule&nbsp;: elle n’écrit aucune configuration et n’expose aucune valeur
          de secret. Un identifiant n’y apparaît que comme présent ou absent, avec le nom de sa
          variable. La configuration se modifie dans l’environnement du serveur.
        </p>
      </PageBody>
    </>
  )
}
