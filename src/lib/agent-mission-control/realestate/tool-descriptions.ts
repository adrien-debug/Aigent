/**
 * AIG-REALESTATE-001 — precise tool descriptions for the model.
 *
 * Same discipline as `../market/tool-descriptions.ts`: the runner exposes tools
 * with an EMPTY JSON-Schema (permissive object args), so the description is the
 * ONLY signal the model has for how to call a tool. Each string therefore
 * carries the exact argument shape + enums + an example, so the model produces
 * a JSON that the Zod-validated handler accepts instead of guessing.
 *
 * These back the `gather_official_sources` node of `valuation-agent.spec.md`
 * §4.1 — read-only, public/official sources only. DVF is the only source with a
 * public no-key API, hence the only tool wired here today; cadastre / DPE /
 * géorisques are the audit's next read-only additions behind the same contract.
 */

export const REALESTATE_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  read_dvf_comparables:
    'Read confirmed real estate sales (DVF — Demandes de Valeurs Foncières, French official transaction records) for a cadastral section. ' +
    'Args JSON: {"inseeCode": <5-char INSEE commune code, e.g. "06004" for Antibes>, "section": <REQUIRED cadastral section prefix, format com_abs(3)+section(2) e.g. "000AH">, "propertyType"?: "appartement"|"maison", "fromDate"?: <ISO "YYYY-MM-DD">, "toDate"?: <ISO "YYYY-MM-DD">, "centerLat"?: number, "centerLon"?: number, "radiusMeters"?: number}. ' +
    'Example: {"inseeCode":"06004","section":"000AH","propertyType":"appartement","fromDate":"2023-01-01"}. ' +
    'The section is REQUIRED (the endpoint is addressed by commune+section; omitting it returns UNAVAILABLE). Resolve an address to a section upstream. ' +
    'Read-only, official public source. Prices are decimal strings, never floats; multi-lot sales are deduplicated so a price is never counted twice. ' +
    'Every result is truth=HISTORICAL (DVF lags the signature by ~6 months — never present it as the current market price). ' +
    'Returns truth=UNAVAILABLE (never a fabricated comparable) when: the commune is in DVF\'s coverage gap (Alsace-Moselle départements 67/68/57, Mayotte 976), the source is unreachable, or no mutation matches. Abstain on UNAVAILABLE — do NOT invent a comparable or a price.',
  read_market_listings:
    'Read ACTIVE portal listings (Leboncoin, SeLoger, Bien\'ici, PAP) scraped via Apify for a location. ' +
    'Args JSON: {"location": <free text, e.g. "Antibes 06600">, "portals"?: array of ("leboncoin"|"seloger"|"bienici"|"pap"), "propertyType"?: "appartement"|"maison", "maxItems"?: 1..500}. ' +
    'Example: {"location":"Antibes 06600","portals":["bienici","pap"],"propertyType":"appartement"}. ' +
    'These are ASKING prices (prix demandés), truth=FALLBACK — NEVER signed sales. Do NOT mix them with read_dvf_comparables (signed, HISTORICAL): report the asking-vs-signed gap, never confuse the two. Prices are decimal strings. ' +
    'Returns truth=UNAVAILABLE (never a fabricated listing) when APIFY_API_TOKEN is unset, the actor fails, or no listing is scraped. Abstain on UNAVAILABLE.',
}
