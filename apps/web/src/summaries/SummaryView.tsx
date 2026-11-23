import { Button } from '@/components/desktop-button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ArrowUpRight, Brain, MessageSquare, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Components } from 'react-markdown'
import { DateTime } from 'luxon'
import type { LibrarySummary } from '@ramu/shared/types'
import { chatMarkdownComponents } from '../chat/ChatMarkdown'
import { MarkdownText } from '../chat/MarkdownText'
import { Composer } from '../composer/Composer'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'
import { bridge } from '../ipc'
import { useModelSets } from '../models/ModelSets'
import { useWorkspaceOf } from '../workspace/workspace'
import { ownHostId } from '../hosts'
import { useHostSelection } from '../workspace/HostSelection'
import { focusLibraryItem } from './libraryFocus'
import { closeSummary, type SummaryCall } from './openSummary'
import { CHANGE_LABELS, DISMISS_LABEL, groupItems } from './summaryLogic'

/** A summary, its linked items, and at the bottom a message box that starts a review chat about it. Read-only itself. */
/** A summary names what was learned; its links lead nowhere on this screen, so they read as plain words. */
const SUMMARY_COMPONENTS: Components = { ...chatMarkdownComponents, a: ({ children }) => <span>{children}</span> }

export function SummaryView({ id, call, host }: { id: string; call: SummaryCall; host: string }) {
  useLanguage()
  const { select } = useHostSelection()
  const ws = useWorkspaceOf(host)
  const { initialSettings } = useModelSets()
  const [summary, setSummary] = useState<LibrarySummary | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(
    (method: 'summaries.read' | 'summaries.get') =>
      method === 'summaries.read'
        ? call('summaries.read', id).then(setSummary)
        : call('summaries.get').then((snapshot) =>
            setSummary(snapshot.summaries.find((entry) => entry.id === id) ?? null),
          ),
    [call, id],
  )
  useEffect(() => {
    void load('summaries.read').catch((reason) => setError(errorText(reason)))
    return bridge.on('summaries:changed', (_, from) => {
      if ((from ?? ownHostId()) !== host) return
      void load('summaries.get').catch(() => {})
    })
  }, [load, host])
  const send = async () => {
    const message = text.trim()
    if (!message || busy) return
    setBusy(true)
    setError(null)
    try {
      const started = await call('summaries.discuss', id, message, initialSettings)
      closeSummary()
      select(host, { kind: 'task', taskId: started.taskId, sessionId: started.sessionId })
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const dismiss = async () => {
    setBusy(true)
    try {
      await call('summaries.dismiss', id)
      closeSummary()
    } catch (reason) {
      setError(errorText(reason))
      setBusy(false)
    }
  }
  const period = summary
    ? `${DateTime.fromMillis(summary.periodStart).toLocaleString(DateTime.DATE_MED)} – ${DateTime.fromMillis(summary.periodEnd).toLocaleString(DateTime.DATE_MED)}`
    : ''
  return (
    <Dialog open onOpenChange={(open) => !open && closeSummary()}>
      <DialogContent
        className="summary-view flex max-h-[calc(100vh-48px)] w-[min(680px,calc(100vw-48px))] sm:max-w-none flex-col gap-0 p-0 sm:max-w-none"
        showCloseButton
      >
        <header className="flex-none p-[18px_20px_8px]">
          <DialogTitle className="text-heading font-semibold tracking-[-0.01em]">{t('What Ramu learned')}</DialogTitle>
          <DialogDescription className="text-muted-foreground text-caption">{period}</DialogDescription>
        </header>
        <div className="summary-body min-h-0 flex-1 overflow-y-auto p-[4px_20px_12px]">
          {!summary && !error && <p className="muted text-muted-foreground">{t('Loading…')}</p>}
          {summary && (
            <>
              <MarkdownText components={SUMMARY_COMPONENTS}>{summary.text}</MarkdownText>
              {summary.changedByYou && (
                <p className="muted text-muted-foreground small text-caption mt-2">{summary.changedByYou}</p>
              )}
              {groupItems(summary.items).map((group) => (
                <section key={group.change} className="mt-4">
                  <h4 className="mb-1 text-caption font-medium text-muted-foreground">
                    {t(CHANGE_LABELS[group.change])}
                  </h4>
                  <ul className="flex flex-col">
                    {group.items.map((item) => (
                      <li key={`${item.kind}:${item.id}`}>
                        <Button
                          variant="tree"
                          className="summary-item h-7 min-h-7 w-full justify-start gap-2 px-2 text-left text-soft"
                          title={item.reason}
                          onClick={() => {
                            closeSummary()
                            focusLibraryItem(item)
                          }}
                        >
                          {item.kind === 'memory' ? <Brain size={13} /> : <Sparkles size={13} />}
                          <span className="min-w-0 flex-1 truncate">{item.title}</span>
                          {item.worthALook && (
                            <span className="flex-none text-caption text-warn">{t('Worth a look')}</span>
                          )}
                          <ArrowUpRight size={12} className="flex-none text-muted-foreground" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {summary.chatIds.length > 0 && (
                <section className="mt-4">
                  <h4 className="mb-1 text-caption font-medium text-muted-foreground">{t('Discussed in thread')}</h4>
                  {summary.chatIds.map((chatId) => {
                    const task = ws?.tasks.find((entry) => entry.id === chatId)
                    return task ? (
                      <Button
                        key={chatId}
                        variant="tree"
                        className="h-7 min-h-7 w-full justify-start gap-2 px-2 text-left text-soft"
                        onClick={() => {
                          closeSummary()
                          select(host, { kind: 'task', taskId: chatId })
                        }}
                      >
                        <MessageSquare size={13} />
                        <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      </Button>
                    ) : null
                  })}
                </section>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="error text-bad small text-caption mt-2">
              {error}
            </p>
          )}
        </div>
        {summary && (
          <div className="summary-composer flex-none border-t border-line p-3">
            <Composer
              value={text}
              onChange={setText}
              onSubmit={() => send()}
              disabled={busy}
              placeholder={t('Ask about these changes, or tell Ramu what to fix')}
              submitLabel="Start review thread"
              actions={
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void dismiss()}>
                  {t(DISMISS_LABEL)}
                </Button>
              }
            />
            <p className="muted text-muted-foreground small text-caption mt-1.5 px-1">
              {t(
                '{0} when nothing needs changing. A review thread can edit memories and skills, and everything stays restorable.',
                { 0: t(DISMISS_LABEL) },
              )}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
