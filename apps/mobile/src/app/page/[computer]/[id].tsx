import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Image, Share, TextInput, View, useWindowDimensions } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { MoreHorizontal } from 'lucide-react-native'
import {
  interactiveHtml,
  readInteractiveState,
  type InteractiveDocument,
  type InteractiveState,
} from '@ramu/shared/interactive'
import { interactiveThemeVariables } from '@ramu/shared/interactiveTheme'
import { declaredCapabilities, type PageInfo, type PageRun, type PageVersion } from '@ramu/shared/pages'
import { font, space, useTheme } from '../../../theme'
import { useStore } from '../../../runtime/store'
import { useSay } from '../../../i18n'
import { contentStorage } from '../../../storage'
import { Header, HeaderButton, Screen } from '../../../components/Screen'
import { Button, Card, Row, Sheet, T } from '../../../components/ui'
import InteractiveFrame from '../../../components/InteractiveFrame'
import {
  QUEUEABLE,
  pageCopy,
  pageLink,
  queueCall,
  queuedCalls,
  savePageCopy,
  syncCalls,
  type QueuedCall,
} from '../../../runtime/pages'

type FrameMessage = { ramuInteractive?: number; instance?: string; type?: string; value?: unknown; requestId?: string }
type Shared = { token: string; canAdd: boolean }

const reason = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(error)
/** A failure that means the host was not reached, so the call can wait; anything else is the host's answer. */
const unreachable = (error: unknown) =>
  /offline|not connected|unreachable|timed out|network|socket/i.test(reason(error))

/**
 * One page, full screen: the same frame and bridge as the desktop, loaded from the host by id so it works without its
 * thread. Records added without a connection wait on the phone and sync when the host answers.
 */
