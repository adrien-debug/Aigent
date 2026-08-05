/** Map sévérité produit → couleur Badge Catalyst. Une seule autorité visuelle = Badge. */
export type SeverityTone = 'good' | 'running' | 'warn' | 'blocked' | 'bad' | 'neutral'

export const SEVERITY_BADGE_COLOR = {
  good: 'lime',
  running: 'sky',
  warn: 'amber',
  blocked: 'orange',
  bad: 'red',
  neutral: 'zinc',
} as const satisfies Record<SeverityTone, 'lime' | 'sky' | 'amber' | 'orange' | 'red' | 'zinc'>
