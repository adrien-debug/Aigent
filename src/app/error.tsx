'use client'

import { useEffect } from 'react'

import { PageBody, PageHeader } from '@/components/app-shell'
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
    // Pas d'`AppShell` : si la panne vient du shell, l'englober ferait remonter
    // l'erreur à la boundary parente. On reprend seulement la colonne `main` et
    // `PageBody` — le scroll vit là, pas dans un `h-full` local.
    <main className="aig-subtle relative flex h-svh min-h-0 flex-col overflow-hidden">
      <PageHeader
        title="Écran interrompu"
        description="L'affichage a été interrompu pendant le rendu."
      />
      <PageBody>
        <section className="aig-panel-raised mx-auto flex w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-8 text-center">
          <Text className="font-medium text-(--aig-text)">Cet écran n&apos;a pas pu s&apos;afficher.</Text>
          <Text>
            L&apos;affichage a été interrompu pendant le rendu. Aucun chiffre n&apos;est montré :
            l&apos;état réel de la flotte est inconnu de cet écran, pas nul.
          </Text>
          {error.digest ? (
            <Text className="font-mono text-xs">digest {error.digest}</Text>
          ) : null}
          <Button onClick={reset}>Réessayer</Button>
        </section>
      </PageBody>
    </main>
  )
}
