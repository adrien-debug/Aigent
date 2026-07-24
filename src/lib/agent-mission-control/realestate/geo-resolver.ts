/**
 * AIG-REALESTATE-001 — address → (INSEE, cadastral section, lat/lon) resolver.
 *
 * DVF's `mutations3` endpoint is addressed by commune + cadastral SECTION, but
 * an estimator starts from a postal address. This resolver bridges the two, via
 * two public, no-key official APIs (both probed live):
 *
 *   1. BAN geocode  — data.geopf.fr/geocodage/search  → lon/lat + INSEE (citycode)
 *   2. Cadastre IGN — apicarto.ign.fr/api/cadastre/parcelle?geom=<Point>
 *                     → the parcel under the point → section_prefixe
 *
 * The DVF section format is `com_abs`(3) + `section`(2), e.g. '000AH' — NOT a
 * hardcoded '000' prefix: `com_abs` is the absorbed-commune code (usually '000'
 * but not always). The chain closes: id_parcelle = INSEE + section_prefixe +
 * numero (e.g. '06004' + '000AH' + '0142' = '06004000AH0142').
 *
 * Same discipline as the providers: read-only, SSRF-gated by the shared guard,
 * NEVER throws — an unresolvable address / low-confidence geocode / source down
 * resolves to `null` + an UNAVAILABLE provenance, never a guessed section.
 */

import 'server-only'

import { guardedFetch, validateHttpUrl } from '../../../langgraph/http-guard.mjs'
import type { Provenance, RealEstateSourceType } from './truth'
import { makeProvenance, unavailableProvenance } from './truth'

export interface ResolvedLocation {
  /** Original address as echoed by the geocoder (`label`). */
  readonly label: string
  readonly inseeCode: string
  /** DVF section prefix, e.g. '000AH' — feeds read_dvf_comparables `section`. */
  readonly section: string
  readonly lat: number
  readonly lon: number
  /** Full cadastral parcel id, e.g. '06004000AH0142'. */
  readonly parcelId: string | null
  /** Geocoder confidence [0,1] — below the floor the resolve is refused. */
  readonly geocodeScore: number
}

export interface ResolveResult {
  value: ResolvedLocation | null
  provenance: Provenance
}

export interface ResolveContext {
  asOf: number
}

/** Below this geocoder score the address is too ambiguous to trust a section. */
const MIN_GEOCODE_SCORE = 0.4
const DEFAULT_TIMEOUT_MS = 8000

const BAN_BASE_URL = 'https://data.geopf.fr'
const CADASTRE_BASE_URL = 'https://apicarto.ign.fr'

type FetchOutcome = { ok: true; body: unknown } | { ok: false; reason: string }

export class GeoResolver {
  readonly sourceType: RealEstateSourceType = 'ban'
  private readonly banBase: string
  private readonly cadastreBase: string
  private readonly timeoutMs: number
  private readonly banHost: string | null
  private readonly cadastreHost: string | null
  private readonly configError: string | null

