import type { Metadata } from 'next'

import SignInForm from './sign-in-form'
import { safeReturnTo } from './return-to'

/**
 * `/sign-in` — la seule page atteignable sans session.
 *
 * LE NOM. `/login` est INTERDIT dans ce repository : `check:no-legacy-front`
 * bannit `src/app/login`, qui fut démoli au reset front. `/sign-in` est un
 * chemin neuf, il ne réanime rien.
 *
 * Le paramètre `next` est posé par `src/proxy.ts` avec le chemin d'origine.
 * Il est validé ICI, côté serveur, avant d'être remis au formulaire :
 * `safeReturnTo` n'accepte qu'un chemin interne absolu. Sans cette validation,
 * l'écran de connexion serait une redirection ouverte.
 *
 * `force-dynamic` : la page dépend de la requête (`searchParams`) et ne doit
 * jamais être servie depuis un cache statique portant le `next` d'un autre.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Connexion · Aigent',
  robots: { index: false, follow: false },
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const raw = params.next
  // Un paramètre répété (`?next=a&next=b`) arrive en tableau : on ne devine
  // pas lequel comptait, on retombe sur le défaut.
  const returnTo = safeReturnTo(typeof raw === 'string' ? raw : null)

  return (
    <main className="aig-subtle flex h-svh items-center justify-center overflow-y-auto px-4 py-10">
      <section className="aig-panel w-full max-w-sm rounded-xl p-6 sm:p-8">
        <SignInForm returnTo={returnTo} />
      </section>
    </main>
  )
}
