import type { CSSProperties } from 'react'
import { themeCssVariables, type ThemeVariant } from '@ramu/shared/theme'
import { Button } from '@/components/desktop-button'
import { t } from '../i18n'

/** The translucent steps styles.css derives from the overlay ink; a preview scope has to restate them itself. */
const OVERLAY_STEPS = {
  white: {
    '--fill': 0.05,
    '--fill-hover': 0.08,
    '--hover': 0.055,
    '--pressed': 0.09,
    '--line': 0.065,
    '--line-strong': 0.11,
  },
  black: {
    '--fill': 0.055,
    '--fill-hover': 0.09,
    '--hover': 0.06,
    '--pressed': 0.1,
    '--line': 0.1,
    '--line-strong': 0.16,
  },
} as const

/** CSS variables that restyle one subtree as if the app used this variant, whatever the app itself shows. */
export function previewVariables(variant: ThemeVariant): CSSProperties {
  const ink = variant.overlay === 'white' ? '255 255 255' : '0 0 0'
  const steps = Object.fromEntries(
    Object.entries(OVERLAY_STEPS[variant.overlay]).map(([name, alpha]) => [name, `rgb(${ink} / ${alpha})`]),
  )
  return {
    ...themeCssVariables(variant),
    ...steps,
    '--edge': `rgb(${ink} / 0.1)`,
    colorScheme: variant.overlay === 'white' ? 'dark' : 'light',
  } as CSSProperties
}

const STATUS = [
  { label: 'Done', color: 'var(--ok)', wash: 'var(--ok-wash)' },
  { label: 'Needs a look', color: 'var(--warn)', wash: 'var(--warn-wash)' },
  { label: 'Failed', color: 'var(--bad)', wash: 'var(--bad-wash)' },
]

const CARDS: { title: string; text: string; tone?: 'ok' | 'warn' | 'bad' }[] = [
  { title: 'Advisor', text: 'The plan looks sound.' },
  { title: 'Goal', text: 'Tests pass', tone: 'ok' },
  { title: 'Question', text: 'Which branch?', tone: 'warn' },
  { title: 'Limit reached', text: 'Resets at 18:00', tone: 'bad' },
]

/** Sample surfaces built from the draft's own tokens: sidebar, messages, status cards, actions and code. */
export function ThemePreview({ variant, compact = false }: { variant: ThemeVariant; compact?: boolean }) {
  if (compact)
    return (
      <div
        role="img"
        aria-label={t('Preview of the theme')}
        style={previewVariables(variant)}
        className="flex h-20 overflow-hidden rounded-(--radius-s) text-caption [border:1px_solid_var(--line-strong)]"
      >
        <div className="w-6 shrink-0 bg-window" />
        <div className="flex-1 min-w-0 p-1.5 bg-canvas text-foreground flex flex-col justify-between">
          <span className="truncate font-semibold">Aa</span>
          <span className="flex gap-1">
            {(['primary', 'accent', 'ok', 'warn', 'bad'] as const).map((role) => (
              <span
                key={role}
                className="size-3 rounded-full"
                style={{ background: `var(--${role === 'primary' ? 'primary' : role})` }}
              />
            ))}
          </span>
          <span
            className="rounded-(--radius-xs) px-1 truncate"
            style={{ background: 'var(--bubble)', color: 'var(--text-body)' }}
          >
            {t('Fix the failing test')}
          </span>
        </div>
      </div>
    )
  return (
    <div
      role="img"
      aria-label={t('Preview of the theme')}
      style={previewVariables(variant)}
      className="flex shrink-0 overflow-hidden rounded-(--radius-s) text-caption [border:1px_solid_var(--line-strong)]"
    >
      <div className="w-28 shrink-0 p-2 bg-window text-soft flex flex-col gap-1">
        <span className="font-semibold text-foreground">ramu</span>
        <span className="rounded-(--radius-xs) bg-hover px-1.5 py-0.5 text-foreground">{t('Selected thread')}</span>
        <span className="px-1.5 py-0.5">{t('Another thread')}</span>
        <span className="px-1.5 py-0.5 text-muted-foreground">{t('Muted note')}</span>
      </div>
      <div className="flex-1 min-w-0 p-2 bg-canvas text-foreground flex flex-col gap-1.5">
        <span
          className="self-end rounded-(--radius-m) px-2 py-0.5"
          style={{ background: 'var(--bubble)', color: 'var(--text-body)' }}
        >
          {t('Fix the failing test')}
        </span>
        <span style={{ color: 'var(--text-body)' }}>
          {t('Updated the helper;')} <span style={{ color: 'var(--accent)' }}>app.ts</span>
        </span>
        <div className="flex flex-wrap gap-1">
          {STATUS.map(({ label, color, wash }) => (
            <span key={label} className="rounded-full px-2 py-0.5" style={{ background: wash, color }}>
              {t(label)}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="default" tabIndex={-1} aria-hidden>
            {t('Send')}
          </Button>
          <Button variant="secondary" tabIndex={-1} aria-hidden>
            {t('Cancel')}
          </Button>
          <span
            className="flex-1 truncate rounded-(--radius-xs) px-1.5 py-0.5 font-mono"
            style={{ background: 'var(--code-bg)', color: 'var(--text-body)' }}
          >
            {'add(a, b)'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {CARDS.map(({ title, text, tone }) => (
            <div
              key={title}
              className="min-w-0 rounded-(--radius-s) px-2 py-1"
              style={{
                background: tone ? `var(--${tone}-wash)` : 'var(--fill)',
                color: tone ? `var(--${tone})` : undefined,
                border: '1px solid var(--line)',
              }}
            >
              <div className="font-semibold truncate">{t(title)}</div>
              <div className="truncate" style={{ color: 'var(--soft)' }}>
                {t(text)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
