import type { Provider } from '@/lib/site'

/** Each provider's own mark in its own colors. */
export function ProviderLogo({ provider, size = 28 }: { provider: Provider; size?: number }) {
  const iconSize = size * (provider.id === 'codex' ? 0.88 : 0.64)

  return (
    <span className={`logo-tile logo-${provider.id}`} style={{ width: size, height: size }} aria-hidden="true">
      <img src={provider.logo} alt="" width={iconSize} height={iconSize} />
    </span>
  )
}
