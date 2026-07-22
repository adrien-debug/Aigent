/**
 * Agent Mission Control — shared repo-coverage keyword sets (PURE, no I/O).
 *
 * Single source of truth for the case-text keyword lists used to decide whether
 * a repo signal (design-system / secrets / risk / api-routes) is "covered" by a
 * generated suite. Previously duplicated byte-for-byte in `repo-fit.ts`
 * (scoring) and `repo-risk-coverage.ts` (required-coverage/fallback); unified
 * here so the two surfaces can never drift apart.
 */

export const DS_KEYWORDS = [
  'design system',
  'design-system',
  'catalyst',
  'check:ds',
  'check:catalyst',
  'tokens',
  'palette',
  'accent color',
  'ds gate',
]
export const SECRET_KEYWORDS = [
  'secret',
  'process.env',
  'api key',
  'api_key',
  'service role',
  'service_role',
  'credential',
  'token',
  'redact',
  'leak',
  '.env tracked',
  'tracked .env',
  'tracked in the repo',
  'secret exposure',
]
export const RISK_KEYWORDS = [
  'review before delete',
  'do not auto-delete',
  'not auto-delete',
  "don't delete",
  'flag',
  'residue',
  'dead code',
  'evidence',
  'recommend review',
  'risk',
]
export const API_ROUTE_KEYWORDS = [
  'invent',
  'hallucinat',
  'real route',
  'absent route',
  'does not exist',
  'only cite',
  'never invent',
  'no route',
  'route scope',
]

/** A repo with at least this many API routes counts as "many routes". */
export const MANY_API_ROUTES_THRESHOLD = 5
