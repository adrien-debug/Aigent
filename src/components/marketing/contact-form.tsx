'use client'

import { useCallback } from 'react'

const CONTACT_EMAIL = 'hello@hearstcorporation.io'

export function ContactForm() {
  const handleSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const firstName = String(data.get('first-name') ?? '')
    const lastName = String(data.get('last-name') ?? '')
    const company = String(data.get('company') ?? '')
    const email = String(data.get('email') ?? '')
    const copilots = String(data.get('copilots') ?? '')
    const message = String(data.get('message') ?? '')

    const subject = `Agent Mission Control — ${firstName} ${lastName}`.trim()
    const bodyLines = [
      `Name: ${firstName} ${lastName}`.trim(),
      company ? `Company: ${company}` : null,
      email ? `Reply-to email: ${email}` : null,
      copilots ? `Copilots running today: ${copilots}` : null,
      '',
      message,
    ].filter((line): line is string => line !== null)

    const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
      bodyLines.join('\n'),
    )}`
    window.location.href = mailto
  }, [])

  return (
    <>
      <p className="mx-auto mt-6 max-w-xl text-center text-sm/6 text-zinc-500">
        Submitting opens your email client with this message pre-filled, addressed to{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-accent-400 hover:text-accent-300">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
      <form onSubmit={handleSubmit} className="mx-auto mt-10 max-w-xl">
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <label htmlFor="first-name" className="block text-sm/6 font-semibold text-white">
              First name
            </label>
            <div className="mt-2.5">
              <input
                id="first-name"
                name="first-name"
                type="text"
                autoComplete="given-name"
                required
                className="block min-h-11 w-full rounded-md bg-white/5 px-3.5 py-2 text-base text-white outline-1 -outline-offset-1 outline-white/10 placeholder:text-zinc-500 focus:outline-2 focus:-outline-offset-2 focus:outline-accent-500"
              />
            </div>
          </div>
          <div>
            <label htmlFor="last-name" className="block text-sm/6 font-semibold text-white">
              Last name
            </label>
            <div className="mt-2.5">
              <input
                id="last-name"
                name="last-name"
                type="text"
                autoComplete="family-name"
                required
                className="block min-h-11 w-full rounded-md bg-white/5 px-3.5 py-2 text-base text-white outline-1 -outline-offset-1 outline-white/10 placeholder:text-zinc-500 focus:outline-2 focus:-outline-offset-2 focus:outline-accent-500"
              />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="company" className="block text-sm/6 font-semibold text-white">
              Company
            </label>
            <div className="mt-2.5">
              <input
                id="company"
                name="company"
                type="text"
                autoComplete="organization"
                className="block min-h-11 w-full rounded-md bg-white/5 px-3.5 py-2 text-base text-white outline-1 -outline-offset-1 outline-white/10 placeholder:text-zinc-500 focus:outline-2 focus:-outline-offset-2 focus:outline-accent-500"
              />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="email" className="block text-sm/6 font-semibold text-white">
              Email
            </label>
            <div className="mt-2.5">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="block min-h-11 w-full rounded-md bg-white/5 px-3.5 py-2 text-base text-white outline-1 -outline-offset-1 outline-white/10 placeholder:text-zinc-500 focus:outline-2 focus:-outline-offset-2 focus:outline-accent-500"
              />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="copilots" className="block text-sm/6 font-semibold text-white">
              How many copilots are you running today?
            </label>
            <div className="mt-2.5">
              <select
                id="copilots"
                name="copilots"
                defaultValue="none"
                className="block min-h-11 w-full appearance-none rounded-md bg-white/5 px-3.5 py-2 text-base text-white outline-1 -outline-offset-1 outline-white/10 focus:outline-2 focus:-outline-offset-2 focus:outline-accent-500"
              >
                <option value="none">Not yet — evaluating</option>
                <option value="1-3">1–3</option>
                <option value="4-10">4–10</option>
                <option value="10+">10+</option>
              </select>
            </div>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="message" className="block text-sm/6 font-semibold text-white">
              Message
            </label>
            <div className="mt-2.5">
              <textarea
                id="message"
                name="message"
                rows={4}
                required
                className="block min-h-11 w-full rounded-md bg-white/5 px-3.5 py-2 text-base text-white outline-1 -outline-offset-1 outline-white/10 placeholder:text-zinc-500 focus:outline-2 focus:-outline-offset-2 focus:outline-accent-500"
              />
            </div>
          </div>
        </div>
        <div className="mt-10">
          <button
            type="submit"
            className="block min-h-11 w-full rounded-md bg-accent-500 px-3.5 py-2.5 text-center text-sm font-semibold text-zinc-950 shadow-xs hover:bg-accent-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            Open email to send
          </button>
        </div>
      </form>
    </>
  )
}
