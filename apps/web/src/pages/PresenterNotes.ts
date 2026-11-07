import { t } from '../i18n'

export interface PresenterSlide {
  index: number
  count: number
  title: string
  notes: string
  next: string | null
}

/** Another display the deck can fill, when this computer has one and Ramu may know about it. */
export async function audienceScreen(): Promise<unknown | null> {
  const screens = window as Window & {
    getScreenDetails?: () => Promise<{ screens: unknown[]; currentScreen: unknown }>
  }
  if (!(window.screen as Screen & { isExtended?: boolean }).isExtended || !screens.getScreenDetails) return null
  try {
    const details = await screens.getScreenDetails()
    return details.screens.find((entry) => entry !== details.currentScreen) ?? null
  } catch {
    return null
  }
}

/** Opens the presenter window the desktop places on the display the deck is not on. */
export const openPresenterWindow = (): Window | null => window.open('about:blank', 'ramu-presenter', 'popup')

const minutes = (ms: number) => {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Fills the presenter window with the slide's notes, what comes next and the time since presenting began. */
export function showPresenterSlide(target: Window, slide: PresenterSlide, since: number): void {
  if (target.closed) return
  const doc = target.document
  doc.title = t('Presenter notes')
  doc.body.replaceChildren()
  doc.body.style.cssText =
    'margin:0;padding:32px;background:#111;color:#eee;font:20px/1.5 system-ui,sans-serif;display:flex;flex-direction:column;gap:16px;height:100vh;box-sizing:border-box'
  const line = (text: string, style: string) => {
    const element = doc.createElement('div')
    element.textContent = text
    element.style.cssText = style
    doc.body.append(element)
  }
  line(
    `${t('{current} of {count}', { current: slide.index + 1, count: slide.count })} · ${minutes(Date.now() - since)}`,
    'color:#999;font-size:16px',
  )
  line(slide.title, 'font-size:28px;font-weight:600')
  line(slide.notes || t('No speaker notes on this slide.'), 'flex:1;overflow:auto;white-space:pre-wrap')
  if (slide.next) line(`${t('Next')}: ${slide.next}`, 'color:#999;font-size:16px')
}
