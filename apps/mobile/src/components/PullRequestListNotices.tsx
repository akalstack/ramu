import { useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronRight, CircleAlert, EyeOff, RefreshCcw, Settings, WifiOff, type LucideIcon } from 'lucide-react-native'
import { forgeBrand } from '@ramu/shared/brands'
import { FORGE_NAMES } from '@ramu/shared/pullRequests'
import {
  accessGroupTitle,
  accessGroups,
  forgeUnavailableKey,
  groupReadFailure,
  readFailureKey,
  type AccessGroup,
  type AccessRepo,
} from '@ramu/shared/pullRequestAccess'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { BrandIcon } from './Logos'
import { HIDDEN_ACCESS_KEY, hiddenAccess, pullRequestRepoLabel } from '../runtime/pullRequestList'
import { Button, Card, Chip, Divider, Sheet, T } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'

type Tone = 'muted' | 'warn' | 'text'

/**
 * One notice: what is wrong in plain words, what it means, the service's own message underneath, and the one thing to
 * do about it. The action is a sibling of the row, which opens the details.
 */
function NoticeLine({
  icon,
  tone,
  title,
  detail,
  raw,
  action,
  onPress,
}: {
  icon: ReactNode
  tone: Tone
  title: string
  detail?: string
  raw?: string
  action?: { label: string; icon: LucideIcon; onPress: () => void } | null
  onPress?: () => void
}) {
  const { c } = useTheme()
  const wash = { muted: c.fill, warn: c.warnWash, text: c.fill }[tone]
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: space.m }}>
      <Pressable
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={[title, detail].filter(Boolean).join('. ')}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: space.m,
          paddingLeft: space.l,
          paddingRight: space.s,
          paddingVertical: space.m,
          backgroundColor: pressed && onPress ? c.pressed : 'transparent',
        })}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: wash,
          }}
        >
          {icon}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={font.control} weight="600" tone={tone === 'warn' ? 'warn' : 'text'} numberOfLines={2}>
            {title}
          </T>
          {detail ? (
            <T size={font.caption} tone="soft" numberOfLines={3}>
              {detail}
            </T>
          ) : null}
          {raw ? (
            <T size={font.caption} tone="muted" mono numberOfLines={1}>
              {raw}
            </T>
          ) : null}
        </View>
        {onPress && !action ? <ChevronRight size={16} color={c.muted} style={{ marginTop: 6 }} /> : null}
      </Pressable>
      {action ? <Chip small fill icon={action.icon} label={action.label} onPress={action.onPress} /> : null}
    </View>
  )
}

/**
 * Why some pull requests are missing from the list, above it and out of its way: one line per host that is offline
 * (its rows are the last ones this phone read) or failed, and one per host and hosting service that needs a sign-in or
 * could not be read, as the desktop folds them. Each says what it means and offers its fix (connect, try again) in
 * place; a notice opens to its details and can be hidden on this phone, and hidden ones fold into one line.
 */
