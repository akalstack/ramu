import { useEffect, useState } from 'react'
import type { DnsRecord, DomainStatus } from '@ramu/shared/types'
import { domainState } from '@ramu/shared/deployText'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { t, useLanguage } from '../../i18n'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'

/** One record as a person would follow it at their domain provider. */
function recordInstruction(record: DnsRecord): string {
  if (record.type === 'TXT')
    return t('At your domain provider, add a TXT record named {0} with the value {1}.', {
      0: record.name,
      1: record.value,
    })
  if (record.name === '@')
    return t('At your domain provider, add an {0} record for {1} itself (named @) pointing to {2}.', {
      0: record.type,
      1: record.host,
      2: record.value,
    })
  return t('At your domain provider, add a {0} record named {1} pointing to {2}.', {
    0: record.type,
    1: record.name,
    2: record.value,
  })
}

/**
 * The Deploy sheet's custom domains: adding one, the DNS records it needs in plain words, and Create records when its
 * DNS is at the platform. Confirming Create records is the person's approval for the DNS change.
 */
export function DomainsSection({ projectId, platform }: { projectId: string; platform: string }) {
  useLanguage()
  const host = useHost()
  const [domains, setDomains] = useState<DomainStatus[] | null>(null)
  const [name, setName] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  // A Cloudflare token pasted for one domain's records; it goes to the host for that action and is not kept.
  const [cloudflareFor, setCloudflareFor] = useState<string | null>(null)
  const [cloudflareToken, setCloudflareToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    host.invoke('deploy.domains', projectId).then(
      (value) => current && setDomains(value),
      (reason) => current && setError(errorText(reason)),
    )
    return () => {
      current = false
    }
  }, [host, projectId])
  const run = async (work: () => Promise<DomainStatus>) => {
    setBusy(true)
    setError(null)
    try {
      const changed = await work()
      setDomains((list) => [...(list ?? []).filter((entry) => entry.name !== changed.name), changed])
      return true
    } catch (reason) {
      setError(errorText(reason))
      return false
    } finally {
      setBusy(false)
    }
  }
  const add = async () => {
    if (await run(() => host.invoke('deploy.addDomain', projectId, name))) setName('')
  }
  return (
    <section aria-label={t('Domains')} className="mt-3 flex flex-col gap-2 border-t border-(--line) pt-3">
      <strong>{t('Domains')}</strong>
      {!domains && !error && <p className="text-caption text-muted-foreground">{t('Checking…')}</p>}
      {domains?.map((domain) => (
        <div key={domain.name} className="flex flex-col gap-1 text-caption">
          <span className="flex items-center gap-2">
            <strong className="text-foreground">{domain.name}</strong>
            <span className="text-muted-foreground">{domainState(domain, t)}</span>
          </span>
          {!domain.configured && (
            <>
              <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4">
                {domain.records.map((record) => (
                  <li key={`${record.type}:${record.host}`} className="break-all">
                    {recordInstruction(record)}
                  </li>
                ))}
              </ul>
              {domain.managedDns &&
                (confirming === domain.name ? (
                  <span className="flex flex-wrap items-center gap-2" role="status">
                    {t('Ramu creates these records in {0} DNS, which changes where {1} points.', {
                      0: platform,
                      1: domain.name,
                    })}
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() => host.invoke('deploy.createRecords', projectId, domain.name)).then(() =>
                          setConfirming(null),
                        )
                      }
                    >
                      {t('Create records')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      {t('Cancel')}
                    </Button>
                  </span>
                ) : (
                  <span>
                    <Button size="sm" variant="secondary" onClick={() => setConfirming(domain.name)}>
                      {t('Create records')}
                    </Button>
                  </span>
                ))}
              {!domain.managedDns &&
                (cloudflareFor === domain.name ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void run(() =>
                        host.invoke('deploy.createCloudflareRecords', projectId, domain.name, cloudflareToken.trim()),
                      ).then((done) => {
                        if (!done) return
                        setCloudflareFor(null)
                        setCloudflareToken('')
                      })
                    }}
                  >
                    <Input
                      type="password"
                      autoComplete="off"
                      className="min-w-48 flex-1"
                      aria-label={t('Cloudflare token with DNS edit, used once')}
                      placeholder={t('Cloudflare token with DNS edit, used once')}
                      value={cloudflareToken}
                      onChange={(event) => setCloudflareToken(event.target.value)}
                    />
                    <Button type="submit" size="sm" disabled={busy || cloudflareToken.trim().length < 20}>
                      {t('Create records')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setCloudflareFor(null)}>
                      {t('Cancel')}
                    </Button>
                  </form>
                ) : (
                  <span>
                    <Button size="sm" variant="ghost" onClick={() => setCloudflareFor(domain.name)}>
                      {t('DNS at Cloudflare? Create them there…')}
                    </Button>
                  </span>
                ))}
              <span className="text-muted-foreground">
                {t(
                  'DNS changes can take up to a day to spread. Ramu checks every minute and tells the project’s thread when it is live.',
                )}
              </span>
            </>
          )}
        </div>
      ))}
      <span className="flex items-center gap-2">
        <Input
          aria-label={t('Domain name')}
          placeholder="www.example.com"
          value={name}
          maxLength={260}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !name.trim() || busy) return
            event.preventDefault()
            void add()
          }}
        />
        <Button size="sm" variant="secondary" disabled={!name.trim() || busy} onClick={() => void add()}>
          {t('Add domain')}
        </Button>
      </span>
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
