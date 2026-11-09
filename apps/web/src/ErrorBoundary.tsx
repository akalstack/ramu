import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { Check, ChevronDown, Copy, RotateCw, TriangleAlert } from 'lucide-react'
import { t } from './i18n'
import { Button } from '@/components/desktop-button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

interface Props {
  children: ReactNode
  /** Where the failure happened, so a crash in one pane says what is affected and leaves the rest of the app usable. */
  scope?: 'app' | 'view'
  /** Changing this clears a previous failure, e.g. when a different file or chat is shown. */
  resetKey?: string
}
interface State {
  error: Error | null
  key: string | undefined
}

/** A render error in one view must not blank the whole window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Ramu view crashed: ${error.message}`, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return <CrashScreen error={error} app={this.props.scope === 'app'} onRetry={() => this.setState({ error: null })} />
  }
}

/**
 * What a crash shows: what is affected and that work is safe, one way back, and the technical detail folded away with a
 * copy for a bug report. The whole window reloads; a single view tries again in place, leaving the rest of Ramu as is.
 */
function CrashScreen({ error, app, onRetry }: { error: Error; app: boolean; onRetry: () => void }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const report = [error.message, error.stack?.split('\n').slice(1).join('\n')].filter(Boolean).join('\n')
  const copy = () =>
    void navigator.clipboard.writeText(report).then(
      () => setCopied(true),
      () => setOpen(true),
    )
  return (
    <div
      role="alert"
      className={`error-boundary flex ${app ? 'h-screen w-screen bg-background text-foreground' : 'size-full min-h-0 min-w-0'}`}
    >
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle className="text-heading font-semibold">{t('Something went wrong')}</EmptyTitle>
          <EmptyDescription className="text-control">
            {app
              ? t('Ramu hit an unexpected error. Your threads and files are safe.')
              : t('Something went wrong in this view. The rest of Ramu still works.')}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-2">
            {app ? (
              <Button onClick={() => window.location.reload()}>
                <RotateCw aria-hidden="true" />
                {t('Reload')}
              </Button>
            ) : (
              <Button onClick={onRetry}>
                <RotateCw aria-hidden="true" />
                {t('Try again')}
              </Button>
            )}
            <Button variant="ghost" onClick={copy}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? t('Copied') : t('Copy details')}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-caption text-muted-foreground"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? t('Hide details') : t('Show details')}
            <ChevronDown aria-hidden="true" className={open ? 'rotate-180' : undefined} />
          </Button>
          {open && (
            <pre className="m-0 max-h-48 w-full overflow-auto rounded-(--radius-s) bg-fill p-3 text-left font-mono text-caption whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere] select-text">
              {report.slice(0, 4000)}
            </pre>
          )}
        </EmptyContent>
      </Empty>
    </div>
  )
}
