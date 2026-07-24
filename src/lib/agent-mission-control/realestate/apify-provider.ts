/**
 * AIG-REALESTATE-001 — portal listings provider via Apify (read-only).
 *
 * Scrapes ACTIVE listings (Leboncoin, SeLoger, Bien'ici, PAP) through an Apify
 * actor, run synchronously (`run-sync-get-dataset-items`). Same contract as
 * `DvfHttpProvider`: read-only, timeout-bounded, SSRF-gated by the shared
 * guard, NEVER throws on a bad source (returns an UNAVAILABLE-shaped result).
 *
 * TRUTH DISCIPLINE — read this before consuming a listing:
 *   - A scraped listing is an ASKING price (prix demandé), NEVER a signed sale.
 *     It is tagged `FALLBACK` with sourceType `apify-scrape`, so it can NEVER be
 *     mistaken for a DVF signed mutation (`HISTORICAL`). Callers must keep the
 *     two apart — the valuation spec forbids confusing prix demandé and prix
 *     signé.
 *   - No listing is ever fabricated: no actor result / unrecognised shape /
 *     source down → UNAVAILABLE with a reason, never an invented listing.
 *
 * LEGAL — the operator was told, explicitly, that scraping Leboncoin/SeLoger/
 * Bien'ici for a commercial product carries real, current French legal exposure
 * (droit sui generis + parasitisme + CGU; Jinka c/ Leboncoin 200k€, 2026) and
 * that Apify executes the scrape but the risk is the operator's. This module
 * encodes that decision; it does not endorse it. No credential is hardcoded —
 * `APIFY_API_TOKEN` is read from the environment only.
 */

import 'server-only'

import { guardedFetch, validateHttpUrl } from '../../../langgraph/http-guard.mjs'
import type { Provenance, RealEstateSourceType, TruthStatus } from './truth'
import { makeProvenance, unavailableProvenance } from './truth'

/** Portals the actor can target. Kept as a closed set so the tool description
 *  can enumerate them and the handler can validate against them. */
export type ListingPortal = 'leboncoin' | 'seloger' | 'bienici' | 'pap'

export const LISTING_PORTALS: readonly ListingPortal[] = [
  'leboncoin',
  'seloger',
  'bienici',
  'pap',
]

export type ListingPropertyType = 'appartement' | 'maison'

/**
 * One active listing. Prices/areas are lossless decimal STRINGS, never float —
 * same rule as DVF. `pricePerSqmEur` is derived (division), null when the
 * surface is absent. Every field is nullable: a scrape is best-effort.
 */
export interface PortalListing {
  /** Stable id from the actor (listing url or portal id). */
  readonly listingId: string
  readonly portal: ListingPortal | 'unknown'
  /** ASKING price in EUR, decimal string. Never a signed sale. */
  readonly askingPriceEur: string
  readonly surfaceM2: string | null
  readonly pricePerSqmEur: string | null
  readonly propertyType: ListingPropertyType | 'other'
  readonly roomCount: number | null
  readonly city: string | null
  readonly postalCode: string | null
  readonly url: string | null
  /** ISO datetime the listing was first seen / published, if the actor gives it. */
  readonly publishedAt: string | null
}

export interface ProviderResult<T> {
  value: T | null
  provenance: Provenance
}

export interface ProviderContext {
  asOf: number
  maxAgeMs: number | null
}

/** Query for active listings around a location. */
export interface ListingsQuery {
  /** Free-text location the actor understands (city / postal code / "Antibes 06600"). */
  location: string
  portals?: ListingPortal[]
  propertyType?: ListingPropertyType
  /** Cap on items returned (also bounds actor cost). */
  maxItems?: number
}

export interface RealEstateListingsProvider {
  readonly id: string
  readonly sourceType: RealEstateSourceType
  getListings(
    query: ListingsQuery,
    ctx: ProviderContext,
  ): Promise<ProviderResult<PortalListing[]>>
}

// ---------------------------------------------------------------------------
// Apify HTTP provider — run-sync-get-dataset-items.
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 120_000 // a sync scrape run is slow; give it room.
const APIFY_BASE_URL = 'https://api.apify.com'
/** Default public FR real-estate actor. Override via APIFY_REALESTATE_ACTOR
 *  (an actor id like 'user~actor' or a task id). No hardcoded assumption that
 *  this specific actor exists — an unknown actor fails closed as UNAVAILABLE. */
