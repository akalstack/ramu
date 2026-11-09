import { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronRight, CircleAlert, EyeOff, Settings, WifiOff } from 'lucide-react-native'
import { forgeBrand } from '@ramu/shared/brands'
import { FORGE_NAMES } from '@ramu/shared/pullRequests'
import {
  accessGroupTitle,
  accessGroups,
  forgeUnavailableKey,
  type AccessGroup,
  type AccessRepo,
} from '@ramu/shared/pullRequestAccess'
import { font, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { BrandIcon } from './Logos'
import { HIDDEN_ACCESS_KEY, hiddenAccess, pullRequestRepoLabel } from '../runtime/pullRequestList'
import { Button, Card, Divider, Row, Sheet, T } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'

/**
 * Why some pull requests are missing from the list, above it and out of its way: one line per host that is offline
 * (its rows are the last ones this phone read) or failed, and one per host and hosting service that needs a sign-in or
 * could not be read, as the desktop folds them. A notice opens to the fix and can be hidden on this phone; hidden ones
 * fold into one line that shows them again.
 */
export function PullRequestListNotices({
  repos,
  offline,
  failed,
  manyHosts,
}: {
  /** Repositories that need access, each with its host. */
  repos: AccessRepo[]
  /** Hosts out of reach whose rows are what this phone last read. */
  offline: string[]
  /** Hosts in reach whose list could not be read, with why. */
  failed: Record<string, string>
  manyHosts: boolean
}) {
  const say = useSay()
  const { c } = useTheme()
  const router = useRouter()
  const store = useStore()
  const [opened, setOpened] = useState<string | null>(null)
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
  const current = groups.find((group) => group.key === opened)
  const failures = Object.entries(failed)
  if (!offline.length && !failures.length && !groups.length) return null
  const lines = [
    ...offline.map((host) => (
      <Row key={`offline:${host}`} style={{ minHeight: 44, paddingVertical: space.s }}>
        <WifiOff size={15} color={c.muted} />
        <T size={font.control} tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {manyHosts ? `${name(host)} · ${say('Offline · last known')}` : say('Offline · last known')}
        </T>
      </Row>
    )),
    ...failures.map(([host, text]) => (
      <Row key={`failed:${host}`} style={{ minHeight: 44, paddingVertical: space.s, alignItems: 'flex-start' }}>
        <CircleAlert size={15} color={c.bad} style={{ marginTop: 2 }} />
        <T size={font.control} tone="bad" numberOfLines={2} style={{ flex: 1 }}>
          {manyHosts ? `${name(host)}: ${say(text)}` : say(text)}
        </T>
      </Row>
    )),
    ...shown.map((group) => (
      <Row
        key={group.key}
        accessibilityRole="button"
        accessibilityLabel={title(group)}
        onPress={() => setOpened(group.key)}
        style={{ minHeight: 52, paddingVertical: space.s }}
      >
        <BrandIcon brand={forgeBrand(group.service)} size={15} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <T size={font.control} weight="500" tone={group.problem === 'error' ? 'bad' : 'text'} numberOfLines={1}>
            {title(group)}
          </T>
          <T size={font.caption} tone="muted" numberOfLines={1}>
            {[manyHosts ? say('On {0}', { 0: name(group.host) }) : '', group.repos.map(pullRequestRepoLabel).join(', ')]
              .filter(Boolean)
              .join(' · ')}
          </T>
        </View>
        <ChevronRight size={16} color={c.muted} />
      </Row>
    )),
  ]
  return (
    <View style={{ paddingHorizontal: space.l, paddingBottom: space.m, gap: space.xs }}>
      {lines.length ? (
        <Card>
          {lines.map((line, index) => (
            <View key={line.key}>
              {index ? <Divider inset={space.l} /> : null}
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
              {current.problem !== 'error' ? (
                <T size={font.control} tone="soft">
                  {say(forgeUnavailableKey(current.problem, current.service))}
                </T>
              ) : null}
              <Card>
                {current.repos.map((repo, index) => (
                  <View key={`${repo.host}:${repo.repoId}`}>
                    {index ? <Divider inset={space.l} /> : null}
                    <View style={{ paddingHorizontal: space.l, paddingVertical: space.m, gap: 2 }}>
                      <T size={font.control} weight="500">
                        {pullRequestRepoLabel(repo)}
                      </T>
                      {repo.error ? (
                        <T size={font.caption} tone="bad">
                          {say(repo.error)}
                        </T>
                      ) : null}
                    </View>
                  </View>
                ))}
              </Card>
            </View>
            <SheetGroup>
              {/* Settings edit the selected host, so the shortcut is offered only for its own repositories. */}
              {current.problem !== 'error' && current.service !== 'gitlab' && current.host === store.selected ? (
                <SheetOption
                  icon={Settings}
                  title={say('Open settings')}
                  help={say('Settings → Git')}
                  onPress={() => {
                    setOpened(null)
                    setTimeout(() => router.push({ pathname: '/settings/[section]', params: { section: 'git' } }), 300)
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
