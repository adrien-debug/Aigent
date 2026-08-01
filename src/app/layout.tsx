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
  // Zone de travail claire ; la navigation porte son propre scope `dark` dans
  // `AppShell`. Le kit Catalyst rend en mode clair ici — pas de repeinte du kit.
  return (
    <html lang="fr" className="min-h-svh bg-white">
      <body className="min-h-svh bg-white text-zinc-950 antialiased">
        {children}
        {/* Outil de développement — inerte ET absent du bundle en production. */}
        <CssStudio />
      </body>
    </html>
  )
}
