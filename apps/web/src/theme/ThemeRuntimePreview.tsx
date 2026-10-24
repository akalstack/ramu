import { EditorThemePreview } from './EditorThemePreview'
import type { ThemeVariant } from '@ramu/shared/theme'
import type { ResolvedAppearance } from '../appearance'
import { TerminalThemePreview } from './TerminalThemePreview'
import { InteractiveThemePreview } from './InteractiveThemePreview'
import { t } from '../i18n'

export default function ThemeRuntimePreview(props: { variant: ThemeVariant; appearance: ResolvedAppearance }) {
  return (
    <>
      <span className="font-semibold">{t('Code and diff')}</span>
      <EditorThemePreview {...props} />
      <span className="font-semibold">{t('Terminal')}</span>
      <TerminalThemePreview {...props} />
      <span className="font-semibold">{t('Interactive content')}</span>
      <InteractiveThemePreview {...props} />
    </>
  )
}
