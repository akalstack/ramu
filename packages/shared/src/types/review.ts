export interface ChangeFile {
  id: string
  repoId: string
  repoName: string
  path: string
  status: 'added' | 'modified' | 'deleted'
  binary: boolean
  oldContent: string
  newContent: string
  oldHash?: string
  newHash?: string
  oldMode?: number
  /** Bytes on each side of a binary file, whose review shows sizes rather than line counts. */
  oldSize?: number
  newSize?: number
  addedLines?: number
  removedLines?: number
}
/** Branch context for a saved run; the diff itself remains a before/after snapshot. */
export interface ReviewBranchState {
  repoId: string
  repoName: string
  currentBranch: string | null
  targetBranch: string | null
  recordedBranch: string | null
}
/** Live state is separate from the immutable run snapshot. */
export interface ReviewFileState {
  fileId: string
  state: 'unchanged' | 'changed' | 'moved' | 'missing' | 'deleted' | 'unavailable'
  currentPath?: string
  checkoutChanged?: boolean
  recordedBranch?: string
  currentBranch?: string
  reason?: string
  newerReview?: { id: string; taskId: string; fileId: string }
  outdatedCommentIds?: string[]
}
export interface ReviewReply {
  id: string
  author?: 'human' | 'ai'
  text: string
  createdAt: number
  state: 'draft' | 'sent'
}
export interface ReviewComment {
  id: string
  fileId: string
  side: 'old' | 'new'
  line: number
  endLine: number
  readyToSend?: boolean
  sentAt?: number
  resolutionSuggestion?: { text: string; createdAt: number }
  scope?: 'file' | 'line'
  kind?: 'comment' | 'note' | 'question' | 'finding'
  replies?: ReviewReply[]
  text: string
  author: 'human' | 'ai'
  severity?: 'high' | 'medium' | 'low'
  state: 'draft' | 'sent' | 'resolved'
  createdAt: number
}
export interface ChangeReview {
  id: string
  taskId: string
  sessionId: string | null
  createdAt: number
  state: 'recording' | 'ready' | 'failed'
  error: string | null
  files: ChangeFile[]
  comments: ReviewComment[]
  aiState: 'idle' | 'running' | 'completed' | 'failed'
  aiSummary: string | null
  startSeq?: number
  endSeq?: number
  reviewedAt?: number | null
  undoneAt?: number | null
  undoFileIds?: string[]
}
export interface UndoFile {
  fileId: string
  path: string
  repoName: string
  status: 'ready' | 'conflict' | 'unchanged' | 'unavailable'
  reason: string
  currentContent: string
  resultContent: string
  remove: boolean
}
export interface UndoPreview {
  token: string
  reviewId: string
  expiresAt: number
  files: UndoFile[]
}
