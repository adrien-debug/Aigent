'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { Button } from '@/components/catalyst/button'
import { Field, Fieldset, Label } from '@/components/catalyst/fieldset'
import { Heading } from '@/components/catalyst/heading'
import { Input } from '@/components/catalyst/input'
import { Text } from '@/components/catalyst/text'

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

        {error ? (
          <p className="mt-3 text-sm/6 font-semibold text-accent-700 dark:text-accent-400" role="alert" aria-live="polite">
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
  // Theme-aware like the rest of the app (see AgentControlShell): page body
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
