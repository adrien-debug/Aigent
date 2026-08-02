import clsx from 'clsx'

export function Divider({
  soft = false,
  className,
  ...props
}: Readonly<{ soft?: boolean } & React.ComponentPropsWithoutRef<'hr'>>) {
  return (
    <hr
      role="presentation"
      {...props}
      className={clsx(
        className,
        'w-full border-t',
        // `soft` distingue deux POIDS de trait : le produit a exactement deux
        // jetons pour ça, la nuance est conservée telle quelle.
        soft && 'border-(--aig-line-soft)',
        !soft && 'border-(--aig-line)'
      )}
    />
  )
}