export default function PageScreen() {
  const params = useLocalSearchParams<{ computer: string; id: string; share?: string }>()
  const computerId = String(params.computer ?? '')
  const pageId = String(params.id ?? '')
  const shareToken = params.share ? String(params.share) : undefined
  const store = useStore()
  const say = useSay()
  const router = useRouter()
  const { c, scheme } = useTheme()
  const { height: screenHeight } = useWindowDimensions()
  const online = store.isOnline(computerId)
  const viewer = store.computers.find((x) => x.id === computerId)?.access === 'viewer'
  const [page, setPage] = useState<PageInfo | null>(null)
  const [shared, setShared] = useState<Shared | null>(null)
  const [document, setDocument] = useState<InteractiveDocument | null>(() =>
    pageCopy(contentStorage, computerId, pageId),
  )
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [messages, setMessages] = useState<{ id: number; data: object }[]>([])
  const [menu, setMenu] = useState(false)
  const [versions, setVersions] = useState<PageVersion[] | null>(null)
  const [running, setRunning] = useState<PageRun | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; text: string } | null>(null)
  const [picked, setPicked] = useState<{ selector: string; text: string; html: string } | null>(null)
  const [change, setChange] = useState('')
  const [about, setAbout] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<PageRun | null>(null)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [frameError, setFrameError] = useState('')
  const [generation, setGeneration] = useState(0)
  const state = useRef<InteractiveState | null>(null)
  const revision = useRef(0)
  const functions = useRef<{ name: string; description: string; input: Record<string, string> }[]>([])
  const follow = useRef(new Map<string, { requestId: string; stepRequestId?: string; shown: number }>())
  const waiting = useRef(new Map<string, string>())
  const nextMessage = useRef(0)
  const post = useCallback((data: object) => {
    nextMessage.current += 1
    const id = nextMessage.current
    setMessages((all) => [...all.slice(-40), { id, data }])
  }, [])
  const reply = useCallback(
    (requestId: string, value: unknown, failure?: string) =>
      post(failure ? { type: 'reply', requestId, error: failure } : { type: 'reply', requestId, value: value ?? null }),
    [post],
  )
  const load = useCallback(async () => {
    try {
      if (shareToken) {
        const opened = await store.invoke(computerId, 'pages.openShare', shareToken)
        setShared({ token: opened.share.token, canAdd: opened.share.canAdd })
        setPage({
          ...opened.page,
          pinned: false,
          projectId: null,
          createdAt: 0,
          changedAt: 0,
          sessionId: '',
          grants: {},
          pendingGrants: [],
        } as PageInfo)
        setDocument(opened.document)
        state.current = opened.state.state
        revision.current = opened.state.revision
      } else {
        const [info, current, values] = await Promise.all([
          store.invoke(computerId, 'pages.get', pageId),
          store.invoke(computerId, 'pages.document', pageId),
          store.invoke(computerId, 'pages.state', pageId),
        ])
        setPage(info)
        setDocument((before) => (before?.reference.version === current.reference.version && !saved ? before : current))
        savePageCopy(contentStorage, computerId, pageId, current)
        if (values.revision !== revision.current) {
          revision.current = values.revision
          state.current = values.state
        }
      }
      setSaved(false)
      setError('')
    } catch (failure) {
      if (pageCopy(contentStorage, computerId, pageId)) setSaved(true)
      setError(unreachable(failure) || !online ? say('Host unavailable. Reconnect to load content.') : reason(failure))
    }
  }, [store, computerId, pageId, shareToken, say, online, saved])
  useEffect(() => {
    void load()
  }, [load])
  // Calls queued offline go to the host as soon as it answers, in order; refused ones are shown, not dropped.
  useEffect(() => {
    if (!online || shareToken || !queuedCalls(contentStorage, computerId, pageId).length) return
    void syncCalls(
      contentStorage,
      computerId,
      pageId,
      (call) => store.invoke(computerId, 'pages.call', pageId, call.method, call.args),
      (failure) => !unreachable(failure),
    ).then(({ conflicts: refused, results }) => {
      if (refused.length) setConflicts(refused.map((entry) => entry.error))
      for (const [id, value] of results) {
        const requestId = waiting.current.get(id)
        if (requestId) reply(requestId, value)
        waiting.current.delete(id)
      }
      void load()
    })
  }, [online, shareToken, computerId, pageId, store, reply, load])
  useEffect(() => {
    if (!online) return
    return store.subscribe(computerId, (...[channel, payload]) => {
      if (channel !== 'pages:changed') return
      const event = payload as { pageId: string; run?: PageRun }
      if (event.pageId !== pageId) return
      const run = event.run
      if (!run) return void load()
      const followed = follow.current.get(run.id)
      if (!followed) return
      setRunning(run.status === 'running' ? run : null)
      for (const step of run.steps.slice(followed.shown))
        if (followed.stepRequestId) post({ type: 'run-step', value: step, requestId: followed.stepRequestId })
      followed.shown = run.steps.length
      if (run.call) post({ type: 'tool-call', value: run.call })
      setConfirm(run.confirm ?? null)
      if (run.status !== 'running') {
        follow.current.delete(run.id)
        setConfirm(null)
        reply(followed.requestId, {
          status: run.status,
          answer: run.answer ?? null,
          error: run.error ?? null,
          steps: run.steps,
          changes: run.changes,
          id: run.id,
        })
      }
    })
  }, [online, store, computerId, pageId, load, post, reply])
  const theme = useMemo(
    () =>
      interactiveThemeVariables({
        scheme,
        background: c.window,
        foreground: c.text,
        muted: c.muted,
        primary: c.accent,
        surface: c.raised2,
        surfaceRaised: c.bubble,
        codeBackground: c.code,
        button: c.primary,
        buttonForeground: c.primaryInk,
        success: c.ok,
        warning: c.warn,
        danger: c.bad,
      }),
    [c, scheme],
  )
  const instance = `page:${pageId}:${document?.reference.version ?? 0}:${generation}`
  const html = useMemo(
    () => (document ? interactiveHtml(document.html, instance, state.current, theme, document.reference.network) : ''),
    // The frame keeps its own state once loaded; a theme change reaches it as a message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [document, instance],
  )
  const startThread = async (prompt: string) => {
    try {
      const started = await store.invoke(computerId, 'pages.startThread', pageId, prompt)
      await store.refresh(computerId).catch(() => {})
      router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(computerId, started.taskId) } })
    } catch (failure) {
      Alert.alert(say('That didn’t work'), reason(failure))
    }
  }
  const call = (requestId: string, method: string, args: unknown[]) => {
    const send = () =>
      shared
        ? store.invoke(computerId, 'pages.shareCall', shared.token, method, args)
        : store.invoke(computerId, 'pages.call', pageId, method, args)
    const queue = () => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const entry: QueuedCall = { id, method, args, at: Date.now() }
      if (!queueCall(contentStorage, computerId, pageId, entry))
        return reply(requestId, null, say('The offline queue is full. Reconnect to the host.'))
      // A record shows at once as queued; a question waits for the host while this page stays open.
      if (method === 'ai.ask') waiting.current.set(id, requestId)
      else reply(requestId, { id: `queued-${id}`, collection: args[0], data: args[args.length - 1], queued: true })
    }
    if (!shared && QUEUEABLE.has(method) && !online) return queue()
    void send().then(
      (value) => reply(requestId, value),
      (failure) => {
        if (!shared && QUEUEABLE.has(method) && unreachable(failure)) queue()
        else reply(requestId, null, reason(failure))
      },
    )
  }
  const receive = (raw: unknown) => {
    const m = raw as FrameMessage
    if (!m || m.ramuInteractive !== 1 || m.instance !== instance) return
    if (m.type === 'tools' && Array.isArray(m.value)) functions.current = m.value.slice(0, 16)
    if (m.type === 'tool-result' && m.value && typeof m.value === 'object') {
      const result = m.value as { id: string; value?: unknown; error?: string }
      void store.invoke(computerId, 'pages.runReply', result.id, result.value ?? null, result.error).catch(() => {})
    }
    if (m.type === 'picked' && m.value && typeof m.value === 'object') setPicked(m.value as never)
    if (m.type === 'error') {
      const value = (typeof m.value === 'string' ? { message: m.value } : (m.value ?? {})) as {
        message?: string
        steps?: string[]
      }
      setFrameError(String(value.message ?? say('An interaction failed.')))
      if (!shared && online && document)
        void store
          .invoke(computerId, 'pages.reportError', pageId, {
            message: String(value.message ?? ''),
            version: document.reference.version,
            device: 'phone',
            steps: Array.isArray(value.steps) ? value.steps.map(String).slice(-20) : undefined,
          })
          .catch(() => {})
    }
    if (m.type === 'state' && !shared && online) {
      const next = readInteractiveState(m.value)
      if (next)
        void store.invoke(computerId, 'pages.saveState', pageId, next, revision.current).then(
          (result) => {
            revision.current = result.revision
            if (!result.accepted) post({ type: 'restore', value: result.state })
          },
          () => {},
        )
    }
    if (m.type !== 'call' || !m.requestId || !m.value || typeof m.value !== 'object') return
    const { method, args } = m.value as { method: string; args: unknown[] }
    const requestId = m.requestId
    if (method === 'ai.run' || method === 'ai.flow') {
      if (shared || !online) return reply(requestId, null, say('Runs need the host. Reconnect and try again.'))
      const options = (args[1] ?? {}) as { shape?: unknown; maxSteps?: number; runId?: string; name?: string }
      const start =
        method === 'ai.flow'
          ? store.invoke(computerId, 'pages.runFlow', pageId, String(args[0]), functions.current)
          : store.invoke(computerId, 'pages.runStart', pageId, String(args[0]), {
              shape: options.shape,
              maxSteps: options.maxSteps,
              name: options.name,
              functions: functions.current,
            })
      void start.then(
        (runId) =>
          runId
            ? follow.current.set(runId, { requestId, stepRequestId: options.runId, shown: 0 })
            : reply(requestId, null, say('The run did not start.')),
        (failure) => reply(requestId, null, reason(failure)),
      )
      return
    }
    if (method === 'thread.start') {
      if (shared) return reply(requestId, null, say('Threads cannot be started through a share link.'))
      const prompt = String(args[0] ?? '')
      Alert.alert(say('The page asks to start a thread'), prompt, [
        { text: say('Cancel'), style: 'cancel', onPress: () => reply(requestId, null) },
        { text: say('Start thread'), onPress: () => void startThread(prompt).then(() => reply(requestId, null)) },
      ])
      return
    }
    call(requestId, method, args)
  }
  const run = (name: string) =>
    void store.invoke(computerId, 'pages.runFlow', pageId, name, functions.current).then(
      (runId) => runId && follow.current.set(runId, { requestId: `toolbar-${runId}`, shown: 0 }),
      (failure) => Alert.alert(say('That didn’t work'), reason(failure)),
    )
  const ask = () =>
    void store
      .invoke(computerId, 'pages.ask', pageId, question.trim())
      .then(setAnswer, (failure) => Alert.alert(say('That didn’t work'), reason(failure)))
  const pending = !shared && !viewer && page ? page.pendingGrants : []
  const runs = Object.entries(page?.capabilities.runs ?? {})
  const records = !!page?.capabilities.records && !!page.grants.records && !!page.grants.ai
  const answerValue = (answer?.answer ?? {}) as { text?: string; rows?: { label?: unknown; value?: unknown }[] }
  return (
    <Screen>
      <Header
        title={page ? `${page.icon} ${page.title}` : say('Pages')}
        subtitle={
          saved
            ? say('Saved copy · reconnect to see the current version')
            : document
              ? `v${document.reference.version}`
              : undefined
        }
        right={<HeaderButton icon={MoreHorizontal} label={say('Page actions')} onPress={() => setMenu(true)} />}
      />
      <View style={{ flex: 1 }}>
        {error && !document ? (
          <T tone="muted" style={{ padding: space.l }}>
            {error}
          </T>
        ) : null}
        {page?.lastError && !shared ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              paddingHorizontal: space.l,
              paddingVertical: space.s,
              backgroundColor: c.fill,
            }}
          >
            <T size={font.caption} style={{ flex: 1 }} numberOfLines={2}>
              {say('This page hit an error: {message}', { message: page.lastError.message })}
            </T>
            {!viewer ? (
              <Button
                kind="secondary"
                title={say('Fix this')}
                onPress={() => {
                  const failure = page.lastError!
                  void startThread(
                    `Fix this error in my page. Reproduce it with preview_interactive, then publish the fixed version with publish_interactive {page: "${page.id}", changes}.\nError on ${failure.device ?? 'a device'} in v${failure.version}: ${failure.message}${failure.steps?.length ? `\nWhat the person did before it: ${failure.steps.join(' → ')}` : ''}`,
                  ).then(() => store.invoke(computerId, 'pages.clearError', pageId))
                }}
              />
            ) : null}
          </View>
        ) : null}
        {conflicts.length ? (
          <View style={{ paddingHorizontal: space.l, paddingVertical: space.s, backgroundColor: c.badWash }}>
            <T size={font.caption}>{say('Some changes made offline were not saved:')}</T>
            {conflicts.map((conflict, index) => (
              <T key={index} size={font.caption} tone="muted">
                {conflict}
              </T>
            ))}
            <Button kind="ghost" title={say('Dismiss')} onPress={() => setConflicts([])} />
          </View>
        ) : null}
        {running ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              paddingHorizontal: space.l,
              paddingVertical: space.s,
            }}
          >
            <T size={font.caption} tone="muted" style={{ flex: 1 }} numberOfLines={2}>
              {running.steps.at(-1)?.text ?? running.task}
            </T>
            <Button
              kind="secondary"
              title={say('Stop')}
              onPress={() => void store.invoke(computerId, 'pages.runStop', running.id)}
            />
          </View>
        ) : null}
        {confirm ? (
          <View style={{ gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s, backgroundColor: c.fill }}>
            <T>{confirm.text}</T>
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Button
                kind="secondary"
                title={say('Keep them')}
                onPress={() => {
                  setConfirm(null)
                  void store.invoke(computerId, 'pages.runConfirm', confirm.id, false)
                }}
              />
              <Button
                kind="danger"
                title={say('Allow')}
                onPress={() => {
                  setConfirm(null)
                  void store.invoke(computerId, 'pages.runConfirm', confirm.id, true)
                }}
              />
            </View>
          </View>
        ) : null}
        {picked ? (
          <View style={{ gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s }}>
            <T size={font.caption} tone="muted" numberOfLines={1}>
              {picked.text || picked.selector}
            </T>
            <TextInput
              autoFocus
              accessibilityLabel={say('What should change here?')}
              placeholder={say('What should change here?')}
              placeholderTextColor={c.muted}
              value={change}
              onChangeText={setChange}
              style={{ minHeight: 44, padding: space.m, borderRadius: 10, backgroundColor: c.fill, color: c.text }}
            />
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Button kind="ghost" title={say('Cancel')} onPress={() => setPicked(null)} />
              <Button
                title={say('Ask')}
                disabled={!change.trim()}
                onPress={() => {
                  void startThread(
                    `${change.trim()}\nChange only this element of the page (the person pointed at it): ${picked.selector}\nIts text: ${JSON.stringify(picked.text)}\nIts HTML: ${picked.html}`,
                  )
                  setPicked(null)
                  setChange('')
                }}
              />
            </View>
          </View>
        ) : null}
        {about !== null ? (
          <View style={{ gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s }}>
            <TextInput
              autoFocus
              multiline
              accessibilityLabel={say('Ask about this page')}
              placeholder={say('Ask about this page')}
              placeholderTextColor={c.muted}
              value={about}
              onChangeText={setAbout}
              style={{ minHeight: 64, padding: space.m, borderRadius: 10, backgroundColor: c.fill, color: c.text }}
            />
            <T size={font.caption} tone="muted">
              {say('A new thread starts with this page attached. It works with its usual access and approvals.')}
            </T>
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Button kind="ghost" title={say('Cancel')} onPress={() => setAbout(null)} />
              <Button
                title={say('Start thread')}
                disabled={!about.trim()}
                onPress={() => {
                  void startThread(about.trim())
                  setAbout(null)
                }}
              />
            </View>
          </View>
        ) : null}
        {records && online ? (
          <View style={{ flexDirection: 'row', gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s }}>
            <TextInput
              accessibilityLabel={say('Ask this page')}
              placeholder={say('Ask this page, such as “how much on food in March?”')}
              placeholderTextColor={c.muted}
              value={question}
              onChangeText={setQuestion}
              onSubmitEditing={ask}
              returnKeyType="send"
              style={{
                flex: 1,
                minHeight: 40,
                paddingHorizontal: space.m,
                borderRadius: 10,
                backgroundColor: c.fill,
                color: c.text,
              }}
            />
          </View>
        ) : null}
        {answer ? (
          <View style={{ gap: 4, paddingHorizontal: space.l, paddingBottom: space.s }}>
            <T>{answer.status === 'done' ? (answerValue.text ?? '') : (answer.error ?? say('No answer.'))}</T>
            {(Array.isArray(answerValue.rows) ? answerValue.rows : []).slice(0, 8).map((row, index) =>
              typeof row?.value === 'number' ? (
                <T key={index} size={font.caption} tone="muted">
                  {String(row.label ?? '')}: {row.value.toLocaleString()}
                </T>
              ) : null,
            )}
            <View style={{ flexDirection: 'row', gap: space.s }}>
              {answer.status === 'done' ? (
                <Button
                  kind="secondary"
                  title={say('Keep as a panel')}
                  onPress={() =>
                    void startThread(
                      `Add a panel to my page that always shows the answer to "${question}" from its records (today it is: ${answerValue.text ?? ''}). Compute it with ramuContent.records, not a model call, and publish the new version.`,
                    )
                  }
                />
              ) : null}
              <Button kind="ghost" title={say('Close')} onPress={() => setAnswer(null)} />
            </View>
          </View>
        ) : null}
        {frameError ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l }}>
            <T size={font.caption} tone="muted" style={{ flex: 1 }}>
              {frameError}
            </T>
            <Button
              kind="ghost"
              title={say('Reload')}
              onPress={() => {
                setFrameError('')
                setGeneration((n) => n + 1)
              }}
            />
          </View>
        ) : null}
        {document ? (
          <InteractiveFrame
            html={html}
            title={page?.title ?? document.reference.title}
            instance={instance}
            height={Math.max(320, screenHeight - 140)}
            theme={theme}
            messages={messages}
            maxMessage={3_500_000}
            onMessage={receive}
            onStop={() => setFrameError(say('Content stopped. Reload to try again.'))}
          />
        ) : null}
      </View>
      <Sheet open={menu} onClose={() => setMenu(false)} title={page?.title ?? say('Pages')}>
        <View style={{ padding: space.l, gap: space.m }}>
          {runs.length && !shared ? (
            <Card>
              {runs.map(([name, declared]) => (
                <Row
                  key={name}
                  disabled={!online || !!running}
                  onPress={() => {
                    setMenu(false)
                    run(name)
                  }}
                >
                  <T>{declared.label}</T>
                </Row>
              ))}
            </Card>
          ) : null}
          <Card>
            {!shared && !viewer ? (
              <Row
                onPress={() => {
                  setMenu(false)
                  post({ type: 'pick', value: true })
                }}
              >
                <T>{say('Edit')}</T>
              </Row>
            ) : null}
            {!shared && !viewer ? (
              <Row
                onPress={() => {
                  setMenu(false)
                  setAbout('')
                }}
              >
                <T>{say('Ask about this')}</T>
              </Row>
            ) : null}
            {!shared ? (
              <Row
                onPress={() =>
                  void store.invoke(computerId, 'pages.versions', pageId).then(setVersions, () => setVersions([]))
                }
              >
                <T>{say('Versions')}</T>
              </Row>
            ) : null}
            <Row
              onPress={() => {
                setMenu(false)
                void Share.share({
                  title: page?.title,
                  message: `${page?.title ?? ''} ${pageLink({ computerId, pageId, ...(shared ? { share: shared.token } : {}) })}`,
                  url: pageLink({ computerId, pageId, ...(shared ? { share: shared.token } : {}) }),
                })
              }}
            >
              <T>{say('Add to Home Screen or share')}</T>
            </Row>
          </Card>
          {page && !shared && declaredCapabilities(page.capabilities).length ? (
            <T size={font.caption} tone="muted">
              {say('Change what this page may use in Page settings on the desktop.')}
            </T>
          ) : null}
          {versions?.map((version) => (
            <Card key={version.reference.version} style={{ padding: space.m, gap: space.s }}>
              {version.preview ? (
                <Image source={{ uri: version.preview }} resizeMode="contain" style={{ height: 160, width: '100%' }} />
              ) : null}
              <T weight="600">v{version.reference.version}</T>
              <T tone="muted">{version.reference.changes ?? version.reference.summary}</T>
              {version.reference.version !== page?.version && !viewer ? (
                <Button
                  kind="secondary"
                  title={say('Restore v{version}', { version: version.reference.version })}
                  onPress={() => {
                    setVersions(null)
                    setMenu(false)
                    void store
                      .invoke(computerId, 'pages.restoreVersion', pageId, version.reference.version)
                      .then(() => load())
                  }}
                />
              ) : null}
            </Card>
          ))}
        </View>
      </Sheet>
      {page && pending.length ? (
        <Sheet
          open
          onClose={() => void store.invoke(computerId, 'pages.grant', pageId, denyAll(page)).then(() => load())}
          title={say('{title} asks to', { title: page.title })}
        >
          <View style={{ padding: space.l, gap: space.m }}>
            {pending.map((name) => (
              <T key={name}>• {grantText(say, name, page)}</T>
            ))}
            <T size={font.caption} tone="muted">
              {say('The page never sees your keys or other pages. Change this later in Page settings.')}
            </T>
            <Button
              title={say('Allow')}
              onPress={() => void store.invoke(computerId, 'pages.grant', pageId, allowAll(page)).then(() => load())}
            />
            <Button
              kind="ghost"
              title={say('Not now')}
              onPress={() => void store.invoke(computerId, 'pages.grant', pageId, denyAll(page)).then(() => load())}
            />
          </View>
        </Sheet>
      ) : null}
    </Screen>
  )
}

