import type { Ref } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Textarea } from '@/components/ui/textarea'

/**
 * The message box of a side panel (an aside, an agent): one borderless line that grows with what is written, its text
 * level with the send button, which is the thread composer's. Enter sends; Shift+Enter starts a new line.
 */
export function PanelComposer({
  value,
  onChange,
  onSend,
  placeholder,
  label,
  sendLabel,
  sendTitle,
  disabled = false,
  canSend,
  maxLength = 20_000,
  inputRef,
}: {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  placeholder: string
  label: string
  sendLabel: string
  sendTitle?: string
  disabled?: boolean
  /** Whether the button may send now (text written, nothing already sending). */
  canSend: boolean
  maxLength?: number
  inputRef?: Ref<HTMLTextAreaElement>
}) {
  return (
    <form
      className="panel-composer relative flex-none m-[0_10px_10px] min-w-0"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSend) onSend()
      }}
    >
      <Textarea
        ref={inputRef}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        rows={1}
        maxLength={maxLength}
        className="min-h-11 max-h-40 resize-none rounded-(--radius-l) border-0 bg-fill py-[11px] pr-12 pl-3.5 text-control leading-[1.5] shadow-none ring-0 focus-visible:ring-0 dark:bg-fill"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (canSend) onSend()
          }
        }}
      />
      <Button
        variant="default"
        size="icon-sm"
        type="submit"
        className="send absolute right-[7px] bottom-[7px]"
        aria-label={sendLabel}
        title={sendTitle}
        disabled={disabled || !canSend}
      >
        <ArrowUp size={16} strokeWidth={2.25} />
      </Button>
    </form>
  )
}
