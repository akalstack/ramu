import { ArrowDown } from 'lucide-react'
import { MessageScrollerButton } from '@/components/ui/message-scroller'
import { LoadingDots } from '@/components/loading-dots'
import { t, useLanguage } from '../../../i18n'
import { scrollMotion } from '../../../workspace/panelMotion'

/**
 * Opaque in every interaction state, so transcript text never shows through the floating control. It matches the send
 * button's size and arrow, with the same faint edge as other floating surfaces.
 */
export function ScrollToLatestButton({ working }: { working: boolean }) {
  useLanguage()
  return (
    <MessageScrollerButton
      variant="secondary"
      size="icon"
      behavior={scrollMotion()}
      className="size-[30px] rounded-full border border-(--edge) bg-raised text-foreground shadow-none [&:hover:not(:disabled)]:bg-[color-mix(in_srgb,var(--raised),var(--text)_5%)] hover:text-foreground active:bg-raised active:translate-y-0 motion-safe:transition-[opacity,translate,scale,background-color]"
      aria-label={working ? t('Agent is working. Scroll to latest') : t('Scroll to latest')}
      title={t('Scroll to latest')}
    >
      {working ? <LoadingDots /> : <ArrowDown size={16} strokeWidth={2.25} />}
    </MessageScrollerButton>
  )
}
