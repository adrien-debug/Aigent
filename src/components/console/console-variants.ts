/**
 * Local console design tokens — surface chrome and typography roles.
 *
 * Not a cross-product design system: these helpers keep the Aigent console
 * consistent and are modifiable by an explicit product/design mission.
 */

export type ConsoleSurfaceVariant = 'primary' | 'secondary' | 'sunken' | 'danger'

/** Border, background and elevation for a console panel or card. */
export function consoleSurfaceClasses(variant: ConsoleSurfaceVariant = 'secondary'): string {
  switch (variant) {
    case 'primary':
      return 'border-line-strong bg-surface-overlay shadow-[var(--shadow-card-lg)]'
    case 'secondary':
      return 'border-line bg-surface-raised shadow-[var(--shadow-card-sm)]'
    case 'sunken':
      return 'border-line bg-surface-sunken shadow-[var(--shadow-well)]'
    case 'danger':
      return 'border-[var(--state-danger-solid-line)] bg-[var(--state-danger-surface)] shadow-[var(--shadow-card-sm)]'
  }
}

/** Full panel/card chrome: rounded frame + surface variant. */
export function consolePanelChrome(variant: 'primary' | 'secondary' = 'secondary'): string {
  return `flex min-w-0 flex-col overflow-hidden rounded-xl border ${consoleSurfaceClasses(variant)}`
}

/** KPI/card chrome without the flex column (Metric supplies inner layout). */
export function consoleCardChrome(variant: 'primary' | 'secondary' = 'secondary'): string {
  return `min-w-0 rounded-xl border ${consoleSurfaceClasses(variant)}`
}

/**
 * Typography roles for shared console primitives.
 * Screens may still use one-off sizes; primitives import from here.
 */
export const consoleTypography = {
  eyebrow: 'text-[10px]/4 font-semibold uppercase tracking-[0.14em] text-content-subtle',
  caption: 'text-[11px]/4 text-content-subtle',
  captionMuted: 'text-[11px]/4 text-content-muted',
  bodySm: 'text-[13px]/5',
  bodySmMedium: 'text-[13px]/5 font-medium text-white',
  panelTitle: 'text-[13px]/5 font-semibold tracking-wide text-white',
  panelDescription: 'text-[11px]/4 text-content-muted',
  screenTitle: 'text-xl/7 font-semibold tracking-tight text-white',
  screenDescription: 'text-[13px]/5 text-content-muted',
  metric: 'text-[30px]/9 font-light tabular-nums tracking-tight text-white',
  tableCaption: 'text-[10px]/4 uppercase tracking-widest text-content-faint',
} as const
