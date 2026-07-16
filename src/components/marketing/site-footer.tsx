import Link from 'next/link'

const NAVIGATION = {
  product: [
    { name: 'Copilots', href: '/#product' },
    { name: 'Runs & replay', href: '/#product' },
    { name: 'Benchmarks', href: '/#product' },
    { name: 'GitHub integration', href: '/#product' },
  ],
  resources: [
    { name: 'Pricing', href: '/pricing' },
    { name: 'About', href: '/about' },
    { name: 'Contact', href: '/contact' },
  ],
  company: [
    { name: 'About', href: '/about' },
    { name: 'Contact', href: '/contact' },
  ],
  legal: [
    { name: 'Terms of service', href: '/contact' },
    { name: 'Privacy policy', href: '/contact' },
  ],
  social: [
    {
      name: 'GitHub',
      href: 'https://github.com',
      icon: (props: React.ComponentPropsWithoutRef<'svg'>) => (
        <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
          />
        </svg>
      ),
    },
    {
      name: 'X',
      href: 'https://x.com',
      icon: (props: React.ComponentPropsWithoutRef<'svg'>) => (
        <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
          <path d="M13.6823 10.6218L20.2391 3H18.6854L12.9921 9.61788L8.44486 3H3.2002L10.0765 13.0074L3.2002 21H4.75404L10.7663 14.0113L15.5685 21H20.8131L13.6819 10.6218H13.6823ZM11.5541 13.0956L10.8574 12.0991L5.31391 4.16971H7.70053L12.1742 10.5689L12.8709 11.5655L18.6861 19.8835H16.2995L11.5541 13.096V13.0956Z" />
        </svg>
      ),
    },
  ],
}

export function SiteFooter() {
  return (
    <footer className="bg-zinc-950">
      <div className="mx-auto max-w-7xl px-6 pt-16 pb-8 sm:pt-24 lg:px-8 lg:pt-32">
        <div className="xl:grid xl:grid-cols-3 xl:gap-8">
          <div className="space-y-8">
            <span className="flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-surface)] ring-1 ring-[var(--accent-line)]">
                <svg viewBox="570.6 464.9 133.3 146.8" fill="currentColor" aria-hidden="true" className="size-4 text-accent-400">
                  <polygon points="601.7 466.9 572.6 466.9 572.6 609.7 601.7 609.7 601.7 549.1 633.1 579.4 665.8 579.4 601.7 517.5 601.7 466.9" />
                  <polygon points="672.7 466.9 672.7 528.1 644.6 500.9 612 500.9 672.7 559.7 672.7 609.7 701.9 609.7 701.9 466.9 672.7 466.9" />
                </svg>
              </span>
              <span className="text-sm font-semibold text-white">Agent Mission Control</span>
            </span>
            <p className="text-sm/6 text-balance text-zinc-400">
              The control plane for production AI agents — manifests, runs, benchmarks, and promotion gates in one
              place.
            </p>
            <div className="flex gap-x-6">
              {NAVIGATION.social.map((item) => (
                <a
                  key={item.name}
                  href={item.href}
                  className="-m-2.5 flex size-11 items-center justify-center text-zinc-400 hover:text-zinc-300"
                >
                  <span className="sr-only">{item.name}</span>
                  <item.icon aria-hidden="true" className="size-6" />
                </a>
              ))}
            </div>
          </div>
          <div className="mt-16 grid grid-cols-2 gap-8 xl:col-span-2 xl:mt-0">
            <div className="md:grid md:grid-cols-2 md:gap-8">
              <div>
                <h3 className="text-sm/6 font-semibold text-white">Product</h3>
                <ul role="list" className="mt-6 space-y-4">
                  {NAVIGATION.product.map((item) => (
                    <li key={item.name}>
                      <Link href={item.href} className="text-sm/6 text-zinc-400 hover:text-white">
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-10 md:mt-0">
                <h3 className="text-sm/6 font-semibold text-white">Resources</h3>
                <ul role="list" className="mt-6 space-y-4">
                  {NAVIGATION.resources.map((item) => (
                    <li key={item.name}>
                      <Link href={item.href} className="text-sm/6 text-zinc-400 hover:text-white">
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="md:grid md:grid-cols-2 md:gap-8">
              <div>
                <h3 className="text-sm/6 font-semibold text-white">Company</h3>
                <ul role="list" className="mt-6 space-y-4">
                  {NAVIGATION.company.map((item) => (
                    <li key={item.name}>
                      <Link href={item.href} className="text-sm/6 text-zinc-400 hover:text-white">
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-10 md:mt-0">
                <h3 className="text-sm/6 font-semibold text-white">Legal</h3>
                <ul role="list" className="mt-6 space-y-4">
                  {NAVIGATION.legal.map((item) => (
                    <li key={item.name}>
                      <Link href={item.href} className="text-sm/6 text-zinc-400 hover:text-white">
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-16 border-t border-white/10 pt-8 sm:mt-20 lg:mt-24">
          <p className="text-sm/6 text-zinc-400">
            &copy; {new Date().getFullYear()} Hearst Corporation. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
