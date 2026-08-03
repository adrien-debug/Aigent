'use client'

/**
 * Formulaire de connexion — la seule surface atteignable sans session.
 *
 * SURFACE DE PRODUCTION : `DESIGN_DOCTRINE.md` s'applique intégralement.
 *  - primitives du kit (`Field`, `Label`, `Input`, `Button`, `Heading`, `Text`,
 *    `ErrorMessage`) réutilisées, aucun composant maison ;
 *  - `Label` est un LIBELLÉ RÉEL relié au champ par `Field` (Headless), pas un
 *    `placeholder` — un placeholder disparaît à la frappe ;
 *  - l'anneau de focus vient du scope `aig-scope` posé sur `<html>` ;
 *  - l'état d'erreur est explicite, textuel, et annoncé par `aria-live`.
 *
 * CE QUI N'EST JAMAIS AFFICHÉ ICI : le détail renvoyé par le serveur. La route
 * de login distingue déjà 400 / 401 / 429 / 503 ; on traduit ce STATUT en une
 * phrase produit, et on n'écho jamais le corps de la réponse. Un écho est le
 * chemin le plus court pour rendre au client un message interne.
 */
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { ErrorMessage, Field, Label } from '@/components/ui/fieldset'
import { Heading } from '@/components/ui/heading'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'

/**
 * Un statut HTTP → une phrase. La table est exhaustive sur ce que la route
 * peut répondre ; tout autre statut retombe sur un libellé générique, jamais
 * sur le corps de la réponse.
 */
function messageForStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Mot de passe incorrect.'
    case 429:
      return 'Trop de tentatives. Réessayez dans quelques minutes.'
    case 503:
      return "L'authentification n'est pas configurée sur ce serveur. Aucune session ne peut être ouverte."
    case 400:
      return 'Requête invalide.'
    default:
      return 'La connexion a échoué.'
  }
}

export default function SignInForm({ returnTo }: Readonly<{ returnTo: string }>) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (!response.ok) {
        setError(messageForStatus(response.status))
        setSubmitting(false)
        return
      }

      // Le cookie est posé par la réponse. `returnTo` a DÉJÀ été validé côté
      // serveur (`safeReturnTo`) : on ne le revalide pas ici pour éviter deux
      // règles divergentes, et il n'a pas transité par le client entre-temps.
      // `refresh()` force la re-lecture des Server Components avec la session.
      router.replace(returnTo)
      router.refresh()
    } catch {
      // Panne réseau : on ne sait pas si la requête est partie. On le dit sans
      // prétendre connaître la cause.
      setError('Le serveur est injoignable.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-6" noValidate>
      <div className="flex flex-col gap-2">
        <Heading level={1}>Connexion</Heading>
        <Text className="aig-text-muted">
          Le plan de contrôle d’Aigent est réservé aux opérateurs. Toutes les
          surfaces exigent une session.
        </Text>
      </div>

      <Field>
        {/* `Field` (Headless) relie lui-même le libellé au champ : pas de
            `htmlFor` manuel, qui divergerait au premier renommage. */}
        <Label>Mot de passe opérateur</Label>
        <Input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          invalid={error !== null}
          aria-describedby={error ? 'sign-in-error' : undefined}
        />
        {/* La zone d'erreur est TOUJOURS montée et annoncée : un conteneur
            créé au moment de l'erreur n'est pas fiablement lu par les lecteurs
            d'écran. Vide, elle n'occupe rien. */}
        <div id="sign-in-error" role="alert" aria-live="assertive">
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        </div>
      </Field>

      <Button
        type="submit"
        className="aig-btn-accent w-full justify-center"
        disabled={submitting || password.length === 0}
      >
        {submitting ? 'Connexion…' : 'Ouvrir une session'}
      </Button>
    </form>
  )
}
