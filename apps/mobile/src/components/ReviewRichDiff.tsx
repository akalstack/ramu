import type { ChangeFile } from '@ramu/shared/types'
import type { ReviewRichKind } from '@ramu/shared/review/reviewRich'
import { ReviewImageCompare } from './ReviewImageCompare'
import { ReviewMarkdownDiff } from './ReviewMarkdownDiff'
import { ReviewModelDiff } from './ReviewModelDiff'
import { ReviewNotebookDiff } from './ReviewNotebookDiff'
import { ReviewTableDiff } from './ReviewTableDiff'

/** A changed file drawn as what it is (picture, prose, table, notebook or model) rather than as lines of text. */
export function ReviewRichDiff({
  kind,
  computerId,
  reviewId,
  file,
}: {
  kind: ReviewRichKind
  computerId: string
  reviewId: string
  file: ChangeFile
}) {
  const View = {
    image: ReviewImageCompare,
    markdown: ReviewMarkdownDiff,
    table: ReviewTableDiff,
    notebook: ReviewNotebookDiff,
    model: ReviewModelDiff,
  }[kind]
  return <View computerId={computerId} reviewId={reviewId} file={file} />
}
