/**
 * AIG-REALESTATE-001 — official real-estate data provider (read-only).
 *
 * The provider is the ONLY place the real-estate tools touch a data source —
 * exactly the boundary `market/provider.ts` draws for trading. Two
 * implementations satisfy the contract:
 *
 *   - DvfHttpProvider — reads DVF (Demandes de Valeurs Foncières) from Etalab's
 *     PUBLIC endpoint (`app.dvf.etalab.gouv.fr/api/...`, REST, no key). This is
 *     the only source in the audit with a public, no-account, no-scraping API,
 *     and the one `valuation-agent.spec.md` §7 explicitly authorises
 *     ("transactions publiques type DVF — lecture seule"). Read-only,
 *     timeout-bounded, NEVER throws on a bad source (returns an
 *     UNAVAILABLE-shaped result). Every mutation it returns is `HISTORICAL`
 *     (DVF lags signature by ~6 months — never "now"). SSRF-gated by the SHARED
 *     guard in `src/langgraph/http-guard.mjs`, host PINNED at construction.
 *
 *   - FixtureRealEstateProvider — serves hand-authored HISTORICAL/FIXTURE
 *     mutations from `./fixtures`. Lab-only; every datum is tagged
 *     truth: 'FIXTURE' so it can NEVER be mistaken for a real official value.
 *
 * A source genuinely out of coverage (Alsace-Moselle 67/68/57, Mayotte 976 —
 * the Livre Foncier gap DVF has everywhere) resolves to `null` + an UNAVAILABLE
 * provenance carrying that reason — never a fabricated comparable. This is the
 * spec §8 invariant ("aucune valeur officielle inventée — trou documenté,
 * jamais comblé") expressed in code, so `gather_official_sources` can consume a
 * real source behind a stable contract with zero tool change.
 */

import 'server-only'

import { guardedFetch, validateHttpUrl } from '../../../langgraph/http-guard.mjs'
import type { Provenance, RealEstateSourceType, TruthStatus } from './truth'
import { makeProvenance, unavailableProvenance } from './truth'

/** Property types DVF distinguishes (`type_local`). */
export type DvfPropertyType = 'appartement' | 'maison'

/**
 * One real, confirmed mutation from DVF. Prices/areas are lossless decimal
 * STRINGS (spec §6) — never float. `pricePerSqmEur` is `FALLBACK`-grade when we
 * derive it (division of two source numbers), so callers can tell a primary
 * value from a derived one; it is null when the surface is 0/absent.
 */
export interface DvfComparable {
  /** Stable id for this mutation (DVF `id_mutation`). One per mutation even
   *  when DVF splits a multi-lot sale across several rows (see dedup below). */
  readonly mutationId: string
  /** ISO date of the mutation (DVF `date_mutation`), e.g. '2025-03-14'. */
  readonly dateMutation: string
  readonly propertyType: DvfPropertyType | 'other'
  /** Sale price in EUR, decimal string. The mutation total — NOT multiplied by
   *  the number of rows DVF split it into. */
  readonly valueEur: string
  /** Summed built area m² across the mutation's rows, decimal string, or null
   *  when DVF has none. Summed (not first-row) so €/m² reflects the whole sale. */
  readonly surfaceM2: string | null
  /** valueEur / surfaceM2, decimal string, or null when not derivable. */
  readonly pricePerSqmEur: string | null
  readonly roomCount: number | null
  readonly address: string | null
  readonly inseeCode: string | null
  readonly postalCode: string | null
  /** Geolocation from DVF (`latitude`/`longitude`), for radius filtering. */
  readonly lat: number | null
  readonly lon: number | null
}

/** One provider result: the payload (or null) + its provenance. */
export interface ProviderResult<T> {
  value: T | null
  provenance: Provenance
}

export interface ProviderContext {
  /** Point-in-time the read answers for (epoch ms). Defaults to Date.now(). */
  asOf: number
  /** Max acceptable age for a real-time read; null = no bound. DVF is
   *  HISTORICAL, so this never blanks a DVF read — it is carried for callers
   *  that mix DVF with a genuinely live source later. */
  maxAgeMs: number | null
}

/**
 * Query for comparable DVF sales in a commune section.
 *
 * `section` is REQUIRED: the Etalab `mutations3` endpoint is addressed
 * `/<insee>/<section>` and returns 404 for a commune with no section — a fact
 * established by a live probe. A caller with only an address resolves it to a
 * section upstream (BAN geocode → cadastre parcel → section); this provider
 * does not geocode. `centerLat`/`centerLon`/`radiusMeters` optionally narrow
 * the returned mutations to a radius around a point, using the lat/lon DVF
 * carries on each mutation.
 */
