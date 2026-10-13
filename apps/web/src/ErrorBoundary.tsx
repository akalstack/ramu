import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from './i18n'
import { Button } from '@/components/desktop-button'

interface Props {
  children: ReactNode
  /** Where the failure happened, so a crash in one pane says what is affected and leaves the rest of the app usable. */
  scope?: 'app' | 'view'
  /** Changing this clears a previous failure, e.g. when a different file or chat is shown. */
  resetKey?: string
}
interface State { error: Error | null; key: string | undefined }

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
    const app = this.props.scope === 'app'
    return (
      <div role="alert" className={`error-boundary flex flex-col items-center justify-center gap-3 p-8 text-center ${app ? 'h-screen w-screen bg-background text-foreground' : 'size-full min-h-0 min-w-0'}`}>
        <strong className="text-heading font-semibold">{t("Something went wrong")}</strong>
        <p className="max-w-[420px] text-control text-muted-foreground [overflow-wrap:anywhere]">
          {app ? t("Ramu hit an unexpected error. Your chats and files are safe.") : t("This view hit an unexpected error. The rest of Ramu still works.")}
        </p>
        <p className="max-w-[420px] max-h-24 overflow-hidden text-caption text-muted-foreground [overflow-wrap:anywhere]">{error.message.slice(0, 300)}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>{t("Try again")}</Button>
          {app && <Button variant="default" onClick={() => window.location.reload()}>{t("Reload")}</Button>}
        </div>
      </div>
    )
  }
}
