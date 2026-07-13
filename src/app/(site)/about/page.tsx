import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'About — Agent Mission Control',
  description:
    'Why Agent Mission Control exists: a control plane for AI agents built by people who watched agent rollouts fail in production.',
}

const timeline = [
  {
    name: 'First copilot, first incident',
    description:
      'An unattended agent pushed a destructive change to a customer environment. No manifest history, no replay, no way to know what it had actually seen.',
    date: 'Year 1',
    dateTime: '2024-01',
  },
  {
    name: 'Manifests and versioning',
    description:
      'Every copilot became a versioned artifact — tools, prompts, and guardrails tracked like code, with instant rollback to any prior version.',
    date: 'Year 1',
    dateTime: '2024-06',
  },
  {
    name: 'Benchmarks and shadow mode',
    description:
      'Copilots started running against curated test suites and shadow traffic before a single promotion gate would open.',
    date: 'Year 2',
    dateTime: '2025-02',
  },
  {
    name: 'Human-in-the-loop by default',
    description:
      'Risky actions now pause for explicit confirmation before they execute — the incident that started this became structurally impossible to repeat.',
    date: 'Year 2',
    dateTime: '2025-09',
  },
]

const stats = [
  { id: 1, name: 'Copilots under management', value: '120+' },
  { id: 2, name: 'Runs executed monthly', value: '2.4m+' },
  { id: 3, name: 'Promotion gate pass rate', value: '99.2%' },
  { id: 4, name: 'Teams operating on the platform', value: '30+' },
]

export default function AboutPage() {
  return (
    <div className="bg-zinc-950">
      <div className="mx-auto max-w-7xl px-6 pt-24 pb-16 sm:pt-32 sm:pb-24 lg:px-8">
        <div className="mx-auto max-w-2xl lg:mx-0">
          <h1 className="text-5xl font-semibold tracking-tight text-pretty text-white sm:text-7xl">
            Agents that ship, not agents that surprise you
          </h1>
          <p className="mt-8 text-lg font-medium text-pretty text-zinc-400 sm:text-xl/8">
            Agent Mission Control exists because someone had to watch an unattended agent make a call it shouldn&apos;t
            have, and decide that would never happen again. We build the control plane we wished we had: manifests,
            real runs, benchmarks, and a promotion process that always asks before it acts.
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="mx-auto -mt-8 max-w-7xl px-6 lg:px-8">
        <div className="mx-auto grid max-w-2xl grid-cols-1 gap-8 overflow-hidden lg:mx-0 lg:max-w-none lg:grid-cols-4">
          {timeline.map((item) => (
            <div key={item.name} className="border-l-2 border-l-accent-500 pl-6">
              <dt className="text-sm/6 text-zinc-400">
                <time dateTime={item.dateTime}>{item.date}</time>
              </dt>
              <dd className="mt-1 text-base font-semibold text-white">{item.name}</dd>
              <dd className="mt-2 text-sm/6 text-zinc-400">{item.description}</dd>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="mx-auto mt-32 max-w-7xl px-6 sm:mt-40 lg:px-8">
        <div className="mx-auto grid max-w-2xl grid-cols-1 gap-x-8 gap-y-16 text-center lg:mx-0 lg:max-w-none lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.id} className="mx-auto flex max-w-xs flex-col gap-y-4">
              <dt className="text-base/7 text-zinc-400">{stat.name}</dt>
              <dd className="order-first text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                {stat.value}
              </dd>
            </div>
          ))}
        </div>
      </div>

      {/* Principles */}
      <div className="mx-auto mt-32 max-w-7xl px-6 pb-24 sm:mt-40 sm:pb-32 lg:px-8">
        <div className="mx-auto max-w-2xl lg:mx-0">
          <h2 className="text-4xl font-semibold tracking-tight text-pretty text-white sm:text-5xl">
            What we build on
          </h2>
        </div>
        <dl className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-x-8 gap-y-10 text-base/7 text-zinc-400 sm:grid-cols-2 lg:mx-0 lg:max-w-none lg:grid-cols-3">
          <div>
            <dt className="font-semibold text-white">Nothing runs unattended by default.</dt>
            <dd className="mt-1">
              Confirmation gates exist for a reason. An agent that can act on production should have to ask before it
              does anything irreversible.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-white">Every version is a rollback target.</dt>
            <dd className="mt-1">
              A manifest is not a config file you overwrite. It&apos;s a version you can always return to, with a full
              diff of what changed and why.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-white">Benchmarks come before promotion, not after incidents.</dt>
            <dd className="mt-1">
              A copilot earns production traffic by passing the same test suite every time, not by surviving its
              first week live.
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
