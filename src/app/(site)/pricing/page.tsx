'use client'

import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import { CheckIcon } from '@heroicons/react/20/solid'
import { MinusSmallIcon, PlusSmallIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'
import Link from 'next/link'
import { useState } from 'react'

const tiers = [
  {
    name: 'Starter',
    id: 'starter',
    price: { monthly: '$0', annually: '$0' },
    description: 'For a single team validating a first copilot before it touches real users.',
    features: [
      'Up to 3 copilots',
      '1,000 runs / month',
      'Manifest versioning & rollback',
      'Community support',
    ],
    featured: false,
    cta: 'Start free',
  },
  {
    name: 'Team',
    id: 'team',
    price: { monthly: '$249', annually: '$2,490' },
    description: 'For teams running copilots in production with real benchmarks and gates.',
    features: [
      'Unlimited copilots',
      '50,000 runs / month',
      'Benchmark & test suites',
      'Shadow-mode promotion gates',
      'GitHub push integration',
      'Priority support (next business day)',
    ],
    featured: true,
    cta: 'Start a trial',
  },
  {
    name: 'Enterprise',
    id: 'enterprise',
    price: { monthly: 'Custom', annually: 'Custom' },
    description: 'For organizations operating agent fleets across multiple teams and environments.',
    features: [
      'Everything in Team',
      'Unlimited runs',
      'SSO & audit-grade access control',
      'Dedicated promotion approvers',
      'Custom retention & data residency',
      'Dedicated support with SLA',
    ],
    featured: false,
    cta: 'Talk to sales',
  },
]

const faqs = [
  {
    question: 'What counts as a "run"?',
    answer:
      'A run is one end-to-end execution of a copilot against LangGraph — from the triggering event to the final response or the point where it pauses for human confirmation.',
  },
  {
    question: 'How does human-in-the-loop confirmation affect billing?',
    answer:
      'Confirmation pauses do not consume extra runs. A run that pauses and is later approved or rejected is still counted once.',
  },
  {
    question: 'Can I mix shadow mode and production copilots on the same plan?',
    answer:
      'Yes. Shadow-mode runs count toward your plan the same way production runs do, so you can validate a new version against real traffic before promoting it.',
  },
  {
    question: 'Do you support self-hosted deployments?',
    answer:
      'Enterprise plans can be deployed against your own infrastructure. Talk to sales to scope data residency and network requirements.',
  },
  {
    question: 'What happens if I exceed my monthly run quota?',
    answer:
      'We notify you before you hit the limit. Starter plans pause new runs until the next cycle; Team and Enterprise plans can burst with overage billing.',
  },
  {
    question: 'Can I change plans later?',
    answer:
      'Yes, upgrades apply immediately and downgrades take effect at the next billing cycle. Your copilots, manifests, and run history are never affected by a plan change.',
  },
]

export default function PricingPage() {
  const [annual, setAnnual] = useState(false)

  return (
    <div className="bg-zinc-950">
      <div className="pt-24 sm:pt-32">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="text-base/7 font-semibold text-accent-400">Pricing</h1>
            <p className="mt-2 text-5xl font-semibold tracking-tight text-balance text-white sm:text-6xl">
              Plans for every stage of the agent lifecycle
            </p>
          </div>
          <p className="mx-auto mt-6 max-w-2xl text-center text-lg font-medium text-pretty text-zinc-400 sm:text-xl/8">
            Start free while you validate a copilot. Move to Team when you need benchmarks, promotion gates, and
            GitHub integration. Move to Enterprise when more than one team needs a say in what ships.
          </p>
          <div className="mt-16 flex justify-center">
            <fieldset aria-label="Payment frequency">
              <div className="grid grid-cols-2 gap-x-1 rounded-full p-1 text-center text-xs/5 font-semibold ring-1 ring-white/10">
                <label
                  className={clsx(
                    'cursor-pointer rounded-full px-2.5 py-1 transition-colors',
                    !annual ? 'bg-accent-500 text-zinc-950' : 'text-zinc-400'
                  )}
                >
                  <input
                    type="radio"
                    name="frequency"
                    checked={!annual}
                    onChange={() => setAnnual(false)}
                    className="sr-only"
                  />
                  Monthly
                </label>
                <label
                  className={clsx(
                    'cursor-pointer rounded-full px-2.5 py-1 transition-colors',
                    annual ? 'bg-accent-500 text-zinc-950' : 'text-zinc-400'
                  )}
                >
                  <input
                    type="radio"
                    name="frequency"
                    checked={annual}
                    onChange={() => setAnnual(true)}
                    className="sr-only"
                  />
                  Annually
                </label>
              </div>
            </fieldset>
          </div>
          <div className="isolate mx-auto mt-10 grid max-w-md grid-cols-1 gap-8 md:max-w-2xl md:grid-cols-2 lg:max-w-4xl xl:mx-0 xl:max-w-none xl:grid-cols-3">
            {tiers.map((tier) => (
              <div
                key={tier.id}
                className={clsx(
                  'rounded-3xl p-8 ring-1',
                  tier.featured ? 'bg-white/5 ring-2 ring-accent-500' : 'ring-white/10'
                )}
              >
                <div className="flex items-center justify-between gap-x-4">
                  <h3 className={clsx('text-lg/8 font-semibold', tier.featured ? 'text-accent-400' : 'text-white')}>
                    {tier.name}
                  </h3>
                  {tier.featured ? (
                    <p className="rounded-full bg-accent-500 px-2.5 py-1 text-xs/5 font-semibold text-zinc-950">
                      Most popular
                    </p>
                  ) : null}
                </div>
                <p className="mt-4 text-sm/6 text-zinc-300">{tier.description}</p>
                <p className="mt-6 flex items-baseline gap-x-1">
                  <span className="text-4xl font-semibold tracking-tight text-white">
                    {annual ? tier.price.annually : tier.price.monthly}
                  </span>
                  {tier.price.monthly !== 'Custom' && (
                    <span className="text-sm/6 font-semibold text-zinc-400">{annual ? '/year' : '/month'}</span>
                  )}
                </p>
                <Link
                  href={tier.id === 'enterprise' ? '/contact' : '/admin'}
                  className={clsx(
                    'mt-6 flex min-h-11 w-full items-center justify-center rounded-md px-3 py-2 text-center text-sm/6 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2',
                    tier.featured
                      ? 'bg-accent-500 text-zinc-950 hover:bg-accent-400 focus-visible:outline-accent-500'
                      : 'text-white ring-1 ring-white/20 hover:ring-white/30 focus-visible:outline-white'
                  )}
                >
                  {tier.cta}
                </Link>
                <ul role="list" className="mt-8 space-y-3 text-sm/6 text-zinc-300">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-x-3">
                      <CheckIcon aria-hidden="true" className="h-6 w-5 flex-none text-accent-400" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ section */}
        <div className="mx-auto mt-24 max-w-7xl px-6 pb-24 sm:mt-32 sm:pb-32 lg:px-8">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Frequently asked questions
            </h2>
            <dl className="mt-16 divide-y divide-white/10">
              {faqs.map((faq) => (
                <Disclosure key={faq.question} as="div" className="py-6 first:pt-0 last:pb-0">
                  <dt>
                    <DisclosureButton className="group flex min-h-11 w-full items-center justify-between text-left text-white">
                      <span className="text-base/7 font-semibold">{faq.question}</span>
                      <span className="ml-6 flex h-7 items-center">
                        <PlusSmallIcon aria-hidden="true" className="size-6 group-data-open:hidden" />
                        <MinusSmallIcon aria-hidden="true" className="size-6 group-not-data-open:hidden" />
                      </span>
                    </DisclosureButton>
                  </dt>
                  <DisclosurePanel as="dd" className="mt-2 pr-12">
                    <p className="text-base/7 text-zinc-400">{faq.answer}</p>
                  </DisclosurePanel>
                </Disclosure>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
