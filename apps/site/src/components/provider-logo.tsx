import type { Provider } from '@/lib/site'

/** Single-color logos are drawn as a mask so they follow the tile's text color. */
const MONOCHROME = new Set(['claude', 'codex', 'cursor'])

export function ProviderLogo({ provider, size = 28 }: { provider: Provider; size?: number }) {
  const iconSize = size * (provider.id === 'codex' ? 0.88 : 0.64)

  return (
    <span className={`logo-tile logo-${provider.id}`} style={{ width: size, height: size }} aria-hidden="true">
      {MONOCHROME.has(provider.id) ? (
        <span
          className="logo-mark"
          style={{ width: iconSize, height: iconSize, maskImage: `url("${provider.logo}")` }}
        />
      ) : (
        <img src={provider.logo} alt="" width={iconSize} height={iconSize} />
      )}
    </span>
  )
}
