import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Aigent · Control',
  description: 'Plan de contrôle des agents — création, qualification, livraison, télémétrie.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // `h-full` sur html ET body est exigé par le shell : le cockpit occupe
  // exactement le viewport. Le fond presque noir est porté ici pour éviter un
  // flash clair avant l'hydratation.
  return (
    <html lang="fr" className="h-full bg-base">
      <body className="h-full antialiased">{children}</body>
    </html>
  )
}
