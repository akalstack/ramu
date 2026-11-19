import { BrowserTabFrame, BrowserTabButton, BrowserTabCloseButton } from '@/components/browser-tab-controls'
import { RowButton } from '@/components/row-button'
import { LocalInlineAction } from '@/components/inline-action'
import { TurnSummary } from '../views/agent/components/TurnSummary'
import type { ResolvedAppearance } from '../appearance'
import { lazy, Suspense, useState, type CSSProperties } from 'react'
import { themeCssVariables, type ThemeVariant } from '@ramu/shared/theme'
import { Button } from '@/components/desktop-button'
import { t } from '../i18n'
import { Input } from '@/components/desktop-input'
import { Switch } from '@/components/ui/switch'
import { Message, MessageContent } from '@/components/ui/message'
import { Spinner } from '@/components/ui/spinner'
import { UserBubble } from '../chat/UserBubble'
import { QuestionRow } from '../chat/QuestionRow'
import { GoalFacts } from '../chat/GoalFacts'
import { ChatActivityButton } from '../chat/ChatActivity'
import { ComposerTraySection } from '../composer/ComposerTraySection'
import { SettingsFieldContext } from '../settings/settingsField'
import { CircleCheck, Target, Globe, X } from 'lucide-react'
import { LimitTrayRow } from '../models/ProviderWait'
import type { ChatGoal } from '@ramu/shared/types'

const ThemeRuntimePreview = lazy(() => import('./ThemeRuntimePreview'))

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
export function previewVariables(
  variant: ThemeVariant,
  appearance: ResolvedAppearance = variant.overlay === 'white' ? 'dark' : 'light',
): CSSProperties {
  const ink = variant.overlay === 'white' ? '255 255 255' : '0 0 0'
  const steps = Object.fromEntries(
    Object.entries(OVERLAY_STEPS[variant.overlay]).map(([name, alpha]) => [name, `rgb(${ink} / ${alpha})`]),
  )
  return {
    ...themeCssVariables(variant),
    ...steps,
    '--edge': `rgb(${ink} / 0.1)`,
    // These mix other tokens on :root, so a subtree has to restate them to pick up its own colors.
    '--accent-wash': `color-mix(in srgb, ${variant.colors.accent} 10%, transparent)`,
    '--composer-tray': `color-mix(in srgb, ${variant.colors.raised} 55%, ${variant.colors.canvas})`,
    colorScheme: appearance,
  } as CSSProperties
}

const STATUS = [
  { label: 'Done', color: 'var(--ok)', wash: 'var(--ok-wash)' },
  { label: 'Needs a look', color: 'var(--warn)', wash: 'var(--warn-wash)' },
  { label: 'Failed', color: 'var(--bad)', wash: 'var(--bad-wash)' },
]

const SAMPLE_GOAL: ChatGoal = {
  id: 'theme-preview',
  objective: 'Fix the failing test',
  status: 'completed',
  turns: 1,
  reason: '',
  updatedAt: 0,
  check: { command: 'pnpm test', ok: true, output: '', at: 0 },
  evidence: { checks: [{ name: 'pnpm test', passed: true }], changedFiles: ['app.ts'] },
}

/** Production selection/disclosure controls, with local state only. */
function ControlPreview() {
  const [tab, setTab] = useState(0),
    [more, setMore] = useState(false)
  return (
    <>
      <div role="tablist" aria-label={t('Browser tabs')} className="flex gap-1">
        {[0, 1].map((index) => (
          <BrowserTabFrame key={index} active={tab === index}>
            <BrowserTabButton aria-selected={tab === index} onClick={() => setTab(index)}>
              <Globe size={14} aria-hidden="true" />
              {t('Browser')} {index + 1}
            </BrowserTabButton>
            <BrowserTabCloseButton disabled aria-label={t('Close tab')}>
              <X size={12} aria-hidden="true" />
            </BrowserTabCloseButton>
          </BrowserTabFrame>
        ))}
      </div>
      <RowButton aria-pressed={more} onClick={() => setMore(!more)}>
        {t('Selected thread')}
      </RowButton>
      <RowButton disabled>{t('Unavailable')}</RowButton>
      <LocalInlineAction tone="muted" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? t('Show fewer') : t('Show more')}
      </LocalInlineAction>
      {more && <p className="m-0 text-muted-foreground">{t('Muted note')}</p>}
    </>
  )
}

