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
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Visible dans la console navigateur ET dans les logs serveur : c'est la
    // seule trace de ce type de panne tant qu'aucun test de rendu n'existe.
    console.error('[cockpit] rendu interrompu', error)
  }, [error])

  return (
    <div className="flex h-full items-center justify-center bg-zinc-950 p-4">
      <div className="max-w-md rounded-lg bg-white px-6 py-8 text-center shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
        <Text className="font-medium text-zinc-950 dark:text-white">
          Le cockpit n&apos;a pas pu s&apos;afficher.
        </Text>
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
