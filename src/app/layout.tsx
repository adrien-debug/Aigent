import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Agent Mission Control',
  description: 'Plan de contrôle des agents — création, qualification, livraison, télémétrie.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // `h-full` sur html ET body est exigé par le shell : ses colonnes sont en
  // position fixed sur toute la hauteur. Le fond sombre est porté ici pour
  // éviter un flash clair avant l'hydratation.
  return (
    <html lang="fr" className="h-full bg-gray-900">
      <body className="h-full">{children}</body>
    </html>
  )
}
