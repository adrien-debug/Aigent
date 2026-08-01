/**
 * Déclaration de types pour `cssstudio`, qui n'en embarque aucune.
 *
 * On déclare la SEULE fonction qu'on appelle plutôt que `declare module
 * 'cssstudio'` tout court : la forme courte rend le module entièrement `any`,
 * ce qui ferait passer silencieusement une faute de frappe sur le nom de
 * l'export ou un mauvais nombre d'arguments.
 *
 * À supprimer si le paquet publie un jour ses propres types.
 */
declare module 'cssstudio' {
  /** Démarre l'éditeur visuel. Développement uniquement. */
  export function startStudio(): void
}
