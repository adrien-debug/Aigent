import clsx from 'clsx'

type HeadingProps = { level?: 1 | 2 | 3 | 4 | 5 | 6 } & React.ComponentPropsWithoutRef<
  'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
>

/**
 * Titres du produit — densité de poste de contrôle (thème `globals.css`).
 *
 * `Subheading` est le titre d'un panneau du cockpit : capitales serrées et
 * petites, la grammaire d'une barre d'instrument. Redéfini ici, dans le
 * composant canonique, plutôt que réécrit à chaque appel.
 */
export function Heading({ className, level = 1, ...props }: HeadingProps) {
  let Element: `h${typeof level}` = `h${level}`

  return <Element {...props} className={clsx(className, 'text-[15px]/6 font-semibold text-ink')} />
}

export function Subheading({ className, level = 2, ...props }: HeadingProps) {
  let Element: `h${typeof level}` = `h${level}`

  return (
    <Element
      {...props}
      className={clsx(
        className,
        'text-[10px] font-semibold tracking-[0.2em] whitespace-nowrap text-ink-dim uppercase'
      )}
    />
  )
}
