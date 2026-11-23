import { useMemo, useState } from 'react'
import type { ChangeFile } from '@ramu/shared/types'
import { proseDiff, proseSections, type ProseBlock, type WordPart } from '@ramu/shared/review/proseDiff'
import { Button } from '@/components/desktop-button'
import { MarkdownText, proseProps } from '../chat/MarkdownText'
import { t, useLanguage } from '../i18n'

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const

function Block({ source }: { source: string }) {
  return <MarkdownText className="w-full">{source}</MarkdownText>
}

/** A reworded heading, paragraph or list item: its words in place, the ones that went struck in red, new ones in green. */
function Words({ block, words }: { block: ProseBlock; words: WordPart[] }) {
  const text = words.map((part, index) =>
    part.kind === 'same' ? (
      <span key={index}>{part.text}</span>
    ) : part.kind === 'del' ? (
      <del key={index} className="rounded-xs bg-bad/15 text-bad decoration-bad/60">
        {part.text}
      </del>
    ) : (
      <ins key={index} className="rounded-xs bg-ok/15 text-ok no-underline">
        {part.text}
      </ins>
    ),
  )
  // Drawn in the same reading frame as the unchanged sections around it, so a reworded heading keeps its size.
  const Heading = HEADINGS[(block.level ?? 1) - 1] ?? 'h6'
  return (
    <div {...proseProps()}>
      {block.kind === 'heading' ? (
        <Heading>{text}</Heading>
      ) : (
        <p className="flex gap-2">
          {block.kind === 'item' && <span className="flex-none text-muted-foreground">{block.marker}</span>}
          <span className="min-w-0">{text}</span>
        </p>
      )}
    </div>
  )
}

const BAR = 'border-l-2 py-1 pl-3 pr-2'

/**
 * A changed Markdown document drawn as a document, as GitHub's prose diff shows one: unchanged sections read plainly
 * (long runs fold away), removed ones are tinted red and struck, added ones green, and a reworded paragraph marks the
 * words that changed.
 */
export function ReviewMarkdownDiff({ file }: { reviewId: string; file: ChangeFile }) {
  useLanguage()
  const sections = useMemo(
    () => proseSections(proseDiff(file.status === 'added' ? '' : file.oldContent, file.newContent)),
    [file.status, file.oldContent, file.newContent],
  )
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set())
  if (!sections.length) return <p className="m-0 p-3 text-control text-muted-foreground">{t('This file is empty.')}</p>
  return (
    <div className="flex flex-col gap-1 p-3">
      {sections.map((section, index) => {
        if (section.kind === 'fold')
          return shown.has(index) ? (
            section.entries.map((entry, at) => (
              <Block key={`${index}-${at}`} source={'block' in entry ? entry.block.source : ''} />
            ))
          ) : (
            <Button
              key={index}
              variant="ghost"
              size="sm"
              className="self-start text-caption text-muted-foreground"
              onClick={() => setShown((value) => new Set(value).add(index))}
            >
              {t('Show {count} unchanged sections', { count: section.entries.length })}
            </Button>
          )
        if (section.kind === 'same') return <Block key={index} source={section.block.source} />
        if (section.kind === 'changed')
          return (
            <div key={index} className={`${BAR} border-warn bg-fill`}>
              <Words block={section.after} words={section.words} />
            </div>
          )
        return section.kind === 'del' ? (
          <div
            key={index}
            aria-label={t('Removed')}
            className={`${BAR} border-bad bg-bad/10 opacity-80 [&_:is(p,li,h1,h2,h3,h4,h5,h6,td,th)]:line-through [&_:is(p,li,h1,h2,h3,h4,h5,h6,td,th)]:decoration-bad/60`}
          >
            <Block source={section.block.source} />
          </div>
        ) : (
          <div key={index} aria-label={t('Added')} className={`${BAR} border-ok bg-ok/10`}>
            <Block source={section.block.source} />
          </div>
        )
      })}
    </div>
  )
}
