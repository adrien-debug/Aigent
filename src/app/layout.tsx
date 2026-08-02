import type { Metadata } from 'next'
import './globals.css'
import CssStudio from '@/components/css-studio'
import MotionProvider from '@/components/motion-provider'

export const metadata: Metadata = {
  title: 'Aigent · Control',
  description: 'Plan de contrôle des agents — création, qualification, livraison, télémétrie.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  /**
   * DARK-FIRST AU NIVEAU DU DOCUMENT — le geste qui unifie le produit.
   *
   * Avant : le document était blanc, la navigation posait un scope `dark`
   * local, et chaque écran devait décider s'il rendait clair, sombre, ou
   * sombre-dans-une-boîte. Trois écrans avaient tranché différemment
   * (`bg-[#0a0a0b]`, `bg-white`, `bg-zinc-900`), tous « corrects » isolément.
   *
   * La classe `dark` sur `<html>` active le `@custom-variant` de `globals.css` :
   * le kit Catalyst bascule sur ses PROPRES couleurs sombres, partout, sans
   * qu'une seule ligne du kit soit modifiée (`check:ui-kit-integrity` tient).
   * `aig-scope` apporte le fond graphite et l'anneau de focus unique.
   *
   * Le fond du body est `--aig-subtle` : le creux du produit. Les zones qui
   * PORTENT du contenu montent d'un palier (`aig-panel`), ce qui crée la
   * hiérarchie par la valeur plutôt que par des bordures partout.
   *
   * `MotionProvider` respecte `prefers-reduced-motion` pour tout ce qui est
   * rendu dessous — y compris les animations écrites plus tard. Ses limites
   * connues sont documentées dans le composant.
   *
   * HAUTEUR — `h-svh overflow-hidden`, PAS `min-h-svh`.
   *
   * `min-height` pose un PLANCHER et jamais un PLAFOND : le document grandissait
   * avec son contenu. Mesuré sur `/runtime` (2026-08-02, 1280×800) : le document
   * faisait 4014 px, dont ~3730 px de vide non défilable, parce que le creux de
   * l'onglet remplissait fidèlement un parent lui-même non borné. Toute la chaîne
   * flex sous `main` était juste — elle était simplement ancrée dans le vide.
   *
   * Le document est donc la RACINE bornée : il ne défile plus jamais. Ce sont les
   * zones qui doivent défiler qui portent leur propre `overflow-y-auto`, ce qui
   * exige `min-h-0` sur chaque maillon flex intermédiaire (sans lui, `flex-1`
   * refuse de descendre sous la taille de son contenu).
   */
  return (
    <html lang="fr" className="dark aig-scope h-svh overflow-hidden">
      <body className="aig-subtle h-svh overflow-hidden antialiased">
        <MotionProvider>{children}</MotionProvider>
        {/* Outil de développement — inerte ET absent du bundle en production. */}
        <CssStudio />
      </body>
    </html>
  )
}
