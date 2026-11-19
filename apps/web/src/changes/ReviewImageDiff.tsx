import { useEffect, useState } from 'react'
import type { ChangeFile } from '@ramu/shared/types'
import { formatSize } from '@ramu/shared/formatSize'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { StepSlider } from '@/components/step-slider'

type Side = 'old' | 'new'
export type ImageMode = '2-up' | 'swipe' | 'onion'

const CHECKERBOARD =
  'bg-[repeating-conic-gradient(var(--fill)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] rounded-(--radius-s)'

/** The run's copy of one side of a changed image; null once the host says it kept none. */
function useReviewImage(reviewId: string, fileId: string, side: Side, wanted: boolean) {
  const { invoke } = useHost()
  const [src, setSrc] = useState<string | null | undefined>(wanted ? undefined : null)
  useEffect(() => {
    if (!wanted) return setSrc(null)
    let alive = true
    setSrc(undefined)
    invoke('reviews.image', reviewId, fileId, side).then(
      (image) => alive && setSrc(image),
      () => alive && setSrc(null),
    )
    return () => {
      alive = false
    }
  }, [invoke, reviewId, fileId, side, wanted])
  return src
}

function Caption({ label, tone, detail }: { label: string; tone: 'bad' | 'ok'; detail: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-caption">
      <span className={tone === 'bad' ? 'font-medium text-bad' : 'font-medium text-ok'}>{label}</span>
      <span className="truncate text-muted-foreground">{detail}</span>
    </span>
  )
}

/**
 * A changed image as GitHub compares one: 2-up (before left, after right), Swipe (drag across from one to the other) or
 * Onion skin (fade between them), on a checkerboard so transparency reads. An added or deleted image shows its one side.
 */
export function ReviewImageDiff({ reviewId, file }: { reviewId: string; file: ChangeFile }) {
  useLanguage()
  const before = useReviewImage(reviewId, file.id, 'old', file.status !== 'added')
  const after = useReviewImage(reviewId, file.id, 'new', file.status !== 'deleted')
  const [mode, setMode] = useState<ImageMode>('2-up')
  const [amount, setAmount] = useState(50)
  const [sizes, setSizes] = useState<Record<Side, string | null>>({ old: null, new: null })
  const measured =
    (side: Side) =>
    ({ currentTarget }: { currentTarget: HTMLImageElement }) =>
      setSizes((value) => ({ ...value, [side]: `${currentTarget.naturalWidth}×${currentTarget.naturalHeight}` }))
  const detail = (side: Side) =>
    [sizes[side], file.binary ? (side === 'old' ? file.oldSize : file.newSize) : undefined]
      .map((value) => (typeof value === 'number' ? formatSize(value) : value))
      .filter(Boolean)
      .join(' · ')
  if (before === undefined || after === undefined)
    return <p className="m-0 p-3 text-control text-muted-foreground">{t('Loading image…')}</p>
  if (!before && !after) return <ReviewBinaryNote file={file} image />
  const both = Boolean(before && after)
  const pane = (side: Side, src: string) => (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <figcaption>
        <Caption
          label={side === 'old' ? (both ? t('Before') : t('Deleted')) : both ? t('After') : t('Added')}
          tone={side === 'old' ? 'bad' : 'ok'}
          detail={detail(side)}
        />
      </figcaption>
      <div
        className={`grid min-h-24 place-items-center border p-2 ${CHECKERBOARD} ${side === 'old' ? 'border-bad/40' : 'border-ok/40'}`}
      >
        <img
          src={src}
          alt={side === 'old' ? t('Before') : t('After')}
          className="block max-h-[360px] max-w-full object-contain"
          onLoad={measured(side)}
        />
      </div>
    </figure>
  )
  // Both pictures fill the same box, so a swipe or a fade lines them up wherever their sizes differ.
  const stacked = (top: React.CSSProperties) => (
    <div className={`relative h-[360px] w-full overflow-hidden border border-line ${CHECKERBOARD}`}>
      <img
        src={after!}
        alt={t('After')}
        className="absolute inset-0 size-full object-contain p-2"
        onLoad={measured('new')}
      />
      <img
        src={before!}
        alt={t('Before')}
        className="absolute inset-0 size-full object-contain p-2"
        style={top}
        onLoad={measured('old')}
      />
      {mode === 'swipe' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-px bg-primary"
          style={{ left: `${amount}%` }}
        />
      )}
    </div>
  )
  return (
    <div className="flex flex-col gap-3 p-3">
      {both && (
        <ToggleGroup
          size="sm"
          spacing={0.5}
          value={[mode]}
          onValueChange={(next) => next[0] && setMode(next[0] as ImageMode)}
          aria-label={t('Compare images')}
          className="self-center"
        >
          <ToggleGroupItem value="2-up">{t('2-up')}</ToggleGroupItem>
          <ToggleGroupItem value="swipe">{t('Swipe')}</ToggleGroupItem>
          <ToggleGroupItem value="onion">{t('Onion skin')}</ToggleGroupItem>
        </ToggleGroup>
      )}
      {!both || mode === '2-up' ? (
        <div className={`grid gap-3 ${both ? 'grid-cols-2' : 'max-w-xl grid-cols-1'}`}>
          {before && pane('old', before)}
          {after && pane('new', after)}
        </div>
      ) : (
        <>
          <div className="flex justify-between gap-3">
            <Caption label={t('Before')} tone="bad" detail={detail('old')} />
            <Caption label={t('After')} tone="ok" detail={detail('new')} />
          </div>
          {stacked(
            mode === 'swipe' ? { clipPath: `inset(0 ${100 - amount}% 0 0)` } : { opacity: (100 - amount) / 100 },
          )}
          <StepSlider
            min={0}
            max={100}
            step={1}
            value={amount}
            onValueChange={(value) => setAmount(Array.isArray(value) ? value[0]! : value)}
            thumbLabel={mode === 'swipe' ? t('Swipe between before and after') : t('Fade between before and after')}
            valueText={`${amount}%`}
            className="mx-auto max-w-sm"
          />
        </>
      )}
    </div>
  )
}

/** What a binary file without a picture says instead of a diff: that it has none, and how its size changed. */
export function ReviewBinaryNote({ file, image = false }: { file: ChangeFile; image?: boolean }) {
  useLanguage()
  const sizes = [file.oldSize, file.newSize].filter((size): size is number => size !== undefined).map(formatSize)
  return (
    <p className="review-binary m-0 p-3 text-control text-muted-foreground">
      {image ? t('This run kept no preview of this image.') : t('This binary or large file has no text diff.')}
      {sizes.length > 0 && <span className="ml-2 text-soft">{sizes.join(' → ')}</span>}
    </p>
  )
}