  constructor(opts?: {
    banBaseUrl?: string
    cadastreBaseUrl?: string
    timeoutMs?: number
  }) {
    this.banBase = (opts?.banBaseUrl ?? BAN_BASE_URL).replace(/\/+$/, '')
    this.cadastreBase = (opts?.cadastreBaseUrl ?? CADASTRE_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const b = validateHttpUrl(this.banBase)
    const c = validateHttpUrl(this.cadastreBase)
    this.banHost = b.ok ? b.host : null
    this.cadastreHost = c.ok ? c.host : null
    this.configError = !b.ok
      ? `invalid BAN URL: ${b.reason}`
      : !c.ok
        ? `invalid cadastre URL: ${c.reason}`
        : null
  }

  private async fetchJson(
    url: string,
    host: string | null,
  ): Promise<FetchOutcome> {
    if (!host) {
      return { ok: false, reason: this.configError ?? 'invalid geo source URL' }
    }
    const out = await guardedFetch(url, {
      allowedHosts: [host],
      timeoutMs: this.timeoutMs,
      headers: { accept: 'application/json' },
      readBody: async (res) => (res.ok ? ((await res.json()) as unknown) : null),
    })
    if (!out.ok) return { ok: false, reason: out.reason }
    if (!out.httpOk) return { ok: false, reason: `HTTP ${out.status}` }
    return { ok: true, body: out.body }
  }

  async resolve(address: string, ctx: ResolveContext): Promise<ResolveResult> {
    const trimmed = address.trim()
    if (trimmed === '') {
      return this.unavailable(ctx, 'empty address')
    }

    // Step 1 — geocode.
    const geoUrl = `${this.banBase}/geocodage/search?q=${encodeURIComponent(trimmed)}&limit=1`
    const geo = await this.fetchJson(geoUrl, this.banHost)
    if (!geo.ok) return this.unavailable(ctx, `geocode failed: ${geo.reason}`)

    const feat = firstFeature(geo.body)
    if (!feat) return this.unavailable(ctx, `no geocode match for '${trimmed}'`)

    const coords = feat.geometry?.coordinates
    const lon = numOrNull(coords?.[0])
    const lat = numOrNull(coords?.[1])
    const props = feat.properties ?? {}
    const score = numOrNull(props.score) ?? 0
    const inseeCode = strOrNull(props.citycode)
    const label = strOrNull(props.label) ?? trimmed

    if (lon === null || lat === null || inseeCode === null) {
      return this.unavailable(ctx, `geocode response missing coordinates/citycode for '${trimmed}'`)
    }
    if (score < MIN_GEOCODE_SCORE) {
      return this.unavailable(
        ctx,
        `geocode too ambiguous (score ${score.toFixed(2)} < ${MIN_GEOCODE_SCORE}) for '${trimmed}'`,
      )
    }

    // Step 2 — parcel under the point → section.
    const pointGeom = JSON.stringify({ type: 'Point', coordinates: [lon, lat] })
    const parcelUrl = `${this.cadastreBase}/api/cadastre/parcelle?geom=${encodeURIComponent(pointGeom)}`
    const parcel = await this.fetchJson(parcelUrl, this.cadastreHost)
    if (!parcel.ok) return this.unavailable(ctx, `cadastre lookup failed: ${parcel.reason}`)

    const pFeat = firstFeature(parcel.body)
    const pProps = pFeat?.properties ?? null
    if (!pProps) {
      return this.unavailable(ctx, `no cadastral parcel under ${lat},${lon}`)
    }
    const comAbs = strOrNull(pProps.com_abs) ?? '000'
    const section = strOrNull(pProps.section)
    if (section === null) {
      return this.unavailable(ctx, `cadastral parcel has no section under ${lat},${lon}`)
    }
    const sectionPrefix = `${comAbs}${section}`
    const parcelId = strOrNull(pProps.idu)

    return {
      value: {
        label,
        inseeCode,
        section: sectionPrefix,
        lat,
        lon,
        parcelId,
        geocodeScore: score,
      },
      provenance: makeProvenance({
        source: `${this.banBase}/geocodage + ${this.cadastreBase}/cadastre`,
        sourceType: 'composite',
        // A geocode/cadastre lookup is a current, authoritative answer.
        truth: 'LIVE',
        dataTimestamp: ctx.asOf,
        asOf: ctx.asOf,
        maxAgeMs: null,
        confidence: Math.max(0, Math.min(1, score)),
      }),
    }
  }

  private unavailable(ctx: ResolveContext, reason: string): ResolveResult {
    return {
      value: null,
      provenance: unavailableProvenance({
        source: `${this.banBase}/geocodage + ${this.cadastreBase}/cadastre`,
        sourceType: this.sourceType,
        asOf: ctx.asOf,
        reason,
      }),
    }
  }
}

// ---------------------------------------------------------------------------
// Wire parsing — total, never throws.
// ---------------------------------------------------------------------------

interface GeoFeature {
  geometry?: { coordinates?: unknown[] }
  properties?: Record<string, unknown>
}

/** Pull the first GeoJSON feature out of a FeatureCollection, or null. */
function firstFeature(body: unknown): GeoFeature | null {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (Array.isArray(obj.features) && obj.features.length > 0) {
      const f = obj.features[0]
      return f && typeof f === 'object' ? (f as GeoFeature) : null
    }
  }
  return null
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' || s === 'None' ? null : s
}
