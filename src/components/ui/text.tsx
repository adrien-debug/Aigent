import clsx from 'clsx'
import { Link } from './link'

/**
 * Typographie du produit — densité de poste de contrôle (thème `globals.css`).
 *
 * Les tailles Catalyst d'origine (`text-base/6 sm:text-sm/6`) sont celles d'une
 * application de gestion aérée ; le cockpit lit des mesures et tient dans un
 * viewport sans scroll. Les valeurs sont donc redéfinies ICI, dans le composant
 * canonique, plutôt que combattues à coups de `className` sur chaque appel.
 */
export function Text({ className, ...props }: React.ComponentPropsWithoutRef<'p'>) {
  return <p data-slot="text" {...props} className={clsx(className, 'text-[11px]/5 text-ink-faint')} />
}

export function TextLink({ className, ...props }: React.ComponentPropsWithoutRef<typeof Link>) {
  return (
    <Link
      {...props}
      className={clsx(
        className,
        'text-accent-soft underline decoration-accent-soft/40 data-hover:text-accent-bright data-hover:decoration-accent-bright'
      )}
    />
  )
}

export function Strong({ className, ...props }: React.ComponentPropsWithoutRef<'strong'>) {
  return <strong {...props} className={clsx(className, 'font-medium text-ink')} />
}

export function Code({ className, ...props }: React.ComponentPropsWithoutRef<'code'>) {
  return (
    <code
      {...props}
      className={clsx(
        className,
        'rounded-sm border border-white/10 bg-white/5 px-0.5 font-mono text-[10.5px] text-ink-dim'
      )}
    />
  )
}
