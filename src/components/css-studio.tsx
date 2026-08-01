'use client'

/**
 * CSS Studio — éditeur visuel de styles, STRICTEMENT hors production.
 *
 * DEUX GARDES, PAS UNE
 * --------------------
 * 1. `process.env.NODE_ENV !== 'development'` rend le composant inerte à
 *    l'exécution ;
 * 2. l'import est DYNAMIQUE et n'a lieu que dans cette branche, donc le bundle
 *    de production ne contient pas la bibliothèque du tout.
 *
 * La première seule ne suffirait pas : un `import` en tête de fichier est
 * résolu à la compilation, et l'outil partirait dans le bundle livré même si
 * son `startStudio()` n'était jamais appelé. Un éditeur de styles embarqué chez
 * l'utilisateur final est une surface d'attaque, pas une fonctionnalité.
 *
 * `useEffect` plutôt qu'un appel direct : le studio touche au DOM, il n'a rien
 * à faire pendant le rendu (et il n'existe pas côté serveur).
 */
import { useEffect } from 'react'

export default function CssStudio() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return

    let cancelled = false
    import('cssstudio')
      .then(({ startStudio }) => {
        // Le composant a pu être démonté pendant le chargement du module.
        if (!cancelled) startStudio()
      })
      .catch((error) => {
        // Un outil de dev qui ne démarre pas ne doit jamais casser la page :
        // on le DIT en console et l'application continue.
        console.warn('[css-studio] démarrage impossible', error)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
