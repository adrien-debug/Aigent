import { cn } from './cn'

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
      className={cn('text-2xl/8 font-semibold text-zinc-950 dark:text-white', className)}
    />
  )
}
