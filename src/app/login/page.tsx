'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Field, Fieldset, Label } from '@/components/ui/fieldset'
import { Heading } from '@/components/ui/heading'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'

/**
 * Resolve where to land after a successful sign-in. We only ever follow an
 * internal `/admin*` path from the `next` query param; anything else (external
 * URLs, protocol-relative `//evil`, non-admin paths) falls back to `/admin`.
 */
function safeDestination(next: string | null): string {
  if (next && next.startsWith('/admin') && !next.startsWith('//')) return next
  return '/admin'
}

function LoginForm() {
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        // Full navigation so the freshly-set httpOnly session cookie is sent.
        window.location.href = safeDestination(searchParams.get('next'))
        return
      }

      let message = 'Sign-in failed.'
      try {
        const data: { error?: string } = await res.json()
        if (typeof data.error === 'string' && data.error) message = data.error
      } catch {
        // keep the fallback message
      }
      setError(message)
      setPending(false)
    } catch {
      setError('Sign-in failed.')
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Fieldset>
        <Field>
          <Label>Password</Label>
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
          />
        </Field>

        {/* A REJECTED sign-in used to render in `accent-400` — measured
            rgb(192,250,175) on the card, i.e. the exact green this design system
            reserves for "healthy / primary / done". The interface said success
            while it reported a failure. `--state-danger-*` is the semantic
            channel for failure (src/theme.css), and `src/app/admin/error.tsx`
            already applies that arbitration to the /admin error boundary; this
            page is the same situation, one segment higher.

            WHY THE GATE DIDN'T CATCH IT: `check:danger` rule 1 (`alert-accent`)
            is exactly this pattern — `role="alert"` plus an accent class in the
            opening tag — but its DASHBOARD_DIRS scope is
            app/admin + components/{agent-ops,views,shell}. `src/app/login/` is
            in none of them, so the one violation the rule was written for lived
            in the one file the rule could not see. Widening that scope belongs
            to whoever owns scripts/, not to this lot; it is reported instead.

            No light-mode pair: <html> is hard-set to `dark` in
            `src/app/layout.tsx`, so a `dark:` variant here would be the only
            branch that ever renders. `--state-danger-text` #f87171 on the card
            plane zinc-950 measures 7.11:1 — checked in the browser, not
            inferred. */}
        {error ? (
          <p className="mt-3 text-sm/6 font-semibold text-[var(--state-danger-text)]" role="alert" aria-live="polite">
            {error}
          </p>
        ) : null}

        <Button type="submit" color="accent" disabled={pending} className="mt-8 w-full">
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </Fieldset>
    </form>
  )
}

function LoginFormSkeleton() {
  return (
    <div className="animate-pulse" aria-hidden="true">
      <div className="h-4 w-16 rounded bg-zinc-950/10 dark:bg-white/10" />
      <div className="mt-3 h-9 w-full rounded-lg bg-zinc-950/10 dark:bg-white/10" />
      <div className="mt-8 h-9 w-full rounded-lg bg-zinc-950/10 dark:bg-white/10" />
    </div>
  )
}

export default function LoginPage() {
  // Theme-aware like the rest of the app (see SidebarLayout): page body
  // is bg-zinc-100/dark:bg-zinc-900, framed surfaces are bg-white/dark:bg-zinc-950.
  // Previously this page hardcoded the dark-only look regardless of theme.
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-100 px-6 py-12 dark:bg-zinc-900">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
        <Heading level={1}>Agent Mission Control</Heading>
        <Text className="mt-1">Admin access</Text>

        <div className="mt-8">
          <Suspense fallback={<LoginFormSkeleton />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  )
}
