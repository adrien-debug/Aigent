/**
 * Primitives typographiques du plan de contrôle — écrites À CÔTÉ du kit.
 *
 * POURQUOI CE FICHIER EXISTE PLUTÔT QU'UN OVERRIDE DU KIT
 * ------------------------------------------------------
 * `src/components/ui/` (Catalyst vendoré) porte `zinc` EN DUR : 81 occurrences,
 * dont `Text` qui rend `text-zinc-500` et `Heading` `text-zinc-950`. Le kit est
 * figé par empreinte SHA (`check:ui-kit-integrity`) — on ne le repeint pas.
 *
 * Deux voies existaient donc pour sortir du gris par défaut :
 *  · écraser la couleur à CHAQUE appel de `Text`/`Heading` — une rustine par
 *    site d'appel, et le zinc revient sur le premier oubli ;
 *  · écrire les quelques primitives dont les écrans ont besoin, avec la vraie
 *    palette, et laisser le kit intact pour tout le reste.
 *
 * C'est la seconde. Le kit reste sur disque, sa gate reste verte, et les écrans
 * migrent un par un — rien n'oblige une surface à basculer.
 *
 * CE QUE CE FICHIER N'EST PAS
 * ---------------------------
 * Ce n'est pas une doctrine et ce n'est pas une gate. `AGENTS.md` § Frontend
 * tient le « free design » : rien ici n'est imposé à un écran, et aucune
 * vérification n'interdit d'utiliser le kit à la place. C'est un outil
 * disponible, pas une règle.
 *
 * Server Components : aucun de ces composants n'a d'état ni d'effet.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'

/**
 * Le titre d'une surface. Un seul par écran — c'est le nom de la page.
 *
 * `text-balance` : un titre de deux mots qui se coupe en « Aperçu de la /
 * flotte » se lit mal ; l'équilibrage évite la ligne orpheline sans imposer
 * de largeur fixe.
 */
export function PageTitle({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <h1
      className={clsx(
        'text-2xl font-semibold tracking-tight text-balance text-fg sm:text-[1.6rem]',
        className,
      )}
    >
      {children}
    </h1>
  )
}

/**
 * Le sur-titre d'une page — ce qui situe avant de nommer.
 *
 * En capitales espacées et en accent : c'est le seul endroit où la couleur
 * d'identité apparaît en typographie, et il ne porte jamais de mesure.
 */
export function Kicker({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <p
      className={clsx(
        'font-mono text-3xs tracking-[0.2em] text-accent-hi uppercase',
        className,
      )}
    >
      {children}
    </p>
  )
}

/**
 * Le titre d'un bloc — plus petit qu'un titre de page, plus fort qu'un libellé.
 */
export function BlockTitle({
  children,
  className,
  level = 2,
}: Readonly<{ children: ReactNode; className?: string; level?: 2 | 3 }>) {
  const Element = level === 2 ? 'h2' : 'h3'
  return (
    <Element
      className={clsx('font-mono text-2xs tracking-[0.16em] text-fg uppercase', className)}
    >
      {children}
    </Element>
  )
}

/**
 * Le séparateur de bande — un libellé suivi d'un filet qui occupe le reste.
 *
 * Il structure la page en RANGS DE PRIORITÉ (ce qui appelle une décision, puis
 * le contexte) sans ajouter une carte ni une bordure de plus. Le filet est
 * décoratif : il est donc `aria-hidden`, seul le mot compte pour la lecture.
 */
export function BandLabel({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <div className={clsx('flex items-center gap-2.5', className)}>
      <h2 className="font-mono text-3xs tracking-[0.18em] text-fg-low uppercase">{children}</h2>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  )
}

/** Texte courant — le niveau de lecture normal. */
export function Body({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return <p className={clsx('text-sm/6 text-fg-mid', className)}>{children}</p>
}

/** Texte secondaire — une précision qu'on lit après, pas avant. */
export function Muted({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return <p className={clsx('text-xs/5 text-fg-low', className)}>{children}</p>
}

/**
 * Un libellé d'instrument — le nom d'une mesure, jamais la mesure elle-même.
 */
export function MeasureLabel({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <span
      className={clsx(
        'block truncate font-mono text-3xs tracking-[0.15em] text-fg-mid uppercase',
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * Un chiffre mesuré.
 *
 * `tabular-nums` : sans lui, un compteur qui passe de 9 à 10 décale toute la
 * ligne, et une colonne de chiffres cesse d'être alignée — sur un écran
 * d'instruments c'est un défaut de lecture, pas un détail.
 *
 * `tone` porte une couleur SÉMANTIQUE (celle de `SEVERITY`), jamais l'accent :
 * un chiffre en violet serait un chiffre dont on ne sait pas s'il va bien.
 */
export function MeasureValue({
  children,
  size = 'md',
  tone,
  className,
}: Readonly<{
  children: ReactNode
  size?: 'md' | 'lg'
  /** Couleur de sévérité, en valeur CSS. Absente = le chiffre reste neutre. */
  tone?: string
  className?: string
}>) {
  return (
    <span
      className={clsx(
        'block truncate font-mono font-semibold tabular-nums',
        size === 'lg' ? 'text-4xl/none tracking-[-0.035em]' : 'text-xl/tight tracking-[-0.02em]',
        !tone && 'text-fg',
        className,
      )}
      style={tone ? { color: tone } : undefined}
    >
      {children}
    </span>
  )
}
