/**
 * Validation de la destination de retour après connexion.
 *
 * POURQUOI CE FICHIER EXISTE. Le proxy met le chemin d'origine dans `?next=`,
 * et la page de connexion y renvoie l'opérateur après succès. Une valeur non
 * validée fait de `/sign-in` une REDIRECTION OUVERTE : `?next=https://evil.tld`
 * transforme un écran d'authentification légitime en tremplin de phishing, et
 * l'URL de départ reste le vrai domaine.
 *
 * La règle est volontairement étroite : on n'accepte QUE ce dont le produit a
 * besoin — un chemin interne absolu. Tout le reste retombe sur `/`.
 *
 * Ce qui est refusé, et le pourquoi de chaque cas :
 *  - une URL absolue (`https://…`, `//evil.tld`, `javascript:…`) : elle sort du
 *    site, ce qui est exactement l'attaque ;
 *  - un chemin relatif (`dashboard`) : il se résout contre l'origine courante
 *    et devient ambigu ;
 *  - `/sign-in` lui-même : y renvoyer après une connexion réussie est une
 *    boucle ;
 *  - un antislash ou un caractère de contrôle : ils sont normalisés
 *    différemment selon les agents, et cette divergence est précisément ce qui
 *    contourne les filtres naïfs.
 *
 * Aucune tentative de « réparer » une valeur douteuse : on ne nettoie pas, on
 * refuse. Un assainissement raté ressemble à une validation réussie.
 */

/** Destination utilisée quand `next` est absent, vide ou refusé. */
export const DEFAULT_RETURN_TO = '/'

/** Longueur au-delà de laquelle une valeur n'est plus un chemin d'écran. */
const MAX_LENGTH = 512

/**
 * Vrai si la chaîne contient un caractère de contrôle. Testé par POINT DE CODE
 * et non par littéral de regex : un caractère de contrôle écrit tel quel dans
 * une source est invisible en relecture et survit mal aux outils qui la
 * manipulent. Ici l'intention reste lisible.
 */
function hasControlCharacter(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export function safeReturnTo(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_RETURN_TO
  if (raw.length > MAX_LENGTH) return DEFAULT_RETURN_TO
  // Doit être un chemin absolu du site. `//` est une URL protocol-relative :
  // le navigateur la traite comme un hôte externe, pas comme un chemin.
  if (!raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_RETURN_TO
  // `/\evil.tld` est normalisé en `//evil.tld` par plusieurs navigateurs.
  if (raw.includes('\\')) return DEFAULT_RETURN_TO
  if (hasControlCharacter(raw)) return DEFAULT_RETURN_TO
  // Pas de boucle sur l'écran de connexion lui-même.
  const pathOnly = raw.split(/[?#]/)[0]
  if (pathOnly === '/sign-in' || pathOnly.startsWith('/sign-in/')) return DEFAULT_RETURN_TO
  return raw
}
