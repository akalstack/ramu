import { useQuery } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { cn } from 'cn'
import { useHost } from '../workspace/HostProvider'

/**
 * A comment author's picture, fetched through the host (devices never load it from the service), or their initials on
 * a neutral disc while it loads, where the service needs a sign-in for it, or when it has none. A bot without a
 * picture shows the bot mark.
 */
export function CommentAvatar({
  name,
  url,
  bot,
  size = 24,
}: {
  name: string | null
  url?: string
  bot?: boolean
  size?: number
}) {
  const { id: hostId, invoke } = useHost()
  const picture = useQuery({
    queryKey: ['forge-avatar', hostId, url],
    queryFn: () => invoke('forge.avatar', url!),
    enabled: !!url,
    staleTime: Infinity,
    retry: false,
  })
  const initials = (name ?? '?')
    .replace(/\[bot\]$/i, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex flex-none items-center justify-center overflow-hidden rounded-full bg-fill font-medium text-soft [box-shadow:inset_0_0_0_1px_var(--line)]',
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {picture.data ? (
        <img
          src={picture.data}
          alt=""
          width={size}
          height={size}
          draggable={false}
          className="size-full object-cover"
        />
      ) : bot ? (
        <Bot size={Math.round(size * 0.55)} />
      ) : (
        initials || '?'
      )}
    </span>
  )
}
