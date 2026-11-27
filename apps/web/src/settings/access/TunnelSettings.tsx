import type { NetworkStatus, TunnelChoice } from '@ramu/shared/types'
import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { LocalInlineAction } from '@/components/inline-action'
import { Input } from '@/components/ui/input'
import { Dropdown } from '../../Menu'
import { ramu } from '../../ipc'
import { t } from '../../i18n'
import { CopyButton } from '../CopyAddressButton'
import { RamuLinkState, type RouteChoice } from '../RamuLinkState'
import { STATUS_LINE, type TunnelDraft, type TunnelMode } from './reach'

const TUNNEL_MODES: TunnelMode[] = ['off', 'link', 'quick', 'tailscale', 'ngrok', 'manual']
const TUNNEL_LABEL: Record<TunnelMode, string> = {
  off: 'Only my network or VPN',
  link: 'Ramu Link',
  quick: 'Quick tunnel (Cloudflare)',
  tailscale: 'Tailscale Funnel',
  ngrok: 'ngrok',
  manual: 'My own tunnel address',
}
const TUNNEL_HELP: Record<TunnelMode, string> = {
  off: 'Devices reach this host on your network or VPN. Choose a tunnel to reach it from anywhere.',
  link: 'A free address from Ramu that stays the same, for up to 3 computers per Ramu account; your phones and other devices don’t count. Ramu runs cloudflared for it. Cloudflare can read the traffic; every call still needs a paired device.',
  quick:
    'Ramu starts a Cloudflare quick tunnel. No account needed. The address changes each time Ramu starts, so it suits trying things out. Cloudflare can read the traffic.',
  tailscale:
    'Ramu turns on Tailscale Funnel for this machine, with an address that stays the same. Allow Funnel for it in your Tailscale settings. Tailscale can read the traffic.',
  ngrok: 'Ramu runs ngrok with your account. Run ngrok config add-authtoken once first. ngrok can read the traffic.',
  manual:
    'For a tunnel you run yourself, such as a named Cloudflare Tunnel, pointed at port {0} on this computer. Paste its https:// address.',
}
const TUNNEL_TOOL: Record<TunnelChoice['kind'], 'cloudflared' | 'tailscale' | 'ngrok'> = {
  link: 'cloudflared',
  quick: 'cloudflared',
  tailscale: 'tailscale',
  ngrok: 'ngrok',
}
/** How to install each tool here: Homebrew on a Mac, the vendor's download page elsewhere. */
const TOOL_INSTALL: Record<'cloudflared' | 'tailscale' | 'ngrok', { brew?: string; url: string }> = {
  cloudflared: {
    brew: 'brew install cloudflared',
    url: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
  },
  tailscale: { url: 'https://tailscale.com/download' },
  ngrok: { brew: 'brew install ngrok', url: 'https://ngrok.com/download' },
}

/** The tunnel's name in a sentence, such as "Anywhere, through Tailscale Funnel". */
export const tunnelName = (mode: TunnelMode) => t(TUNNEL_LABEL[mode])

/** What the chosen tunnel is doing: its address once it runs, why it stopped, or what to install for it. */
function TunnelState({ status, mode, staged }: { status: NetworkStatus; mode: TunnelMode; staged: boolean }) {
  const tunnel = status.tunnel
  if (!tunnel || mode === 'off' || mode === 'manual' || staged) return null
  const tool = TUNNEL_TOOL[mode]
  const install = TOOL_INSTALL[tool]
  const mac = navigator.userAgent.includes('Mac')
  if (tunnel.state === 'missing' || !tunnel.tools[tool])
    return (
      <p className={STATUS_LINE} role="status">
        {t('{0} is not installed on this computer.', { 0: tool })}
        {mac && install.brew ? (
          <>
            <code className="rounded-(--radius-s) bg-fill px-1.5 py-0.5">{install.brew}</code>
            <CopyButton text={install.brew} label={t('Copy the install command')} />
          </>
        ) : (
          <LocalInlineAction onClick={() => void ramu.invoke('app.openExternal', install.url).catch(() => {})}>
            {t('Download it')}
          </LocalInlineAction>
        )}
        {t('Ramu starts it by itself once it is installed.')}
      </p>
    )
  // Ramu Link says its own state (RamuLinkState); only a missing cloudflared is told here.
  if (mode === 'link') return null
  if (tunnel.state === 'running' && tunnel.url)
    return (
      <p className={STATUS_LINE} role="status">
        {t('Reachable at {0}', { 0: tunnel.url })}
        <CopyButton text={tunnel.url} label={t('Copy the tunnel address')} />
      </p>
    )
  if (tunnel.state === 'failed')
    return (
      <p className={`${STATUS_LINE} text-warn`} role="status">
        {t('The tunnel stopped: {0}. Ramu will try again shortly.', { 0: tunnel.error ?? tool })}
      </p>
    )
  return (
    <p className={STATUS_LINE} role="status">
      {t('Starting {0}…', { 0: tool })}
    </p>
  )
}

