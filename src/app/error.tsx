'use client'

import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

/**
 * Filet de sécurité du RENDU, pas de la lecture.
 *
 * `page.tsx` capture déjà l'échec de `getDashboardOverview` et rend un état
 * `Unavailable` explicite. Ce fichier attrape ce que ce try/catch ne peut pas
 * voir : une exception levée pendant le rendu lui-même — typiquement un
 * composant client qui reçoit une valeur qu'il n'attendait pas.
 *
 * Ce n'est pas théorique. Le 2026-07-26, `TrendChart` a produit un `cy="NaN"`
 * sur des coûts réels ; typecheck, build, la suite de tests et la CI étaient
 * tous verts, et l'écran cassait au rendu client. Sans error boundary, ce cas
 * donne un écran blanc muet.
 *
 * Pas d'`AppShell` ici : si la panne vient du shell, l'englober ferait remonter
 * l'erreur à la boundary parente et l'écran redeviendrait blanc.
 *
 * Ce fichier est HÉRITÉ par les neuf surfaces créées en PR 1 : le libellé ne
 * nomme donc plus « le cockpit » en particulier, il nomme l'écran qui a
 * échoué, quel qu'il soit.
 */
export default function AppRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Visible dans la console navigateur ET dans les logs serveur : c'est la
    // seule trace de ce type de panne tant qu'aucun test de rendu n'existe.
    console.error('[aigent] rendu interrompu', error)
  }, [error])

  return (
    // `aig-subtle` porte le fond parce que cet écran s'affiche SANS shell : il
    // n'hérite d'aucune surface parente et doit poser la sienne. Le panneau est
    // `raised` — un rendu interrompu est précisément ce qui doit ressortir.
    <div className="aig-subtle flex h-full items-center justify-center p-4">
      <div className="aig-panel-raised max-w-md px-6 py-8 text-center">
        <Text className="font-medium text-(--aig-text)">Cet écran n&apos;a pas pu s&apos;afficher.</Text>
        <Text className="mt-2">
          L&apos;affichage a été interrompu pendant le rendu. Aucun chiffre n&apos;est montré :
          l&apos;état réel de la flotte est inconnu de cet écran, pas nul.
        </Text>
        {error.digest ? (
          <Text className="mt-2 font-mono text-xs">digest {error.digest}</Text>
        ) : null}
        <Button className="mt-6" onClick={reset}>
          Réessayer
        </Button>
      </div>
    </div>
  )
}
