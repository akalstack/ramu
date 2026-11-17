import { z } from 'zod'
import type { FileContext } from '@ramu/shared/types'
import type { ReviewService } from '../../review/reviews'
import { lockCheckouts } from '../helpers'
import { attachmentIds, fileContext, id, relPath } from '../schemas'
import type { RegisterHandlers } from '../types'

const commentInput = z.object({
  fileId: id,
  scope: z.enum(['file', 'line']).default('line'),
  side: z.enum(['old', 'new']),
  line: z.number().int().positive(),
  endLine: z.number().int().positive(),
  text: z.string().trim().min(1).max(10000),
})
const commentText = z.string().trim().min(1).max(10000)
const idList = z.array(id).min(1).max(100)

/** Code reviews, their comments, and undo of reviewed or chat changes. */
export const registerReviewHandlers: RegisterHandlers = (ctx) => {
  const { workspace, reviews, agents, attachmentStore, withContext } = ctx
  return {
    'reviews.list': {
      args: z.tuple([id.optional()]),
      run: (sessionId?: string) =>
        reviews
          .list(sessionId)
          .map((r) => ({ ...r, files: r.files.map((f) => ({ ...f, oldContent: '', newContent: '' })) })),
    },
    'reviews.get': { args: z.tuple([id]), run: (reviewId: string) => reviews.details(reviewId) },
    'reviews.branches': { args: z.tuple([id]), run: (reviewId: string) => reviews.branches(reviewId) },
    'reviews.inspect': { args: z.tuple([id]), run: (reviewId: string) => reviews.inspect(reviewId) },
    'reviews.compareCurrent': {
      args: z.tuple([id, id]),
      run: (reviewId: string, fileId: string) => reviews.compareCurrent(reviewId, fileId),
    },
    'reviews.image': {
      args: z.tuple([id, id, z.enum(['old', 'new'])]),
      run: (reviewId: string, fileId: string, side: 'old' | 'new') => reviews.image(reviewId, fileId, side),
    },
    'reviews.locate': {
      args: z.tuple([id, id, relPath]),
      run: (reviewId: string, fileId: string, path: string) => reviews.locate(reviewId, fileId, path),
    },
    'reviews.comment': {
      args: z.tuple([id, commentInput, id.optional()]),
      run: (reviewId: string, comment: Parameters<ReviewService['comment']>[1], commentId?: string) =>
        reviews.comment(reviewId, comment, commentId),
    },
    'reviews.select': {
      args: z.tuple([id, z.array(id).max(200), z.boolean()]),
      run: (reviewId: string, comments: string[], selected: boolean) => reviews.select(reviewId, comments, selected),
    },
    'reviews.reopenComment': {
      args: z.tuple([id, id]),
      run: (reviewId: string, commentId: string) => reviews.reopenComment(reviewId, commentId),
    },
    'reviews.reply': {
      args: z.tuple([id, id, commentText, id.optional()]),
      run: (reviewId: string, commentId: string, text: string, replyId?: string) =>
        reviews.reply(reviewId, commentId, text, replyId),
    },
    'reviews.removeReply': {
      args: z.tuple([id, id, id]),
      run: (reviewId: string, commentId: string, replyId: string) => reviews.removeReply(reviewId, commentId, replyId),
    },
    'reviews.removeComment': {
      args: z.tuple([id, id]),
      run: (reviewId: string, commentId: string) => reviews.removeComment(reviewId, commentId),
    },
    'reviews.resolveComment': {
      args: z.tuple([id, id]),
      run: (reviewId: string, commentId: string) => reviews.resolveComment(reviewId, commentId),
    },
    'reviews.sendComments': {
      args: z.tuple([id, idList, z.string().max(100_000).optional(), attachmentIds, fileContext]),
      run: async (
        reviewId: string,
        comments: string[],
        note?: string,
        attachmentIds?: string[],
        context?: FileContext[],
      ) => {
        const review = reviews.get(reviewId)
        const prompt = await withContext(
          workspace,
          review.taskId,
          note?.trim() || `Address ${comments.length} review ${comments.length === 1 ? 'comment' : 'comments'}.`,
          context,
        )
        return reviews.sendComments(reviewId, comments, prompt, attachmentStore.resolve(attachmentIds))
      },
    },
    'reviews.ai': { args: z.tuple([id]), run: (reviewId: string) => reviews.reviewAi(reviewId) },
    'reviews.markReviewed': {
      args: z.tuple([id, z.boolean()]),
      run: (reviewId: string, reviewed: boolean) => reviews.markReviewed(reviewId, reviewed),
    },
    'reviews.undoPreview': { args: z.tuple([id]), run: (reviewId: string) => reviews.undoPreview(reviewId) },
    'reviews.undoApply': {
      args: z.tuple([id, idList]),
      run: (token: string, fileIds: string[]) =>
        lockCheckouts(ctx, reviews.covers(reviews.undoReviewId(token)), () => reviews.undoApply(token, fileIds)),
    },
    'reviews.chatUndoPreview': {
      args: z.tuple([id, z.number().int().min(1)]),
      run: (s: string, seq: number) => lockCheckouts(ctx, agents.get(s).covers, () => reviews.chatUndoPreview(s, seq)),
    },
    'reviews.chatUndoApply': {
      args: z.tuple([id, idList]),
      run: (token: string, files: string[]) =>
        lockCheckouts(ctx, reviews.chatUndoCovers(token), () => reviews.chatUndoApply(token, files)),
    },
  }
}
