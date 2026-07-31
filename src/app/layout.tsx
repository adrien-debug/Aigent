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
  // exactement le viewport.
  //
  // `dark` est une CLASSE, pas seulement `color-scheme` : c'est elle qui active
  // les variantes `dark:` de Tailwind, donc tout le mode sombre du kit
  // (`dark:bg-zinc-900`, `dark:text-white`…). Sans elle, le kit rend
  // en clair et on est tenté de le repeindre — ce qu'interdit
  // `check:ui-kit-integrity`.
  return (
    <html lang="fr" className="dark h-full bg-zinc-950">
      <body className="h-full antialiased">{children}</body>
    </html>
  )
}
