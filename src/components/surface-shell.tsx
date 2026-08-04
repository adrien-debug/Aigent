/**
 * États transitoires et d'erreur — toujours via PageHeader + PageBody.
 *
 * Toute surface (loading, indisponible, 404) partage la même géométrie que
 * les écrans nominaux : le scroll vit dans PageBody, jamais dans un `h-full`
 * local.
 */
import type { ReactNode } from 'react'

import { PageBody, PageHeader } from '@/components/app-shell'
import SurfaceState from '@/components/surface-state'

export function SurfaceLoading({
  title,
  description,
  detail = 'La surface est en cours de lecture.',
}: Readonly<{
  title: string
  description?: string
  detail?: string
}>) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <PageBody>
        <section className="aig-panel flex min-h-[50svh] items-center justify-center p-6">
          <SurfaceState kind="loading" detail={detail} />
        </section>
      </PageBody>
    </>
  )
}
export function SurfaceUnavailable({
  title,
  description,
  detail,
}: Readonly<{
  title: string
  description?: string
  detail: string
}>) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <PageBody>
        <section className="aig-panel flex min-h-[50svh] items-center justify-center p-6">
          <SurfaceState kind="unavailable" detail={detail} />
        </section>
      </PageBody>
    </>
  )
}
export function SurfaceNotFound({
  title,
  description,
  detail,
  children,
}: Readonly<{
  title: string
  description?: string
  detail: string
  children?: ReactNode
}>) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <PageBody>
        <section className="aig-panel flex min-h-[50svh] flex-col items-center justify-center gap-4 p-6 text-center">
          <SurfaceState kind="empty" detail={detail} />
          {children}
        </section>
      </PageBody>
    </>
  )
}