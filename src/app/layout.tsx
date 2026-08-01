import type { Metadata } from 'next'
import './globals.css'
import CssStudio from '@/components/css-studio'

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
   */
  return (
    <html lang="fr" className="dark aig-scope min-h-svh">
      <body className="aig-subtle min-h-svh antialiased">
        {children}
        {/* Outil de développement — inerte ET absent du bundle en production. */}
        <CssStudio />
      </body>
    </html>
  )
}
