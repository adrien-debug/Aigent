import clsx from 'clsx'

type AvatarProps = {
  src?: string | null
  square?: boolean
  initials?: string
  alt?: string
  className?: string
}

export function Avatar({ src = null, square = false, initials, alt = '', className, ...props }: AvatarProps & React.ComponentPropsWithoutRef<'span'>) {
  return (
    <span
      {...props}
      className={clsx(
        className,
        'inline-grid shrink-0 size-8 place-content-center overflow-hidden align-middle outline -outline-offset-1 outline-black/10 dark:outline-white/10',
        square ? 'rounded-md' : 'rounded-full'
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="size-full object-cover" src={src} alt={alt} />
      ) : (
        initials && (
          <span className="text-xs font-medium uppercase text-zinc-600 dark:text-zinc-300" aria-hidden={alt ? undefined : 'true'}>
            {initials}
          </span>
        )
      )}
    </span>
  )
}
