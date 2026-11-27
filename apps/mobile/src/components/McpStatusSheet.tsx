import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, TextInput, View } from 'react-native'
import { mcpStatusLabel } from '@ramu/shared/mcp'
import type { AgentMcpStatus } from '@ramu/shared/types'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { Button, Card, Divider, Sheet, T } from './ui'

/**
 * A thread's MCP connections, for recovering on the go: what each one is doing, and Reconnect for one that failed or
 * needs signing in again, or Reload for all. Adding or configuring servers stays on the desktop.
 */
export function McpStatusSheet({
  open,
  onClose,
  computerId,
  sessionId,
  readOnly,
}: {
  open: boolean
  onClose: () => void
  computerId: string
  sessionId: string
  readOnly: boolean
}) {
  const say = useSay()
  const store = useStore()
  const { c } = useTheme()
  const [status, setStatus] = useState<AgentMcpStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef(store)
  latest.current = store
  const revision = useRef(0)
  const load = useCallback(
    async (action?: () => Promise<unknown>) => {
      const mine = ++revision.current
      setBusy(true)
      setError('')
      try {
        if (action) await action()
        const next = await latest.current.invoke(computerId, 'agent.mcpStatus', sessionId)
        if (mine === revision.current) setStatus(next)
      } catch (reason) {
        if (mine === revision.current) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (mine === revision.current) setBusy(false)
      }
    },
    [computerId, sessionId],
  )
  useEffect(() => {
    if (open) void load()
  }, [open, load])
  // A sign-in under way. Its page opens in this phone's browser, which cannot return to the host by itself when the
  // provider waits on the host's own address, so the address it ended on is pasted here.
  const [signingIn, setSigningIn] = useState<{ name: string; paste: boolean } | null>(null)
  const [returned, setReturned] = useState('')
  const signIn = (name: string) =>
    load(async () => {
      const started = await latest.current.invoke(computerId, 'agent.signInMcp', sessionId, name)
      if (!started.authUrl) return
      setReturned('')
      setSigningIn({ name, paste: started.returnsToHost })
      await Linking.openURL(started.authUrl)
    })
  const signingName = signingIn?.name
  useEffect(() => {
    if (!signingName || !open) return
    const timer = setInterval(() => void load(), 3000)
    return () => clearInterval(timer)
  }, [signingName, open, load])
  useEffect(() => {
    if (signingName && status?.servers.some((server) => server.name === signingName && server.status === 'connected'))
      setSigningIn(null)
  }, [signingName, status])
  const tone = (value: string) =>
    value === 'connected' ? c.ok : value === 'failed' || value === 'needs-auth' ? c.bad : c.muted
  return (
    <Sheet open={open} onClose={onClose} title={say('MCP servers')}>
      <View style={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        {!status && busy ? <ActivityIndicator color={c.muted} /> : null}
        {error ? (
          <T size={font.caption} tone="bad">
            {error}
          </T>
        ) : null}
        {status && !status.supported ? (
          <T tone="muted">{say('This provider does not expose MCP connection status yet.')}</T>
        ) : null}
        {status?.supported ? (
          <>
            {status.source === 'configuration' ? (
              <T size={font.caption} tone="muted">
                {say('Showing workspace MCP configuration. This runtime does not expose live connection status.')}
              </T>
            ) : !status.live ? (
              <T size={font.caption} tone="muted">
                {say('Last reported status. Send a message to start or reconnect this thread.')}
              </T>
            ) : null}
            {status.servers.length ? (
              <Card>
                {status.servers.map((server, index) => (
                  <View key={server.name}>
                    {index ? <Divider inset={space.m} /> : null}
                    <View style={{ padding: space.m, gap: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone(server.status) }} />
                        <T weight="600" numberOfLines={1} style={{ flex: 1 }}>
                          {server.name}
                        </T>
                        <T size={font.caption} tone="muted">
                          {say(mcpStatusLabel(server.status))}
                        </T>
                      </View>
                      {server.toolCount !== undefined ? (
                        <T size={font.caption} tone="muted">
                          {say('{0} tools', { 0: server.toolCount })}
                        </T>
                      ) : null}
                      {server.error ? (
                        <T size={font.caption} tone="bad" numberOfLines={3}>
                          {server.error}
                        </T>
                      ) : null}
                      {server.status === 'needs-auth' && signingName !== server.name ? (
                        <T size={font.caption} tone="muted">
                          {status.live && status.canAuthenticate
                            ? say('Sign in opens the server’s page in your browser.')
                            : say('Authenticate this server in your provider, then refresh.')}
                        </T>
                      ) : null}
                      {signingIn && signingName === server.name ? (
                        <View style={{ gap: space.s }}>
                          <T size={font.caption} tone="muted">
                            {signingIn.paste
                              ? say('After you allow access, copy the address your browser ended on and paste it here.')
                              : say('Finish signing in in your browser. This updates when it is done.')}
                          </T>
                          {signingIn.paste ? (
                            <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
                              <TextInput
                                value={returned}
                                onChangeText={setReturned}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="url"
                                accessibilityLabel={say('Address your browser ended on')}
                                placeholder="http://localhost:…"
                                placeholderTextColor={c.placeholder}
                                style={{
                                  flex: 1,
                                  color: c.text,
                                  fontSize: font.body,
                                  padding: space.m,
                                  borderRadius: radius.m,
                                  backgroundColor: c.raised2,
                                }}
                              />
                              <Button
                                title={say('Finish')}
                                disabled={busy || !returned.trim()}
                                onPress={() =>
                                  void load(async () => {
                                    await latest.current.invoke(
                                      computerId,
                                      'agent.finishMcpSignIn',
                                      sessionId,
                                      server.name,
                                      returned.trim(),
                                    )
                                    setSigningIn(null)
                                  })
                                }
                              />
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                      {status.live && status.canAuthenticate && !readOnly && server.status === 'needs-auth' ? (
                        <View style={{ flexDirection: 'row' }}>
                          <Button
                            kind="secondary"
                            title={say('Sign in')}
                            disabled={busy}
                            onPress={() => void signIn(server.name)}
                          />
                        </View>
                      ) : status.canReconnect &&
                        !readOnly &&
                        (server.status === 'failed' || server.status === 'needs-auth') ? (
                        <View style={{ flexDirection: 'row' }}>
                          <Button
                            kind="secondary"
                            title={say('Reconnect')}
                            disabled={busy}
                            onPress={() =>
                              void load(() =>
                                latest.current.invoke(computerId, 'agent.reconnectMcp', sessionId, server.name),
                              )
                            }
                          />
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))}
              </Card>
            ) : (
              <T tone="muted">{say('No MCP servers reported yet. Start the thread, then refresh.')}</T>
            )}
          </>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space.s }}>
          {status?.canReload && !readOnly ? (
            <Button
              kind="secondary"
              title={say('Reload MCP servers')}
              disabled={busy}
              onPress={() => void load(() => latest.current.invoke(computerId, 'agent.reloadMcp', sessionId))}
            />
          ) : null}
          <Button kind="ghost" title={say('Refresh')} disabled={busy} onPress={() => void load()} />
        </View>
      </View>
    </Sheet>
  )
}