/**
 * How the chosen route from anywhere stands, right under Reachable from: the tunnel's address, a tool to install, or
 * why Ramu Link can't be had (signed out, full, paused) with the fix and the other routes beside it.
 */
export function TunnelStatus({
  status,
  tunnel,
  saved,
  signedIn,
  onChoose,
  onRelease,
  onReleaseOther,
}: {
  status: NetworkStatus
  tunnel: TunnelDraft
  saved: TunnelChoice | null
  /** Whether this host is signed in to the Ramu account, which Ramu Link needs; null while unknown. */
  signedIn: boolean | null
  onChoose: (route: RouteChoice) => void
  onRelease: () => void
  onReleaseOther: (hostId: string) => Promise<unknown>
}) {
  const staged = tunnel.mode !== (saved?.kind ?? null) || tunnel.relay.trim() !== (saved?.relay ?? '')
  return (
    <>
      {tunnel.mode === 'link' && staged && signedIn === false && (
        <p className={STATUS_LINE} role="status">
          {t('Ramu Link needs the Ramu account on this computer.')}
          <LocalInlineAction
            onClick={() => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'account' } }))}
          >
            {t('Sign in')}
          </LocalInlineAction>
        </p>
      )}
      {/* Signed out, the slots are not this computer's to take yet; signing in comes first. */}
      {tunnel.mode === 'link' && !(staged && signedIn === false) && (
        <RamuLinkState
          status={status}
          staged={staged}
          onChoose={onChoose}
          onRelease={onRelease}
          onReleaseOther={onReleaseOther}
        />
      )}
      <TunnelState status={status} mode={tunnel.mode} staged={tunnel.mode !== (saved?.kind ?? null)} />
    </>
  )
}

/** Which tunnel reaches this host from anywhere, under Advanced, with what each one needs. */
export function TunnelChoiceRows({
  status,
  tunnel,
  saved,
  fixed,
  showRelay,
  onChange,
}: {
  status: NetworkStatus
  tunnel: TunnelDraft
  saved: TunnelChoice | null
  /** Set from the command line, so it shows but cannot change here. */
  fixed: boolean
  showRelay: boolean
  onChange: (tunnel: TunnelDraft) => void
}) {
  const pool = status.tunnel?.pool
  const linkFull = !!pool && pool.used >= pool.capacity
  return (
    <>
      <SettingsRow>
        <SettingsLabel
          title={t('Reach from anywhere')}
          help={
            fixed
              ? t('Set when Ramu was started from the command line. Change it there.')
              : t(TUNNEL_HELP[tunnel.mode], { 0: status.port })
          }
        />
        <Dropdown
          label={t('Reach from anywhere')}
          value={tunnel.mode}
          disabled={fixed}
          options={TUNNEL_MODES.filter((mode) => status.tunnel || mode === 'off' || mode === 'manual').map((mode) => ({
            value: mode,
            label:
              mode === 'link' && linkFull && saved?.kind !== 'link'
                ? t('Ramu Link (full right now)')
                : t(TUNNEL_LABEL[mode]),
          }))}
          onChange={(mode) => onChange({ ...tunnel, mode: mode as TunnelMode })}
        />
      </SettingsRow>
      {tunnel.mode === 'ngrok' && (
        <SettingsRow>
          <SettingsLabel
            title={t('Static domain')}
            help={t('Optional. With your free ngrok static domain, the address stays the same.')}
          />
          <Input
            aria-label={t('Static domain')}
            spellCheck={false}
            placeholder="example.ngrok-free.app"
            value={tunnel.domain}
            onChange={(event) => onChange({ ...tunnel, domain: event.target.value })}
          />
        </SettingsRow>
      )}
      {tunnel.mode === 'link' && (showRelay || tunnel.relay) && (
        <SettingsRow>
          <SettingsLabel
            title={t('Your own relay')}
            help={t(
              'Optional. The address of a Ramu Link relay you run on your Cloudflare account. Leave empty for Ramu’s.',
            )}
          />
          <Input
            aria-label={t('Your own relay')}
            type="url"
            inputMode="url"
            spellCheck={false}
            placeholder="https://link.example.com"
            value={tunnel.relay}
            onChange={(event) => onChange({ ...tunnel, relay: event.target.value })}
          />
        </SettingsRow>
      )}
      {tunnel.mode === 'manual' && (
        <SettingsRow>
          <SettingsLabel
            title={t('Tunnel address')}
            help={status.enabled ? undefined : t('Choose This network or Anywhere first.')}
          />
          <Input
            aria-label={t('Tunnel address')}
            type="url"
            inputMode="url"
            spellCheck={false}
            placeholder="https://ramu.example.com"
            value={tunnel.url}
            disabled={fixed}
            onChange={(event) => onChange({ ...tunnel, url: event.target.value })}
          />
        </SettingsRow>
      )}
    </>
  )
}
