export interface SearchOptions {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  include: string
  exclude: string
  repoId?: string
}
export interface SearchMatch {
  repoId: string
  path: string
  line: number
  column: number
  endColumn: number
  text: string
  start: number
  end: number
}
export interface SearchResults {
  matches: SearchMatch[]
  limited: boolean
}
export interface ReplaceFilePreview {
  repoId: string
  path: string
  hash: string
  count: number
  before: string
  after: string
}