/** Sample surfaces built from the draft's own tokens: sidebar, messages, status cards, actions and code. */
export function ThemePreview({
  variant,
  compact = false,
  appearance = variant.overlay === 'white' ? 'dark' : 'light',
}: {
  variant: ThemeVariant
  compact?: boolean
  appearance?: ResolvedAppearance
}) {
  const [narrow, setNarrow] = useState(false)
  if (compact)
    return (
      <div
        role="img"
        aria-label={t('Preview of the theme')}
        style={previewVariables(variant, appearance)}
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
    <SettingsFieldContext.Provider value={null}>
      <div className="flex flex-col gap-1">
        <div role="group" aria-label={t('Preview width')} className="flex gap-1">
          <Button size="xs" aria-pressed={!narrow} onClick={() => setNarrow(false)}>
            {t('Wide')}
          </Button>
          <Button size="xs" aria-pressed={narrow} onClick={() => setNarrow(true)}>
            {t('Narrow')}
          </Button>
        </div>
        <div
          role="group"
          aria-label={t('Preview of the theme')}
          style={{ ...previewVariables(variant, appearance), maxWidth: narrow ? 360 : undefined }}
          className="flex shrink-0 max-h-80 overflow-y-auto bg-canvas rounded-(--radius-s) text-caption [border:1px_solid_var(--line-strong)]"
        >
          <div className={`${narrow ? 'hidden' : 'flex'} w-28 shrink-0 p-2 bg-window text-soft flex-col gap-1`}>
            <span className="font-semibold text-foreground">ramu</span>
            <Button variant="tree" aria-current="page" className="bg-hover">
              {t('Selected thread')}
            </Button>
            <Button variant="tree">{t('Another thread')}</Button>
            <span className="px-1.5 py-0.5 text-muted-foreground">{t('Muted note')}</span>
          </div>
          <div className="flex-1 self-start min-w-0 p-2 bg-canvas text-foreground flex flex-col gap-2">
            <Message align="end">
              <MessageContent className="items-end">
                <UserBubble>{t('Fix the failing test')}</UserBubble>
              </MessageContent>
            </Message>
            <ChatActivityButton>
              <CircleCheck className="size-3.5 text-ok" />
              {t('Advisor finished')}
            </ChatActivityButton>
            <TurnSummary label={t('Worked for {0}', { 0: '20s' })}>
              <p className="m-0 text-muted-foreground">{t('Fix the failing test')}</p>
            </TurnSummary>
            <div className="flex flex-wrap gap-1">
              {STATUS.map(({ label, color, wash }) => (
                <span key={label} className="rounded-full px-2 py-0.5" style={{ background: wash, color }}>
                  {t(label)}
                </span>
              ))}
            </div>
            <ComposerTraySection title={t('Goal completed')} icon={<Target />} defaultOpen>
              <GoalFacts goal={SAMPLE_GOAL} />
            </ComposerTraySection>
            <QuestionRow
              request={{
                kind: 'question',
                requestId: 'theme-preview',
                at: 0,
                questions: [
                  { id: 'branch', question: t('Which branch?'), header: '', multiSelect: false, options: [] },
                ],
              }}
              status={{ answers: { branch: 'main' }, drafts: {}, waiting: false, outcome: 'answered' }}
              pending={false}
            />
            <LimitTrayRow
              wait={{ retryAt: 3_600_000, guessed: true, resetNotified: false }}
              now={0}
              autoResume={{
                choice: 'default',
                effective: { value: true, source: 'default' },
                globalOn: true,
                set: () => {},
              }}
              onTry={() => {}}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="default">{t('Send')}</Button>
              <Button variant="secondary">{t('Cancel')}</Button>
              <Button variant="destructive">{t('Delete')}</Button>
              <Button disabled>
                <Spinner />
                {t('Saving…')}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Input aria-label={t('Message')} placeholder={t('Message')} />
              <Switch aria-label={t('Enabled')} defaultChecked />
            </div>
            <ControlPreview />
            <Suspense fallback={<span className="text-muted-foreground">{t('Loading previews…')}</span>}>
              <ThemeRuntimePreview variant={variant} appearance={appearance} />
            </Suspense>
          </div>
        </div>
      </div>
    </SettingsFieldContext.Provider>
  )
}
