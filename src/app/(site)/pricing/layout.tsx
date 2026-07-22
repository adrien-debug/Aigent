import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pricing — Agent Mission Control',
  description: 'Plans for running copilots from a first evaluation build through production traffic.',
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children
}
