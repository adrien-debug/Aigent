/**
 * Formal legacy bridge — `surface-card.tsx` is now a pure re-export shim, not
 * an implementation. The actual deprecated definitions live in
 * `@/components/agent-ops/_legacy/surface-legacy` (aliases) and the canonical
 * layer implementations live in `@/components/shell/page-header` and
 * `@/components/ui/section`.
 *
 * Kept as a re-export (rather than deleted) so the existing importers of
 * `agent-ops/surface-card` keep working unchanged during the migration —
 * see `scripts/legacy-bridge-allowlist.json` for the tracked, decreasing list
 * of files still importing from here. Prefer importing directly from
 * `@/components/shell/page-header` / `@/components/ui/section` /
 * `@/components/ui/panel` in new code.
 */

/** @deprecated moved to `@/components/shell/page-header` — import `PageHeader` directly in new code. */
export { PageHeader as AdminPageHeader, eyebrowClass } from '@/components/shell/page-header'

/** @deprecated moved to `@/components/ui/section` — import directly in new code. */
export {
  Section as AgentSectionCard,
  Section,
  SectionHeader as SurfaceCardHeader,
  SectionHeader,
  surfaceSectionClass,
  surfaceSectionHeaderClass,
} from '@/components/ui/section'

/** @deprecated moved to `@/components/agent-ops/_legacy/surface-legacy` — the formal legacy bridge. */
export {
  surfaceCardClass,
  surfaceCardHeaderClass,
  surfaceItemClass,
  surfaceCardFooterClass,
  surfaceInsetClass,
  SurfaceCard,
} from '@/components/agent-ops/_legacy/surface-legacy'
