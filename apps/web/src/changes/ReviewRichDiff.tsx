import type { ChangeFile } from '@ramu/shared/types'
import type { ReviewRichKind } from '@ramu/shared/review/reviewRich'
import { ReviewImageDiff } from './ReviewImageDiff'
import { ReviewMarkdownDiff } from './ReviewMarkdownDiff'
import { ReviewModelDiff } from './ReviewModelDiff'
import { ReviewNotebookDiff } from './ReviewNotebookDiff'
import { ReviewTableDiff } from './ReviewTableDiff'

/** A changed file drawn as what it is (picture, prose, table, notebook or model) rather than as lines of text. */
export function ReviewRichDiff({ kind, reviewId, file }: { kind: ReviewRichKind; reviewId: string; file: ChangeFile }) {
  const View = {
    image: ReviewImageDiff,
    markdown: ReviewMarkdownDiff,
    table: ReviewTableDiff,
    notebook: ReviewNotebookDiff,
    model: ReviewModelDiff,
  }[kind]
  return <View reviewId={reviewId} file={file} />
}
