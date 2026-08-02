import clsx from 'clsx'
import { Link } from './link'

/**
 * COULEURS — jetons `--aig-*`, pas de palette Tailwind brute.
 *
 * Le kit portait sa propre couche esthétique (`zinc-*`, `white`, variantes
 * `dark:`) pendant que le produit parlait `--aig-*` : deux autorités visuelles
 * pour une seule interface. Les jetons étant DÉJÀ sombres, chaque paire
 * clair/sombre se réduit à une seule valeur — c'est pourquoi les `dark:`
 * disparaissent au lieu d'être traduites.
 *
 * La STRUCTURE de Catalyst (variantes, `data-*`, tailles, cible tactile,
 * `forced-colors`) n'est pas touchée : c'est elle que `check:ui-kit-integrity`
 * protège désormais, et l'accessibilité en dépend.
 */
export function Text({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'p'>>) {
  return (
    <p
      data-slot="text"
      {...props}
      className={clsx(className, 'text-base/6 text-(--aig-text-muted) sm:text-sm/6')}
    />
  )
}

export function TextLink({
  className,
  ...props
}: Readonly<React.ComponentPropsWithoutRef<typeof Link>>) {
  return (
    <Link
      {...props}
      className={clsx(
        className,
        'text-(--aig-text) underline decoration-(--aig-line) data-hover:decoration-(--aig-text)',
      )}
    />
  )
}

export function Strong({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'strong'>>) {
  return <strong {...props} className={clsx(className, 'font-medium text-(--aig-text)')} />
}

export function Code({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'code'>>) {
  return (
    <code
      {...props}
      className={clsx(
        className,
        'rounded-sm border border-(--aig-line) bg-(--aig-raised) px-0.5 text-sm font-medium text-(--aig-text) sm:text-[0.8125rem]',
      )}
    />
  )
}