export function PullRequestListNotices({
  repos,
  offline,
  failed,
  manyHosts,
  onRetry,
}: {
  /** Repositories that need access, each with its host. */
  repos: AccessRepo[]
  /** Hosts out of reach whose rows are what this phone last read. */
  offline: string[]
  /** Hosts in reach whose list could not be read, with why. */
  failed: Record<string, string>
  manyHosts: boolean
  /** Reads a host's pull requests again, past what it kept. */
  onRetry: (host: string) => Promise<void>
}) {
  const say = useSay()
  const { c } = useTheme()
  const router = useRouter()
  const store = useStore()
  const [opened, setOpened] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string[]>([])
  const hidden = hiddenAccess(store.drafts[HIDDEN_ACCESS_KEY])
  const save = (next: string[]) => store.setDraft(HIDDEN_ACCESS_KEY, next.length ? JSON.stringify(next) : '')
  const name = (host: string) => store.computers.find((pc) => pc.id === host)?.name ?? host
  const groups = accessGroups(repos)
  const shown = groups.filter((group) => !hidden.includes(group.key))
  const folded = groups.filter((group) => hidden.includes(group.key))
  const foldedRepos = folded.reduce((sum, group) => sum + group.repos.length, 0)
  const title = (group: AccessGroup) => {
    const [text, values] = accessGroupTitle(group, pullRequestRepoLabel, (service) => FORGE_NAMES[service])
    return say(text, values)
  }
  const errorsOf = (group: AccessGroup) => group.repos.flatMap((repo) => (repo.error ? [repo.error] : []))
  const failure = (group: AccessGroup) => groupReadFailure(errorsOf(group))
  /** What a group means in plain words: why the service could not be read, or how to connect it. */
  const meaning = (group: AccessGroup) =>
    group.problem === 'error'
      ? say(readFailureKey(failure(group)), { 0: FORGE_NAMES[group.service] })
      : say(forgeUnavailableKey(group.problem, group.service))
  /** The service's own message, when every repository in the group gave the same one. */
  const rawOf = (group: AccessGroup) => {
    const distinct = [...new Set(errorsOf(group))]
    return distinct.length === 1 ? say(distinct[0]!) : undefined
  }
  const retry = (host: string) => {
    if (retrying.includes(host)) return
    setRetrying((all) => [...all, host])
    void onRetry(host).finally(() => setRetrying((all) => all.filter((entry) => entry !== host)))
  }
  const retryAction = (host: string) => ({
    label: retrying.includes(host) ? say('Retrying…') : say('Try again'),
    icon: RefreshCcw,
    onPress: () => retry(host),
  })
  // Hosting accounts live in that host's Settings → Git; GitLab signs in on the host itself.
  const canConnect = (group: AccessGroup) =>
    group.service !== 'gitlab' && (group.problem !== 'error' || failure(group) === 'signed-out')
  const connect = (host: string) => {
    if (store.selected !== host) store.select(host)
    router.push({ pathname: '/settings/[section]', params: { section: 'git' } })
  }
  const current = groups.find((group) => group.key === opened)
  const failures = Object.entries(failed)
  if (!offline.length && !failures.length && !groups.length) return null
  const lines = [
    ...offline.map((host) => (
      <NoticeLine
        key={`offline:${host}`}
        icon={<WifiOff size={14} color={c.muted} />}
        tone="muted"
        title={manyHosts ? say('{0} is offline', { 0: name(host) }) : say('Host is offline')}
        detail={say('Showing the pull requests this phone last read. They update when it is back.')}
      />
    )),
    ...failures.map(([host, text]) => (
      <NoticeLine
        key={`failed:${host}`}
        icon={<CircleAlert size={14} color={c.warn} />}
        tone="warn"
        title={
          manyHosts
            ? say('Could not load pull requests from {0}', { 0: name(host) })
            : say('Could not load pull requests')
        }
        raw={say(text)}
        action={retryAction(host)}
      />
    )),
    ...shown.map((group) => {
      const where = manyHosts ? say('On {0}', { 0: name(group.host) }) : ''
      return group.problem === 'error' ? (
        <NoticeLine
          key={group.key}
          icon={<CircleAlert size={14} color={c.warn} />}
          tone="warn"
          title={[title(group), where].filter(Boolean).join(' · ')}
          detail={meaning(group)}
          raw={rawOf(group)}
          action={
            canConnect(group)
              ? { label: say('Connect'), icon: Settings, onPress: () => connect(group.host) }
              : retryAction(group.host)
          }
          onPress={() => setOpened(group.key)}
        />
      ) : (
        <NoticeLine
          key={group.key}
          icon={<BrandIcon brand={forgeBrand(group.service)} size={14} />}
          tone="text"
          title={title(group)}
          detail={[where, group.repos.map(pullRequestRepoLabel).join(', ')].filter(Boolean).join(' · ')}
          action={
            canConnect(group)
              ? {
                  label: group.problem === 'choose-account' ? say('Choose account') : say('Connect'),
                  icon: Settings,
                  onPress: () => connect(group.host),
                }
              : null
          }
          onPress={() => setOpened(group.key)}
        />
      )
    }),
  ]
  return (
    <View style={{ paddingHorizontal: space.l, paddingBottom: space.m, gap: space.xs }}>
      {lines.length ? (
        <Card>
          {lines.map((line, index) => (
            <View key={line.key}>
              {index ? <Divider inset={space.l + 28 + space.m} /> : null}
              {line}
            </View>
          ))}
        </Card>
      ) : null}
      {folded.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingLeft: space.xs }}>
          <T size={font.caption} tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {say('{0} repositories that need access are hidden', { 0: foldedRepos })}
          </T>
          <Button
            kind="ghost"
            title={say('Show all')}
            onPress={() => save(hidden.filter((key) => !folded.some((group) => group.key === key)))}
          />
        </View>
      ) : null}
      <Sheet open={!!current} onClose={() => setOpened(null)} title={current ? title(current) : undefined}>
        {current ? (
          <>
            <View style={{ paddingHorizontal: space.l, gap: space.m }}>
              <T size={font.control} tone="soft">
                {meaning(current)}
              </T>
              <Card>
                {current.repos.map((repo, index) => (
                  <View key={`${repo.host}:${repo.repoId}`}>
                    {index ? <Divider inset={space.l} /> : null}
                    <View style={{ paddingHorizontal: space.l, paddingVertical: space.m, gap: 2 }}>
                      <T size={font.control} weight="500">
                        {pullRequestRepoLabel(repo)}
                      </T>
                      {repo.error ? (
                        <T size={font.caption} tone="muted" mono selectable>
                          {say(repo.error)}
                        </T>
                      ) : null}
                    </View>
                  </View>
                ))}
              </Card>
            </View>
            <SheetGroup>
              {canConnect(current) ? (
                <SheetOption
                  icon={Settings}
                  title={say('Open settings')}
                  help={manyHosts ? `${name(current.host)} · ${say('Settings → Git')}` : say('Settings → Git')}
                  onPress={() => {
                    const host = current.host
                    setOpened(null)
                    setTimeout(() => connect(host), 300)
                  }}
                />
              ) : null}
              {current.problem === 'error' ? (
                <SheetOption
                  icon={RefreshCcw}
                  title={retrying.includes(current.host) ? say('Retrying…') : say('Try again')}
                  onPress={() => {
                    retry(current.host)
                    setOpened(null)
                  }}
                />
              ) : null}
              <SheetOption
                icon={EyeOff}
                title={say('Hide this notice')}
                onPress={() => {
                  save([...hidden, current.key])
                  setOpened(null)
                }}
              />
            </SheetGroup>
          </>
        ) : null}
      </Sheet>
    </View>
  )
}