export interface DvfQuery {
  /** INSEE commune code (5 chars), e.g. '06004' for Antibes. */
  inseeCode: string
  /** Cadastral section prefix (DVF `section_prefixe`), e.g. '000AH'. Required. */
  section: string
  propertyType?: DvfPropertyType
  /** Only mutations on/after this ISO date (e.g. '2022-01-01'). */
  fromDate?: string
  /** Only mutations on/before this ISO date. */
  toDate?: string
  /** Optional radius filter centre (decimal degrees). */
  centerLat?: number
  centerLon?: number
  /** Keep only mutations within this many metres of the centre. */
  radiusMeters?: number
}

/**
 * The provider contract. Read-only, async, resolves to a ProviderResult —
 * NEVER throws for an unavailable datum (returns UNAVAILABLE). A provider
 * implements only what it truly has.
 */
export interface RealEstateDataProvider {
  readonly id: string
  readonly sourceType: RealEstateSourceType
  /** Read confirmed comparable sales near a commune/section. */
  getComparables(
    query: DvfQuery,
    ctx: ProviderContext,
  ): Promise<ProviderResult<DvfComparable[]>>
}

// ---------------------------------------------------------------------------
// Coverage gap — DVF has no data for the Livre Foncier départements.
// ---------------------------------------------------------------------------

/** Bas-Rhin, Haut-Rhin, Moselle (Alsace-Moselle) + Mayotte — DVF excludes them
 *  everywhere. Detected on the département prefix of the INSEE code so a query
 *  in those zones fails CLOSED with a truthful reason instead of a silent empty
 *  result the caller might read as "no comparable exists". */
const DVF_UNCOVERED_DEPARTEMENTS = new Set(['67', '68', '57', '976'])

function departementOf(inseeCode: string): string {
  // Mayotte and the DOM use a 3-digit prefix; metropolitan is 2.
  return inseeCode.startsWith('97') || inseeCode.startsWith('98')
    ? inseeCode.slice(0, 3)
    : inseeCode.slice(0, 2)
}

// ---------------------------------------------------------------------------
// DVF HTTP provider — Etalab public API (app.dvf.etalab.gouv.fr).
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 6000
/** Etalab public DVF endpoint. Override via DVF_API_URL for a self-hosted
 *  mirror or a paid SLA-backed proxy (audit: never depend on the cquest PoC).*/
const DEFAULT_DVF_BASE_URL = 'https://app.dvf.etalab.gouv.fr'

type FetchOutcome = { ok: true; body: unknown } | { ok: false; reason: string }

/** DVF wire mutation shape (subset we consume) from Etalab's JSON. Every field
 *  arrives as a STRING, with absent values as the sentinels 'None'/'nan'. */
interface WireMutation {
  id_mutation?: string
  date_mutation?: string
  nature_mutation?: string
  valeur_fonciere?: number | string
  type_local?: string
  surface_reelle_bati?: number | string
  nombre_pieces_principales?: number | string
  adresse_numero?: number | string
  adresse_nom_voie?: string
  code_commune?: string
  code_postal?: string | number
  /** Parcel id — used to dedupe a surface line repeated across a mutation's rows. */
  id_parcelle?: string
  latitude?: number | string
  longitude?: number | string
}

export class DvfHttpProvider implements RealEstateDataProvider {
  readonly id: string
  readonly sourceType: RealEstateSourceType = 'dvf'
  private readonly baseUrl: string
  private readonly timeoutMs: number
  /** SSRF pin: the ONLY host any request (incl. redirect hops) may reach. Null
   *  when the configured URL failed validation — every fetch then fails closed
   *  without a socket. Set once at construction (never re-derived from an
   *  attacker-influenced value), exactly like HttpMarketProvider. */
  private readonly allowedHost: string | null
  private readonly configError: string | null

