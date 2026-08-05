/**
 * Catalyst Link — branché sur le routeur Next.js (App Router).
 *
 * Intégration officielle :
 * https://catalyst.tailwindui.com/docs#client-side-router-integration
 *
 * Sans ce branchement, `SidebarItem` / `TextLink` / etc. rendaient un `<a>`
 * brut → navigation full-page au lieu du prefetch + soft nav App Router.
 */

import * as Headless from '@headlessui/react'
import NextLink, { type LinkProps } from 'next/link'
import React, { forwardRef } from 'react'

export const Link = forwardRef(function Link(
  props: LinkProps & React.ComponentPropsWithoutRef<'a'>,
  ref: React.ForwardedRef<HTMLAnchorElement>
) {
  return (
    <Headless.DataInteractive>
      <NextLink {...props} ref={ref} />
    </Headless.DataInteractive>
  )
})