function grantText(say: ReturnType<typeof useSay>, name: string, page: PageInfo): string {
  const c = page.capabilities
  switch (name) {
    case 'records':
      return say('Keeps records on this host: {list}', { list: Object.keys(c.records ?? {}).join(', ') })
    case 'ai':
      return say('Uses a model on this host: {purpose}. The model sees only what the page sends it.', {
        purpose: c.ai?.purpose ?? '',
      })
    case 'camera':
      return say('Uses photos you choose: {purpose}', { purpose: c.camera?.purpose ?? '' })
    case 'notify':
      return say('Sends notifications: {purpose}. Their text reaches your phone through its push service.', {
        purpose: c.notify?.purpose ?? '',
      })
    case 'webhook':
      return say('Accepts records from outside services into {collection}', { collection: c.webhook?.collection ?? '' })
    case 'folder':
      return say('Reads one project folder: {path}', { path: c.folder?.path ?? '' })
    case 'schedules':
      return say('Runs on its own: {list}', { list: (c.schedules ?? []).map((s) => s.run).join(', ') })
    default:
      return say('Acts when records match: {list}', {
        list: (c.triggers ?? []).map((t) => `${t.collection}.${t.when.field} ${t.when.op} ${t.when.value}`).join(', '),
      })
  }
}

function allowAll(page: PageInfo) {
  return Object.fromEntries(
    page.pendingGrants.map((name) => [
      name,
      name === 'ai'
        ? { model: page.capabilities.ai?.quality ?? 'fast', daily: page.capabilities.ai?.daily ?? 200 }
        : name === 'webhook'
          ? { token: '' }
          : true,
    ]),
  )
}

function denyAll(page: PageInfo) {
  return Object.fromEntries(page.pendingGrants.map((name) => [name, false]))
}