  constructor(opts?: { baseUrl?: string; timeoutMs?: number }) {
    this.baseUrl = (opts?.baseUrl ?? DEFAULT_DVF_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.id = `dvf:${this.baseUrl}`
    const validated = validateHttpUrl(this.baseUrl)
    this.allowedHost = validated.ok ? validated.host : null
    this.configError = validated.ok
      ? null
      : `invalid DVF base URL: ${validated.reason}`
  }

  private async fetchJson(path: string): Promise<FetchOutcome> {
    // FAIL CLOSED: a rejected config never reaches the network.
    if (!this.allowedHost) {
      return { ok: false, reason: this.configError ?? 'invalid DVF base URL' }
    }
    const out = await guardedFetch(`${this.baseUrl}${path}`, {
      allowedHosts: [this.allowedHost],
      timeoutMs: this.timeoutMs,
      headers: { accept: 'application/json' },
      // Non-2xx bodies are never parsed: the status IS the answer.
      readBody: async (res) => (res.ok ? ((await res.json()) as unknown) : null),
    })
    if (!out.ok) return { ok: false, reason: out.reason }
    if (!out.httpOk) {
      return { ok: false, reason: `HTTP ${out.status} from ${this.baseUrl}${path}` }
    }
    return { ok: true, body: out.body }
  }

  async getComparables(
    query: DvfQuery,
    ctx: ProviderContext,
  ): Promise<ProviderResult<DvfComparable[]>> {
    // Coverage gate — fail closed with a truthful reason on the DVF blind spot.
    const dept = departementOf(query.inseeCode)
    if (DVF_UNCOVERED_DEPARTEMENTS.has(dept)) {
      return {
        value: null,
        provenance: unavailableProvenance({
          source: `${this.id}/api/mutations3`,
          sourceType: this.sourceType,
          asOf: ctx.asOf,
          reason: `DVF has no coverage for département ${dept} (Livre Foncier: Alsace-Moselle / Mayotte)`,
        }),
      }
    }

    // Etalab addresses mutations by commune + REQUIRED cadastral section:
    // /api/mutations3/<insee>/<section>. A live probe confirmed the section is
    // mandatory (commune-only → 404); a caller resolves it upstream.
    const path = `/api/mutations3/${encodeURIComponent(query.inseeCode)}/${encodeURIComponent(query.section)}`

    const fetched = await this.fetchJson(path)
    if (!fetched.ok) {
      return {
        value: null,
        provenance: unavailableProvenance({
          source: `${this.id}/api/mutations3`,
          sourceType: this.sourceType,
          asOf: ctx.asOf,
          reason: fetched.reason,
        }),
      }
    }

    const rows = extractMutations(fetched.body)
    if (rows === null) {
      // Shape we did not recognise — treat as UNAVAILABLE, never as "empty".
      return {
        value: null,
        provenance: unavailableProvenance({
          source: `${this.id}/api/mutations3`,
          sourceType: this.sourceType,
          asOf: ctx.asOf,
          reason: `unrecognised DVF response shape for ${query.inseeCode}/${query.section}`,
        }),
      }
    }

    // Fold rows into mutations, deduped by id_mutation. DVF splits ONE sale
    // across several rows (one per lot) that repeat the SAME valeur_fonciere;
    // taking each row as a comparable would count the price N times and produce
    // false €/m². We keep one comparable per mutation and SUM the surfaces.
    const comparables = foldMutations(rows).filter((c) => matchesQuery(c, query))

    if (comparables.length === 0) {
      // A genuine empty result (no matching mutation) is still UNAVAILABLE, not
      // a fabricated comparable — the spec forbids filling the gap.
      return {
        value: null,
        provenance: unavailableProvenance({
          source: `${this.id}/api/mutations3`,
          sourceType: this.sourceType,
          asOf: ctx.asOf,
          reason: `no DVF mutation matched ${query.inseeCode}/${query.section}${
            query.propertyType ? ` (${query.propertyType})` : ''
          }`,
        }),
      }
    }

    // Provenance dated to the most recent matched mutation — DVF is HISTORICAL
    // by construction (published ~6 months after signature), so it is exempt
    // from staleness downgrade in makeProvenance.
    const newest = comparables.reduce(
      (a, b) => (a.dateMutation >= b.dateMutation ? a : b),
      comparables[0],
    )
    const dataTimestamp = Date.parse(newest.dateMutation)
    return {
      value: comparables,
      provenance: makeProvenance({
        source: `${this.id}/api/mutations3`,
        sourceType: this.sourceType,
        truth: 'HISTORICAL' as TruthStatus,
        dataTimestamp: Number.isFinite(dataTimestamp) ? dataTimestamp : ctx.asOf,
        asOf: ctx.asOf,
        maxAgeMs: ctx.maxAgeMs,
        confidence: 0.9, // real notarised mutations — high, but not "now"
      }),
    }
  }
}

// ---------------------------------------------------------------------------
// Wire parsing — total, never throws, unknown shape → null (→ UNAVAILABLE).
// ---------------------------------------------------------------------------

/** Pull the mutation array out of whichever envelope Etalab returns. */
function extractMutations(body: unknown): WireMutation[] | null {
  if (Array.isArray(body)) return body as WireMutation[]
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (Array.isArray(obj.mutations)) return obj.mutations as WireMutation[]
    if (Array.isArray(obj.features)) {
      // GeoJSON-style: unwrap .properties of each feature.
      return (obj.features as Array<Record<string, unknown>>).map(
        (f) => (f.properties ?? f) as WireMutation,
      )
    }
    if (Array.isArray(obj.data)) return obj.data as WireMutation[]
  }
  return null
}

