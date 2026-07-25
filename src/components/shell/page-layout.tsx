import clsx from 'clsx'

export function PageLayout({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={clsx('flex flex-col gap-4 pb-8', className)}>{children}</div>
}
