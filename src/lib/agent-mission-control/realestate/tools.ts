/**
 * AIG-REALESTATE-001 — real-estate tool handlers (server only, read-only).
 *
 * Same discipline as `../market/tools.ts`. Each handler:
 *   - validates args with Zod (strict types, bounds, enums) → error result on
 *     bad input, NEVER a throw (mirrors the SAFETY CONTRACT in market/tools.ts);
 *   - resolves the provider (DvfHttpProvider / ApifyListingsProvider — no
 *     fixture path exists yet for this domain, unlike market's fixture mode);
 *   - returns a compact, JSON-serializable `{ ok, data, summary }`;
 *   - NEVER writes anywhere, NEVER fabricates a value (missing → UNAVAILABLE,
 *     per truth.ts and the spec's "trou documenté, jamais comblé" invariant).
 *
 * Handlers are keyed by MANIFEST TOOL NAME in REALESTATE_TOOL_HANDLERS so they
 * plug into the same registry shape as TRADING_TOOL_HANDLERS.
 */

import 'server-only'

import { z } from 'zod'
import { DvfHttpProvider, type DvfQuery, type ProviderContext } from './provider'
import { ApifyListingsProvider, LISTING_PORTALS, type ListingPortal, type ListingsQuery } from './apify-provider'
import { GeoResolver } from './geo-resolver'

export interface RealEstateToolResult {
  ok: boolean
  data: unknown
  summary: string
}

function parse<T>(schema: z.ZodType<T>, argsJson: string): T | { __err: string } {
  let raw: unknown
  try {
    raw = argsJson ? JSON.parse(argsJson) : {}
  } catch {
    return { __err: 'invalid JSON args' }
  }
  const r = schema.safeParse(raw)
  if (!r.success) return { __err: r.error.issues.map((i) => i.message).join('; ') }
  return r.data
}

function err(tool: string, message: string): RealEstateToolResult {
  return { ok: false, data: { error: message }, summary: `${tool} failed: ${message}` }
}

function ctxOf(asOf?: number): ProviderContext {
  return { asOf: asOf ?? Date.now(), maxAgeMs: null }
}

// ---------------------------------------------------------------------------
// read_dvf_comparables
// ---------------------------------------------------------------------------