/**
 * Fold wire rows into one comparable PER MUTATION, deduped by `id_mutation`.
 *
 * DVF splits a single sale into several rows — one per lot / cadastral line —
 * that all repeat the SAME `valeur_fonciere` (the whole-sale total). Treating
 * each row as its own comparable would count the price once per lot and, worse,
 * divide the full price by a single lot's surface, inflating €/m² by the lot
 * count. So we group by `id_mutation`, keep the price ONCE, and SUM the built
 * surfaces across the mutation's rows — then €/m² is price ÷ whole-sale area.
 *
 * A row whose price is missing/`None`/0 contributes no comparable on its own,
 * but its surface still joins its mutation's fold when a sibling row carries
 * the price (DVF repeats the price on every row, so the first usable row wins).
 */
/** Mutable accumulator during the fold (DvfComparable's fields are readonly on
 *  the emitted value, but must be updated as sibling rows arrive). */
type FoldAcc = {
  -readonly [K in keyof DvfComparable]: DvfComparable[K]
} & {
  /** Distinct residential surface lines seen, keyed to avoid double-summing a
   *  surface DVF repeats across a mutation's rows. */
  surfaceKeys: Set<string>
  surfaceSum: number
}

function foldMutations(rows: WireMutation[]): DvfComparable[] {
  const byId = new Map<string, FoldAcc>()
  const order: string[] = []

  for (const m of rows) {
    // Quality gate: only true sales. Adjudications, échanges, expropriations
    // carry non-market prices that would bias a comparable set.
    const nature = strOrNone(m.nature_mutation)
    if (nature !== null && nature.toLowerCase() !== 'vente') continue

    const valueEur = decimalStr(m.valeur_fonciere)
    const id =
      m.id_mutation != null && !isNoneLike(m.id_mutation)
        ? String(m.id_mutation)
        : synthId(m)
    const rowType = mapType(m.type_local)
    const rowSurface = numOrNull(m.surface_reelle_bati)

    let acc = byId.get(id)
    if (!acc) {
      const numero = strOrNone(m.adresse_numero)
      const voie = strOrNone(m.adresse_nom_voie)
      const address = `${numero ?? ''} ${voie ?? ''}`.trim() || null
      acc = {
        mutationId: id,
        dateMutation: strOrNone(m.date_mutation) ?? '',
        propertyType: rowType,
        valueEur: valueEur ?? '',
        surfaceM2: null,
        pricePerSqmEur: null,
        roomCount: intOrNull(m.nombre_pieces_principales),
        address,
        inseeCode: strOrNone(m.code_commune),
        postalCode: strOrNone(m.code_postal),
        lat: numOrNull(m.latitude),
        lon: numOrNull(m.longitude),
        surfaceKeys: new Set<string>(),
        surfaceSum: 0,
      }
      byId.set(id, acc)
      order.push(id)
    }
    // Price: first non-empty wins (every row repeats the same sale total).
    if ((acc.valueEur === '' || acc.valueEur === '0') && valueEur && valueEur !== '0') {
      acc.valueEur = valueEur
    }
    // A dwelling type on any row wins over 'other' (mixed-lot mutations).
    if (acc.propertyType === 'other' && rowType !== 'other') {
      acc.propertyType = rowType
    }
    // Built surface: sum ONLY residential lots (appartement/maison), and dedupe
    // a surface line DVF repeats across rows by keying on (parcel, surface).
    // Summing raw rows would double-count both the price's divisor and count
    // dépendances/garages into a residential €/m².
    if (rowSurface !== null && rowSurface > 0 && rowType !== 'other') {
      const key = `${strOrNone(m.id_parcelle) ?? ''}:${rowSurface}`
      if (!acc.surfaceKeys.has(key)) {
        acc.surfaceKeys.add(key)
        acc.surfaceSum += rowSurface
      }
    }
    const rooms = intOrNull(m.nombre_pieces_principales)
    if (rooms !== null && (acc.roomCount === null || rooms > acc.roomCount)) {
      acc.roomCount = rooms
    }
  }

  const out: DvfComparable[] = []
  for (const id of order) {
    const acc = byId.get(id)!
    // No usable price → not a comparable. Dropped, never patched with a fake.
    if (acc.valueEur === '' || acc.valueEur === '0') continue
    const surfaceM2 = acc.surfaceSum > 0 ? String(acc.surfaceSum) : null
    const pricePerSqmEur = derivePricePerSqm(acc.valueEur, surfaceM2)
    out.push({
      mutationId: acc.mutationId,
      dateMutation: acc.dateMutation,
      propertyType: acc.propertyType,
      valueEur: acc.valueEur,
      surfaceM2,
      pricePerSqmEur,
      roomCount: acc.roomCount,
      address: acc.address,
      inseeCode: acc.inseeCode,
      postalCode: acc.postalCode,
      lat: acc.lat,
      lon: acc.lon,
    })
  }
  return out
}

