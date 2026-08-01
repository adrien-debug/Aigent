import 'server-only'

import {
  isImplementedKind,
  VISUALIZATION_TIMEOUT_MS,
  type ResolvedVisualization,
  type VisualizationDefinition,
  type VisualizationState,
} from './contract'

/**
 * Registre et allowlist des visualisations — server-only.
 *
 * DEUX VERROUS, PAS UN. Une visualisation ne se rend que si (1) son identifiant
 * existe dans le registre figé ci-dessous, ET (2) l'origine résolue figure dans
 * l'allowlist. Le client n'envoie jamais d'URL : il envoie un identifiant, et
 * c'est ce module qui décide. Un proxy générique qui accepterait une URL
 * arbitraire serait un SSRF ouvert — c'est exactement ce qu'on refuse ici.
 *
 * AUCUN CREDENTIAL DANS UNE URL. L'instance locale est en anonymous Viewer,
 * publiée sur 127.0.0.1 seulement : aucun jeton n'a besoin de circuler. Si un
 * jour un jeton devient nécessaire (GPU1), il devra être porté par un
 * reverse-proxy ou un service account côté serveur — jamais par un paramètre
 * d'URL que le navigateur exposerait dans le DOM et dans les captures.
 */

/**
 * Origines autorisées. Rien d'autre ne peut être embarqué.
 *
 * Résolue depuis l'environnement pour rester alignée avec la stack locale, avec
 * une valeur par défaut qui pointe la boucle locale. Une origine absente ⇒
 * `NOT_CONFIGURED`, jamais une URL fabriquée.
 */
function grafanaOrigin(): string | null {
  const raw = process.env.GRAFANA_URL?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    // On ne conserve QUE le schéma et l'hôte : un chemin, une query ou des
    // identifiants présents dans la variable ne doivent jamais fuiter.
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

/** L'allowlist effective, calculée à chaque appel (l'env peut changer). */
export function allowedOrigins(): string[] {
  const origin = grafanaOrigin()
  return origin ? [origin] : []
}

/**
 * Une origine est-elle autorisée ?
 *
 * Comparaison sur l'ORIGINE normalisée, jamais sur un préfixe de chaîne :
 * `startsWith('http://127.0.0.1:3802')` accepterait
 * `http://127.0.0.1:3802.evil.tld`.
 */
export function isAllowedOrigin(candidate: string): boolean {
  let origin: string
  try {
    origin = new URL(candidate).origin
  } catch {
    return false
  }
  return allowedOrigins().includes(origin)
}

/**
 * Le registre figé. Quatre panneaux réels du dashboard `aigent-runs`, dont les
 * identifiants ont été relevés dans
 * `deploy/observability/grafana/dashboards/aigent-runs.json`.
 */
export const VISUALIZATIONS: readonly VisualizationDefinition[] = [
  {
    id: 'runs-volume',
    kind: 'grafana-panel',
    title: 'Volume de runs',
    description: 'Nombre total de runs observés dans la fenêtre de télémétrie.',
    dashboardUid: 'aigent-runs',
    panelId: 1,
    provenance: 'runtime_telemetry_events → summarizeFleetRuntimeTelemetry() → /api/agent-ops/metrics → Prometheus',
    aspectRatio: 16 / 9,
    minHeightPx: 220,
    timeFrom: 'now-24h',
  },
  {
    id: 'success-rate',
    kind: 'grafana-panel',
    title: 'Taux de succès',
    description:
      'Part de runs terminaux réussis. Absent — et non 0 % — si aucun run terminal n’a été mesuré.',
    dashboardUid: 'aigent-runs',
    panelId: 3,
    provenance: 'runtime_telemetry_events → summarizeFleetRuntimeTelemetry() → /api/agent-ops/metrics → Prometheus',
    aspectRatio: 16 / 9,
    minHeightPx: 220,
    timeFrom: 'now-24h',
  },
  {
    id: 'terminal-states',
    kind: 'grafana-panel',
    title: 'États terminaux',
    description:
      'Répartition completed / failed / started. Les runs en vol ne sont jamais fondus dans les succès.',
    dashboardUid: 'aigent-runs',
    panelId: 6,
    provenance: 'runtime_telemetry_events → summarizeFleetRuntimeTelemetry() → /api/agent-ops/metrics → Prometheus',
    aspectRatio: 4 / 3,
    minHeightPx: 320,
    timeFrom: 'now-24h',
  },
  {
    id: 'latency-by-agent',
    kind: 'grafana-panel',
    title: 'Latence moyenne par agent',
    description:
      'Série absente pour un agent sans latence mesurée — jamais une ligne à zéro.',
    dashboardUid: 'aigent-runs',
    panelId: 8,
    provenance: 'runtime_telemetry_events → summarizeFleetRuntimeTelemetry() → /api/agent-ops/metrics → Prometheus',
    aspectRatio: 21 / 9,
    minHeightPx: 300,
    timeFrom: 'now-24h',
  },
] as const

export function findVisualization(id: string): VisualizationDefinition | null {
  return VISUALIZATIONS.find((v) => v.id === id) ?? null
}

/** Construit l'URL d'embed d'un panneau. Aucun credential, jamais. */
function buildEmbedUrl(origin: string, def: VisualizationDefinition): string {
  const url = new URL(`/d-solo/${def.dashboardUid}/aigent`, origin)
  url.searchParams.set('panelId', String(def.panelId))
  url.searchParams.set('from', def.timeFrom)
  url.searchParams.set('to', 'now')
  // Seul paramètre de thème autorisé (cf. ALLOWED_THEME_PARAMS) : le reste du
  // thème se règle DANS Grafana, pas depuis Aigent.
  url.searchParams.set('theme', 'dark')
  return url.toString()
}

function buildSourceUrl(origin: string, def: VisualizationDefinition): string {
  const url = new URL(`/d/${def.dashboardUid}/aigent`, origin)
  url.searchParams.set('viewPanel', String(def.panelId))
  return url.toString()
}

/** Sonde bornée. Ne suit aucune redirection : un 302 vers un login est un refus. */
async function probeEmbed(url: string): Promise<{ state: VisualizationState; reason: string | null }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(VISUALIZATION_TIMEOUT_MS),
      cache: 'no-store',
    })

    // 3xx ⇒ Grafana renvoie vers son login : embedding non autorisé pour cet
    // appelant. C'est un mur d'authentification, pas une panne.
    if (res.status >= 300 && res.status < 400) {
      return {
        state: 'UNAVAILABLE',
        reason: 'La source redirige vers une authentification : l’embedding anonyme n’est pas autorisé.',
      }
    }
    if (res.status === 401 || res.status === 403) {
      return { state: 'UNAVAILABLE', reason: `La source refuse l’appel (HTTP ${res.status}).` }
    }
    if (!res.ok) {
      return { state: 'UNAVAILABLE', reason: `La source répond HTTP ${res.status}.` }
    }
    // Un `X-Frame-Options` restant rendrait l'iframe blanche sans erreur
    // visible : mieux vaut le dire que d'afficher un cadre vide.
    const xfo = res.headers.get('x-frame-options')
    if (xfo && /deny|sameorigin/i.test(xfo)) {
      return {
        state: 'UNAVAILABLE',
        reason: `La source interdit l’intégration (X-Frame-Options: ${xfo}).`,
      }
    }
    return { state: 'READY', reason: null }
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    return {
      state: 'UNAVAILABLE',
      reason: timedOut
        ? `La source n’a pas répondu en ${VISUALIZATION_TIMEOUT_MS} ms.`
        : 'Source injoignable à cette adresse.',
    }
  }
}

