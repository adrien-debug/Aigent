import clsx from 'clsx'

type HeadingProps = { level?: 1 | 2 | 3 | 4 | 5 | 6 } & React.ComponentPropsWithoutRef<
  'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
>

export function Heading({ className, level = 1, ...props }: HeadingProps) {
  let Element: `h${typeof level}` = `h${level}`

  return (
    <Element
      {...props}
      className={clsx(className, 'text-2xl/8 font-semibold text-zinc-950 sm:text-xl/8 dark:text-white')}
    />
  )
}

export function Subheading({ className, level = 2, ...props }: HeadingProps) {
  let Element: `h${typeof level}` = `h${level}`

  // H2 (le niveau par défaut) = titre de section → orange accent (directive
  // Adrien). Les autres niveaux (H3 sous-titres internes) restent neutres pour
  // garder la hiérarchie — un seul levier de couleur à la fois.
  const color = level === 2 ? 'text-accent-600 dark:text-accent-400' : 'text-zinc-950 dark:text-white'

  return (
    <Element {...props} className={clsx(className, 'text-base/7 font-semibold sm:text-sm/6', color)} />
  )
}
