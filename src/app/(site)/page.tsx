import {
  ArrowPathIcon,
  BeakerIcon,
  BoltIcon,
  ChevronRightIcon,
  CloudArrowUpIcon,
  CodeBracketSquareIcon,
  CpuChipIcon,
  ShieldCheckIcon,
} from '@heroicons/react/20/solid'
import type { Metadata } from 'next'
import Link from 'next/link'

import { ConsolePreview } from '@/components/marketing/console-preview'

export const metadata: Metadata = {
  title: 'Agent Mission Control — the control plane for production AI agents',
  description:
    'Configure copilots, run them for real, benchmark every change, and promote to production with human-in-the-loop confirmation — all from one console.',
}

const primaryFeatures = [
  {
    name: 'Copilot manifests',
    description:
      'Version every copilot as a manifest — tools, prompts, guardrails — with a full history and instant rollback to any prior version.',
    icon: CpuChipIcon,
  },
  {
    name: 'Real runs, not simulations',
    description:
      'Execute agents against LangGraph with live tracing. Inspect every step, tool call, and decision the model made, in order.',
    icon: BoltIcon,
  },
  {
    name: 'Human-in-the-loop by default',
    description:
      'Risky actions pause for explicit confirmation before they execute. Nothing destructive runs unattended unless you say so.',
    icon: ShieldCheckIcon,
  },
]

const secondaryFeatures = [
  {
    name: 'Benchmark suites.',
    description: 'Score copilots against curated test sets before every promotion — regressions get caught, not shipped.',
    icon: BeakerIcon,
  },
  {
    name: 'GitHub-native.',
    description: 'Runtime code the platform generates pushes straight to your repo, reviewed like any other change.',
    icon: CodeBracketSquareIcon,
  },
  {
    name: 'Test suites.',
    description: 'Attach repeatable test cases to any copilot version and re-run them on every change.',
    icon: ArrowPathIcon,
  },
  {
    name: 'Staged promotion.',
    description: 'Move a copilot from draft to shadow mode to production through explicit, auditable gates.',
    icon: CloudArrowUpIcon,
  },
]

const stats = [
  { id: 1, name: 'Copilots under management', value: '120+' },
  { id: 2, name: 'Runs executed monthly', value: '2.4m+' },
  { id: 3, name: 'Promotion gate pass rate', value: '99.2%' },
  { id: 4, name: 'Median time to promote', value: '< 1 day' },
]