const DEFAULT_ACTOR = 'memo23~apify-french-real-estate-scraper'
const DEFAULT_MAX_ITEMS = 100

type FetchOutcome = { ok: true; body: unknown } | { ok: false; reason: string }

/** Loosely-typed row from the actor dataset — every field optional. */
interface WireListing {
  id?: string | number
  url?: string
  portal?: string
  source?: string
  price?: number | string
  priceEur?: number | string
  surface?: number | string
  area?: number | string
  surfaceM2?: number | string
  propertyType?: string
  type?: string
  rooms?: number | string
  roomCount?: number | string
  city?: string
  town?: string
  postalCode?: string | number
  zipCode?: string | number
  publishedAt?: string
  date?: string
}

export class ApifyListingsProvider implements RealEstateListingsProvider {
  readonly id: string
  readonly sourceType: RealEstateSourceType = 'apify-scrape'
  private readonly baseUrl: string
  private readonly actor: string
  private readonly timeoutMs: number
  private readonly token: string | null
  private readonly allowedHost: string | null
  private readonly configError: string | null

  constructor(opts?: {
    token?: string
    actor?: string
    baseUrl?: string
    timeoutMs?: number
  }) {
    this.baseUrl = (opts?.baseUrl ?? APIFY_BASE_URL).replace(/\/+$/, '')
    this.actor = opts?.actor ?? process.env.APIFY_REALESTATE_ACTOR ?? DEFAULT_ACTOR
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    // Secret read from env only — never hardcoded, never logged (garde-fou #1).
    this.token = opts?.token ?? process.env.APIFY_API_TOKEN ?? null
    this.id = `apify:${this.actor}`
    const validated = validateHttpUrl(this.baseUrl)
    this.allowedHost = validated.ok ? validated.host : null
    this.configError = validated.ok ? null : `invalid Apify base URL: ${validated.reason}`
  }

  private async runActor(input: unknown): Promise<FetchOutcome> {
    if (!this.allowedHost) {
      return { ok: false, reason: this.configError ?? 'invalid Apify base URL' }
    }
    if (!this.token) {
      // FAIL CLOSED: no token → no network call, truthful reason.
      return { ok: false, reason: 'APIFY_API_TOKEN is not set — Apify scraping disabled' }
    }
    // run-sync-get-dataset-items: start the actor, block until it finishes,
    // return the dataset items in one call. Token in the query string is how
    // Apify authenticates this endpoint; it is never logged by this module.
    const actorPath = this.actor.replace('/', '~')
    const url =
      `${this.baseUrl}/v2/acts/${encodeURIComponent(actorPath)}` +
      `/run-sync-get-dataset-items?token=${encodeURIComponent(this.token)}`
    const out = await guardedFetch(url, {
      allowedHosts: [this.allowedHost],
      timeoutMs: this.timeoutMs,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      readBody: async (res) => (res.ok ? ((await res.json()) as unknown) : null),
      // guardedFetch defaults to GET; Apify needs POST with the input body.
      // method/body are opt-in on the shared guard (added for this path), the
      // body rides through every redirect hop under the same host pin.
      method: 'POST',
      body: JSON.stringify(input),
    })
    if (!out.ok) return { ok: false, reason: out.reason }
    if (!out.httpOk) {
      return { ok: false, reason: `HTTP ${out.status} from Apify actor ${this.actor}` }
    }
    return { ok: true, body: out.body }
  }

