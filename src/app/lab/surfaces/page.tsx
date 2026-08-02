import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import AppShell from '@/components/app-shell'
import SurfaceCatalog from '@/components/lab/surface-catalog'

/**
 * Route `/lab/surfaces` — démonstrateur du système de surfaces, HORS PRODUCTION.
 *
 * Même garde que `/lab` : `notFound()` en production. Une planche de contrôle
 * du langage visuel laissée accessible en production serait lue comme du
 * produit — elle ne porte aucune donnée réelle et ne doit jamais le laisser
 * croire. Ce n'est pas une garde de sécurité (il n'y a rien à protéger ici),
 * c'est une garde contre la confusion.
 *
 * Elle est rendue DANS `AppShell`, délibérément : c'est la seule façon de voir
 * la sidebar sombre et le body clair ensemble, c'est-à-dire de contrôler la
 * chose que cette page existe pour montrer.
 *
 * Absente de `NAVIGATION`, comme `/lab`.
 */
export const metadata: Metadata = { title: 'Aigent · Surfaces' }

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <AppShell>
      <SurfaceCatalog />
    </AppShell>
  )
}