export default function LandingPage() {
  return (
    <div className="bg-zinc-950">
      {/* Hero section */}
      <div className="relative isolate overflow-hidden">
        <svg
          aria-hidden="true"
          className="absolute inset-0 -z-10 size-full mask-[radial-gradient(100%_100%_at_top_right,white,transparent)] stroke-white/10"
        >
          <defs>
            <pattern
              x="50%"
              y={-1}
              id="hero-grid-pattern"
              width={200}
              height={200}
              patternUnits="userSpaceOnUse"
            >
              <path d="M.5 200V.5H200" fill="none" />
            </pattern>
          </defs>
          <rect fill="url(#hero-grid-pattern)" width="100%" height="100%" strokeWidth={0} />
        </svg>
        <div
          aria-hidden="true"
          className="absolute top-10 left-[calc(50%-4rem)] -z-10 transform-gpu blur-3xl sm:left-[calc(50%-18rem)] lg:top-[calc(50%-30rem)] lg:left-48 xl:left-[calc(50%-24rem)]"
        >
          <div
            style={{
              clipPath:
                'polygon(73.6% 51.7%, 91.7% 11.8%, 100% 46.4%, 97.4% 82.2%, 92.5% 84.9%, 75.7% 64%, 55.3% 47.5%, 46.5% 49.4%, 45% 62.9%, 50.3% 87.2%, 21.3% 64.1%, 0.1% 100%, 5.4% 51.1%, 21.4% 63.9%, 58.9% 0.2%, 73.6% 51.7%)',
            }}
            className="aspect-1108/632 w-277 bg-linear-to-r from-accent-700 to-accent-400 opacity-20"
          />
        </div>
        <div className="mx-auto max-w-7xl px-6 pt-10 pb-24 sm:pb-32 lg:flex lg:px-8 lg:py-40">
          <div className="mx-auto max-w-2xl shrink-0 lg:mx-0 lg:pt-8">
            <div className="mt-8 sm:mt-12 lg:mt-0">
              <Link href="/pricing" className="inline-flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="rounded-full bg-accent-500/10 px-3 py-1 text-sm/6 font-semibold text-accent-400 ring-1 ring-accent-500/25 ring-inset">
                  What&apos;s new
                </span>
                <span className="inline-flex items-center space-x-2 text-sm/6 font-medium text-zinc-300">
                  <span>Shadow-mode promotion gates just shipped</span>
                  <ChevronRightIcon aria-hidden="true" className="size-5 text-zinc-500" />
                </span>
              </Link>
            </div>
            <h1 className="mt-10 text-5xl font-semibold tracking-tight text-pretty text-white sm:text-7xl">
              Ship AI agents you can trust in production
            </h1>
            <p className="mt-8 text-lg font-medium text-pretty text-zinc-400 sm:text-xl/8">
              Agent Mission Control is the console for configuring copilots, running them against real workloads,
              benchmarking every change, and promoting to production behind human-in-the-loop confirmation gates.
            </p>
            <div className="mt-10 flex items-center gap-x-6">
              <Link
                href="/admin"
                className="rounded-md bg-accent-500 px-3.5 py-2.5 text-sm font-semibold text-zinc-950 shadow-xs hover:bg-accent-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
              >
                Open the console
              </Link>
              <Link href="/pricing" className="text-sm/6 font-semibold text-white">
                View pricing <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
          <div className="mx-auto mt-16 flex w-full max-w-2xl min-w-0 sm:mt-24 lg:mt-0 lg:ml-10 lg:max-w-none xl:ml-16">
            <div className="w-full min-w-0 flex-1">
              <ConsolePreview />
            </div>
          </div>
        </div>
      </div>

      {/* Logo cloud */}
      <div className="mx-auto mt-8 max-w-7xl px-6 sm:mt-16 lg:px-8">
        <h2 className="text-center text-lg/8 font-semibold text-white">
          Trusted by engineering teams running agents in production
        </h2>
        <div className="mx-auto mt-10 grid max-w-lg grid-cols-2 items-center gap-x-8 gap-y-10 sm:max-w-xl sm:grid-cols-3 lg:mx-0 lg:max-w-none lg:grid-cols-4">
          {['Northwind', 'Vantage Rail', 'Halcyon Labs', 'Cordage'].map((name) => (
            <div
              key={name}
              className="col-span-1 flex h-12 items-center justify-center text-center text-sm font-semibold text-zinc-500"
            >
              {name}
            </div>
          ))}
        </div>
      </div>

      {/* Feature section */}
      <div id="product" className="mx-auto mt-32 max-w-7xl px-6 sm:mt-56 lg:px-8">
        <div className="mx-auto max-w-2xl lg:text-center">
          <h2 className="text-base/7 font-semibold text-accent-400">Run with confidence</h2>
          <p className="mt-2 text-4xl font-semibold tracking-tight text-pretty text-white sm:text-5xl lg:text-balance">
            Everything you need to operate agents safely
          </p>
          <p className="mt-6 text-lg/8 text-zinc-400">
            From a versioned manifest to a production promotion, every step is visible, testable, and reversible.
          </p>
        </div>
        <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-none">
          <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-16 lg:max-w-none lg:grid-cols-3">
            {primaryFeatures.map((feature) => (
              <div key={feature.name} className="flex flex-col">
                <dt className="text-base/7 font-semibold text-white">
                  <div className="mb-6 flex size-10 items-center justify-center rounded-lg bg-accent-500">
                    <feature.icon aria-hidden="true" className="size-6 text-zinc-950" />
                  </div>
                  {feature.name}
                </dt>
                <dd className="mt-1 flex flex-auto flex-col text-base/7 text-zinc-400">
                  <p className="flex-auto">{feature.description}</p>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Secondary feature section */}
      <div className="mt-32 sm:mt-56">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl sm:text-center">
            <h2 className="text-base/7 font-semibold text-accent-400">Built for the whole lifecycle</h2>
            <p className="mt-2 text-4xl font-semibold tracking-tight text-pretty text-white sm:text-5xl sm:text-balance">
              From first draft to production traffic
            </p>
            <p className="mt-6 text-lg/8 text-zinc-400">
              Benchmarks, tests, and staged promotion gates keep every copilot accountable before it touches a real
              user.
            </p>
          </div>
        </div>
        <div className="relative overflow-hidden pt-16">
          <div className="mx-auto max-w-6xl px-6 lg:px-8">
            <ConsolePreview className="mb-[-4%]" />
            <div aria-hidden="true" className="relative">
              <div className="absolute -inset-x-20 bottom-0 bg-linear-to-t from-zinc-950 pt-[7%]" />
            </div>
          </div>
        </div>
        <div className="mx-auto mt-16 max-w-7xl px-6 sm:mt-20 md:mt-24 lg:px-8">
          <dl className="mx-auto grid max-w-2xl grid-cols-1 gap-x-6 gap-y-10 text-base/7 text-zinc-400 sm:grid-cols-2 lg:mx-0 lg:max-w-none lg:grid-cols-4 lg:gap-x-8 lg:gap-y-16">
            {secondaryFeatures.map((feature) => (
              <div key={feature.name} className="relative pl-9">
                <dt className="inline font-semibold text-white">
                  <feature.icon aria-hidden="true" className="absolute top-1 left-1 size-5 text-accent-400" />
                  {feature.name}
                </dt>{' '}
                <dd className="inline">{feature.description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Stats */}
      <div className="mx-auto mt-32 max-w-7xl px-6 sm:mt-56 lg:px-8">
        <div className="mx-auto max-w-2xl lg:mx-0 lg:max-w-xl">
          <h2 className="text-base/8 font-semibold text-accent-400">Running today</h2>
          <p className="mt-2 text-4xl font-semibold tracking-tight text-pretty text-white sm:text-5xl">
            Trusted by teams shipping agents at scale
          </p>
          <p className="mt-6 text-lg/8 text-zinc-300">
            Every number below comes from copilots running in real production traffic through Agent Mission Control.
          </p>
        </div>
        <dl className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-x-8 gap-y-10 text-white sm:mt-20 sm:grid-cols-2 sm:gap-y-16 lg:mx-0 lg:max-w-none lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.id} className="flex flex-col gap-y-3 border-l border-white/10 pl-6">
              <dt className="text-sm/6">{stat.name}</dt>
              <dd className="order-first text-3xl font-semibold tracking-tight">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* CTA section */}
      <div className="relative isolate mt-32 px-6 py-32 sm:mt-56 sm:py-40 lg:px-8">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-10 -z-10 flex transform-gpu justify-center overflow-hidden blur-3xl"
        >
          <div
            style={{
              clipPath:
                'polygon(73.6% 51.7%, 91.7% 11.8%, 100% 46.4%, 97.4% 82.2%, 92.5% 84.9%, 75.7% 64%, 55.3% 47.5%, 46.5% 49.4%, 45% 62.9%, 50.3% 87.2%, 21.3% 64.1%, 0.1% 100%, 5.4% 51.1%, 21.4% 63.9%, 58.9% 0.2%, 73.6% 51.7%)',
            }}
            className="aspect-1108/632 w-277 flex-none bg-linear-to-r from-accent-700 to-accent-400 opacity-20"
          />
        </div>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-balance text-white sm:text-5xl">
            Bring your agents under control
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg/8 text-pretty text-zinc-400">
            Start with a single copilot, or migrate a whole fleet. Every promotion still needs your sign-off.
          </p>
          <div className="mt-10 flex items-center justify-center gap-x-6">
            <Link
              href="/admin"
              className="rounded-md bg-accent-500 px-3.5 py-2.5 text-sm font-semibold text-zinc-950 shadow-xs hover:bg-accent-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
            >
              Open the console
            </Link>
            <Link href="/contact" className="text-sm/6 font-semibold text-white">
              Talk to us <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