  async getListings(
    query: ListingsQuery,
    ctx: ProviderContext,
  ): Promise<ProviderResult<PortalListing[]>> {
    const portals = query.portals?.length ? query.portals : LISTING_PORTALS
    const input = {
      location: query.location,
      portals,
      propertyType: query.propertyType,
      maxItems: query.maxItems ?? DEFAULT_MAX_ITEMS,
    }

    const fetched = await this.runActor(input)
    if (!fetched.ok) {
      return {
        value: null,
        provenance: unavailableProvenance({
          source: `${this.id}/run-sync`,
          sourceType: this.sourceType,
          asOf: ctx.asOf,
          reason: fetched.reason,
        }),
      }
    }

    const rows = extractRows(fetched.body)
    if (rows === null) {
      return {
        value: null,
        provenance: unavailableProvenance({
          source: `${this.id}/run-sync`,
          sourceType: this.sourceType,
          asOf: ctx.asOf,
          reason: `unrecognised Apify dataset shape for '${query.location}'`,
        }),
      }
    }

    const listings = rows
      .map(mapListing)
      .filter((l): l is PortalListing => l !== null)
      .filter((l) => !query.propertyType || l.propertyType === query.propertyType)

    if (listings.length === 0) {
      return {
        value: null,
        provenance: unavailableProvenance({
          source: `${this.id}/run-sync`,
          sourceType: this.sourceType,
          asOf: ctx.asOf,
          reason: `no active listing scraped for '${query.location}'${
            query.propertyType ? ` (${query.propertyType})` : ''
          }`,
        }),
      }
    }

    return {
      value: listings,
      provenance: makeProvenance({
        source: `${this.id}/run-sync`,
        sourceType: this.sourceType,
        // FALLBACK, never HISTORICAL/LIVE: an asking price is derived market
        // signal, not a confirmed observation. This is what keeps a scraped
        // listing from ever being read as a signed DVF sale.
        truth: 'FALLBACK' as TruthStatus,
        dataTimestamp: ctx.asOf, // scraped "now", but the value itself is soft
        asOf: ctx.asOf,
        maxAgeMs: ctx.maxAgeMs,
        confidence: 0.5, // asking prices: indicative only
      }),
    }
  }
}

// ---------------------------------------------------------------------------
// Wire parsing — total, never throws, unknown shape → null (→ UNAVAILABLE).
// ---------------------------------------------------------------------------

function extractRows(body: unknown): WireListing[] | null {
  if (Array.isArray(body)) return body as WireListing[]
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (Array.isArray(obj.items)) return obj.items as WireListing[]
    if (Array.isArray(obj.data)) return obj.data as WireListing[]
    if (Array.isArray(obj.results)) return obj.results as WireListing[]
  }
  return null
}

function mapListing(r: WireListing): PortalListing | null {
  const askingPriceEur = decimalStr(r.price ?? r.priceEur)
  if (askingPriceEur === null || askingPriceEur === '0') return null

  const surfaceM2 = decimalStr(r.surface ?? r.area ?? r.surfaceM2)
  const pricePerSqmEur = derivePricePerSqm(askingPriceEur, surfaceM2)

  const url = typeof r.url === 'string' ? r.url : null
  const listingId =
    r.id != null ? String(r.id) : (url ?? synthId(r))

  return {
    listingId,
    portal: mapPortal(r.portal ?? r.source),
    askingPriceEur,
    surfaceM2,
    pricePerSqmEur,
    propertyType: mapType(r.propertyType ?? r.type),
    roomCount: intOrNull(r.rooms ?? r.roomCount),
    city: strOrNull(r.city ?? r.town),
    postalCode: r.postalCode != null || r.zipCode != null
      ? String(r.postalCode ?? r.zipCode)
      : null,
    url,
    publishedAt: strOrNull(r.publishedAt ?? r.date),
  }
}

function mapPortal(p: string | undefined): PortalListing['portal'] {
  if (!p) return 'unknown'
  const low = p.toLowerCase()
  if (low.includes('leboncoin') || low.includes('lbc')) return 'leboncoin'
  if (low.includes('seloger')) return 'seloger'
  if (low.includes('bienici') || low.includes("bien'ici") || low.includes('bien-ici'))
    return 'bienici'
  if (low.includes('pap')) return 'pap'
  return 'unknown'
}

function mapType(t: string | undefined): PortalListing['propertyType'] {
  if (!t) return 'other'
  const low = t.toLowerCase()
  if (low.includes('appartement') || low.includes('apartment')) return 'appartement'
  if (low.includes('maison') || low.includes('house') || low.includes('villa'))
    return 'maison'
  return 'other'
}

function decimalStr(v: number | string | undefined | null): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    return String(v)
  }
  // Strip currency symbols, spaces, thin spaces, non-breaking spaces.
  const cleaned = v.replace(/[€\s  ]/g, '').replace(',', '.')
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  return cleaned.replace(/\.0+$/, '')
}

function derivePricePerSqm(priceEur: string, surfaceM2: string | null): string | null {
  if (surfaceM2 === null) return null
  const surf = Number(surfaceM2)
  const val = Number(priceEur)
  if (!Number.isFinite(surf) || surf <= 0) return null
  if (!Number.isFinite(val) || val <= 0) return null
  return String(Math.round(val / surf))
}

function intOrNull(v: number | string | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** Deterministic synthetic id when the actor omits id + url. */
function synthId(r: WireListing): string {
  return [r.portal ?? '', r.city ?? '', r.price ?? '', r.surface ?? ''].join('|')
}