const dvfArgs = z.object({
  inseeCode: z.string().length(5),
  // Required: the mutations3 endpoint is addressed /<insee>/<section> and 404s
  // without a section (proven by live probe). Format: com_abs(3) + section(2),
  // e.g. '000AH'. A caller with only an address resolves it upstream.
  section: z.string().min(1).max(10),
  propertyType: z.enum(['appartement', 'maison']).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Optional radius narrowing around a point (uses DVF's per-mutation lat/lon).
  centerLat: z.number().gte(-90).lte(90).optional(),
  centerLon: z.number().gte(-180).lte(180).optional(),
  radiusMeters: z.number().positive().max(50000).optional(),
  asOf: z.number().int().optional(),
})

export async function readDvfComparables(argsJson: string): Promise<RealEstateToolResult> {
  const a = parse(dvfArgs, argsJson)
  if ('__err' in a) return err('read_dvf_comparables', a.__err)

  const provider = new DvfHttpProvider()
  const query: DvfQuery = Object.assign(
    { inseeCode: a.inseeCode, section: a.section },
    a.propertyType !== undefined ? { propertyType: a.propertyType } : {},
    a.fromDate !== undefined ? { fromDate: a.fromDate } : {},
    a.toDate !== undefined ? { toDate: a.toDate } : {},
    a.centerLat !== undefined ? { centerLat: a.centerLat } : {},
    a.centerLon !== undefined ? { centerLon: a.centerLon } : {},
    a.radiusMeters !== undefined ? { radiusMeters: a.radiusMeters } : {},
  )
  const res = await provider.getComparables(query, ctxOf(a.asOf))
  if (!res.value) {
    return {
      ok: false,
      data: { comparables: null, truth: 'UNAVAILABLE', reason: res.provenance.unavailableReason },
      summary: `DVF comparables ${a.inseeCode} UNAVAILABLE: ${res.provenance.unavailableReason ?? 'no source'}`,
    }
  }
  return {
    ok: true,
    data: {
      comparables: res.value,
      count: res.value.length,
      truth: res.provenance.truth,
      source: res.provenance.source,
      source_timestamp: res.provenance.dataTimestamp,
      fetched_at: res.provenance.asOf,
      age_ms: res.provenance.ageMs,
      confidence: res.provenance.confidence,
    },
    summary: `DVF comparables ${a.inseeCode}: ${res.value.length} confirmed sale(s), truth=HISTORICAL (signed, not current)`,
  }
}

// ---------------------------------------------------------------------------
// read_market_listings
// ---------------------------------------------------------------------------

const listingsArgs = z.object({
  location: z.string().min(1).max(200),
  portals: z.array(z.enum(LISTING_PORTALS as unknown as [ListingPortal, ...ListingPortal[]])).min(1).max(4).optional(),
  propertyType: z.enum(['appartement', 'maison']).optional(),
  maxItems: z.number().int().min(1).max(500).optional(),
  asOf: z.number().int().optional(),
})

export async function readMarketListings(argsJson: string): Promise<RealEstateToolResult> {
  const a = parse(listingsArgs, argsJson)
  if ('__err' in a) return err('read_market_listings', a.__err)

  const provider = new ApifyListingsProvider()
  const query: ListingsQuery = {
    location: a.location,
    portals: a.portals,
    propertyType: a.propertyType,
    maxItems: a.maxItems,
  }
  const res = await provider.getListings(query, ctxOf(a.asOf))
  if (!res.value) {
    return {
      ok: false,
      data: { listings: null, truth: 'UNAVAILABLE', reason: res.provenance.unavailableReason },
      summary: `market listings '${a.location}' UNAVAILABLE: ${res.provenance.unavailableReason ?? 'no source'}`,
    }
  }
  return {
    ok: true,
    data: {
      listings: res.value,
      count: res.value.length,
      truth: res.provenance.truth,
      source: res.provenance.source,
      fetched_at: res.provenance.asOf,
      confidence: res.provenance.confidence,
    },
    summary: `market listings '${a.location}': ${res.value.length} active listing(s), truth=FALLBACK (asking prices, never signed sales)`,
  }
}

// ---------------------------------------------------------------------------
// resolve_address_to_section
// ---------------------------------------------------------------------------

const resolveArgs = z.object({
  address: z.string().min(1).max(300),
  asOf: z.number().int().optional(),
})

export async function resolveAddressToSection(argsJson: string): Promise<RealEstateToolResult> {
  const a = parse(resolveArgs, argsJson)
  if ('__err' in a) return err('resolve_address_to_section', a.__err)

  const resolver = new GeoResolver()
  const res = await resolver.resolve(a.address, { asOf: a.asOf ?? Date.now() })
  if (!res.value) {
    return {
      ok: false,
      data: { location: null, truth: 'UNAVAILABLE', reason: res.provenance.unavailableReason },
      summary: `resolve '${a.address}' UNAVAILABLE: ${res.provenance.unavailableReason ?? 'no source'}`,
    }
  }
  const v = res.value
  return {
    ok: true,
    data: {
      inseeCode: v.inseeCode,
      section: v.section,
      lat: v.lat,
      lon: v.lon,
      parcelId: v.parcelId,
      label: v.label,
      geocode_score: v.geocodeScore,
      truth: res.provenance.truth,
      source: res.provenance.source,
    },
    summary: `resolved '${a.address}' → INSEE ${v.inseeCode}, section ${v.section} (feed these to read_dvf_comparables)`,
  }
}

// ---------------------------------------------------------------------------
// Registry — keyed by manifest tool name.
// ---------------------------------------------------------------------------

export type RealEstateToolHandler = (argsJson: string) => Promise<RealEstateToolResult>

export const REALESTATE_TOOL_HANDLERS: Readonly<Record<string, RealEstateToolHandler>> = {
  resolve_address_to_section: resolveAddressToSection,
  read_dvf_comparables: readDvfComparables,
  read_market_listings: readMarketListings,
}

export const REALESTATE_TOOL_IDS = Object.keys(REALESTATE_TOOL_HANDLERS)