function matchesQuery(c: DvfComparable, q: DvfQuery): boolean {
  if (q.propertyType && c.propertyType !== q.propertyType) return false
  if (q.fromDate && c.dateMutation && c.dateMutation < q.fromDate) return false
  if (q.toDate && c.dateMutation && c.dateMutation > q.toDate) return false
  // Radius filter: only when a centre + radius + the comparable's geo are all
  // present. A comparable with no geo is kept (never dropped for missing data).
  if (
    q.radiusMeters != null &&
    q.centerLat != null &&
    q.centerLon != null &&
    c.lat != null &&
    c.lon != null
  ) {
    if (haversineMeters(q.centerLat, q.centerLon, c.lat, c.lon) > q.radiusMeters) {
      return false
    }
  }
  return true
}

function mapType(t: string | undefined): DvfComparable['propertyType'] {
  if (!t || t === 'None') return 'other'
  const low = t.toLowerCase()
  if (low.includes('appartement')) return 'appartement'
  if (low.includes('maison')) return 'maison'
  return 'other'
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** Great-circle distance in metres between two lat/lon points. */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Normalise a numeric field to a decimal string, or null. Handles Etalab's
 * comma decimals and the string sentinel `"None"` (DVF's absent marker).
 * The source value is preserved as a string — no float arithmetic here; the
 * only place a float appears is `derivePricePerSqm` (a derived FALLBACK value,
 * see its note).
 */
function decimalStr(v?: number | string | null): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    return String(v)
  }
  const s = v.trim().replace(',', '.')
  // DVF marks absent values with TWO sentinels, both as strings: 'None' on text
  // fields, 'nan' on numeric ones. A live payload carried 117 'nan' — a filter
  // that only caught 'None' would let 'nan' through and fail the numeric regex
  // anyway, but we reject both explicitly for clarity.
  if (s === '' || s === 'None' || s === 'nan' || !/^-?\d+(\.\d+)?$/.test(s)) return null
  // Strip a trailing '.00'/'.0' so an integer price reads as an integer string.
  return s.replace(/\.0+$/, '')
}

/** True for DVF's two absent-value sentinels. */
function isNoneLike(v: unknown): boolean {
  if (v === null || v === undefined) return true
  const s = String(v).trim()
  return s === '' || s === 'None' || s === 'nan'
}

/**
 * price ÷ surface, rounded to the euro, as a decimal string, or null.
 *
 * This IS float arithmetic (JS `Number` division) — deliberately, and only
 * here: `pricePerSqmEur` is a DERIVED FALLBACK indicator, not a source money
 * value. The lossless-decimal rule in the repo protects source amounts that a
 * decision is taken on (`valueEur`, kept as the DVF string); a €/m² rounded to
 * the euro from values < 2^53 has no material precision risk. Callers that need
 * exactness compute on `valueEur`/`surfaceM2` (both strings), not on this field.
 */
function derivePricePerSqm(
  valueEur: string,
  surfaceM2: string | null,
): string | null {
  if (surfaceM2 === null) return null
  const surf = Number(surfaceM2)
  const val = Number(valueEur)
  if (!Number.isFinite(surf) || surf <= 0) return null
  if (!Number.isFinite(val) || val <= 0) return null
  return String(Math.round(val / surf))
}

function intOrNull(v: number | string | undefined): number | null {
  if (isNoneLike(v)) return null
  const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}

/** Parse a possibly-sentinel string field to a float, or null. */
function numOrNull(v: number | string | undefined): number | null {
  if (isNoneLike(v)) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** A string field that may be a DVF sentinel ('None'/'nan') → null. */
function strOrNone(v?: number | string | null): string | null {
  if (isNoneLike(v)) return null
  return String(v).trim()
}

/** Deterministic synthetic id when DVF omits id_mutation (reproducibility:
 *  same mutation → same id across runs). */
function synthId(m: WireMutation): string {
  return [
    m.date_mutation ?? '',
    m.code_commune ?? '',
    m.adresse_numero ?? '',
    m.adresse_nom_voie ?? '',
    m.valeur_fonciere ?? '',
  ].join('|')
}
