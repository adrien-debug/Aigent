import clsx from 'clsx'

type HeadingProps = { level?: 1 | 2 | 3 | 4 | 5 | 6 } & React.ComponentPropsWithoutRef<
  'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
>

export function Heading({ className, level = 1, ...props }: HeadingProps) {
  let Element: `h${typeof level}` = `h${level}`

  return (
    <Element
      {...props}
      // H1 = 24px FIXE (canon DS). Ne rétrécit PAS en ≥sm : sur desktop, les
      // valeurs de KPI (24px) ne doivent jamais dépasser le titre de page en
      // taille — le rétrécissement `sm:text-xl/8` inversait cette hiérarchie.
      className={clsx(className, 'text-2xl/8 font-semibold text-zinc-950 dark:text-white')}
    />
  )
}

type SubheadingProps = HeadingProps & {
  /**
   * Couleur explicite du titre — PAS dérivée du niveau sémantique (bug de DS
   * corrigé : deux cartes de même rang avaient des couleurs différentes selon
   * qu'on passait `level` ou non, et l'orange "fuyait" sur des titres
   * d'empty-state). `level` reste purement sémantique (h1..h6).
   *
   * Défaut si omis : reproduit l'ancien comportement (level===2 → accent) pour
   * ne rien casser chez les consommateurs existants. Nouveaux consommateurs :
   * passer `tone` explicitement.
   */
  tone?: 'accent' | 'neutral'
}

export function Subheading({ className, level = 2, tone, ...props }: SubheadingProps) {
  let Element: `h${typeof level}` = `h${level}`

  const resolvedTone = tone ?? (level === 2 ? 'accent' : 'neutral')
  const color = resolvedTone === 'accent' ? 'text-accent-600 dark:text-accent-400' : 'text-zinc-950 dark:text-white'

  return (
    <Element {...props} className={clsx(className, 'text-base/7 font-semibold sm:text-sm/6', color)} />
  )
}