/**
 * Résout une visualisation en URL vérifiée + état de vérité.
 *
 * FAIL-CLOSED à chaque étape : identifiant inconnu, mode non implémenté,
 * origine absente ou refusée, source muette — chacun produit un état honnête et
 * AUCUNE URL rendable.
 */
export async function resolveVisualization(id: string): Promise<ResolvedVisualization | null> {
  const def = findVisualization(id)
  if (!def) return null

  const base: Omit<ResolvedVisualization, 'state' | 'reason' | 'embedUrl' | 'sourceUrl' | 'resolvedAt'> = def

  // Un mode déclaré mais non implémenté ne peut jamais être rendu. Sans ce
  // garde, ajouter une entrée `vega-spec` au registre suffirait à afficher un
  // cadre vide présenté comme fonctionnel.
  if (!isImplementedKind(def.kind)) {
    return {
      ...base,
      embedUrl: '',
      sourceUrl: '',
      state: 'NOT_CONFIGURED',
      reason: `Le mode « ${def.kind} » est déclaré dans le contrat mais n’est pas implémenté.`,
      resolvedAt: null,
    }
  }

  const origin = grafanaOrigin()
  if (!origin) {
    return {
      ...base,
      embedUrl: '',
      sourceUrl: '',
      state: 'NOT_CONFIGURED',
      reason: 'GRAFANA_URL n’est pas renseigné : aucune source à interroger.',
      resolvedAt: null,
    }
  }

  const embedUrl = buildEmbedUrl(origin, def)

  // Second verrou : même construite par nous, l'URL repasse par l'allowlist.
  if (!isAllowedOrigin(embedUrl)) {
    return {
      ...base,
      embedUrl: '',
      sourceUrl: '',
      state: 'UNAVAILABLE',
      reason: 'L’origine résolue n’est pas dans l’allowlist.',
      resolvedAt: null,
    }
  }

  const probe = await probeEmbed(embedUrl)
  return {
    ...base,
    embedUrl: probe.state === 'READY' ? embedUrl : '',
    sourceUrl: buildSourceUrl(origin, def),
    state: probe.state,
    reason: probe.reason,
    resolvedAt: new Date().toISOString(),
  }
}

/** Résout tout le registre en parallèle : une source lente n'en bloque pas une autre. */
export async function resolveAllVisualizations(): Promise<ResolvedVisualization[]> {
  const resolved = await Promise.all(VISUALIZATIONS.map((v) => resolveVisualization(v.id)))
  return resolved.filter((v): v is ResolvedVisualization => v !== null)
}
