import clsx from 'clsx'

/**
 * Jauge linéaire — la SEULE forme de mesure graphique de l'Aperçu.
 *
 * `ArcGauge` (anneau 44 px) et `SegmentMeter` (chapelet de segments) ont été
 * retirés avec le passage du bandeau KPI en composition plate : trois
 * grammaires graphiques pour trois mesures voisines faisaient lire six objets
 * distincts là où le bandeau doit se lire d'un seul tenant. Une seule barre,
 * même épaisseur, même position dans chaque colonne.
 *
 * La couleur arrive en PROP et non en classe : elle transite par un `style`
 * inline, là où un `var()` de feuille de style ne résoudrait pas partout
 * (même raison que `src/lib/cockpit/status.ts`). Les appelants passent
 * `var(--aig-accent)` — la valeur reste dans l'autorité de thème.
 */
export function BarMeter({
  ratio,
  color,
  className,
}: Readonly<{ ratio: number; color: string; className?: string }>) {
  const pct = Math.min(Math.max(ratio, 0), 1) * 100

  return (
    <div
      aria-hidden
      className={clsx(
        'h-1 w-full overflow-hidden rounded-full bg-[var(--aig-line-soft)]',
        className,
      )}
    >
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}
