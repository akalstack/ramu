// Type-to-filter matching for pickers: every word of the query, in any order, somewhere in the text.

/** Lowercase, without accents, with punctuation that joins words ("Nex-N2.5-Pro", "openrouter/x") read as spaces. */
const fold = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s\-_/·:,()[\]]+/g, ' ')
    .trim()

/**
 * Whether every word of `query` appears in `text`, in any order. A word also matches across the gaps punctuation
 * leaves, so "gpt5" finds "GPT-5" and "n25" does not, but "n2.5" finds "Nex-N2.5-Pro". An empty query matches all.
 */
export function matchesWords(text: string, query: string): boolean {
  const words = fold(query).split(' ').filter(Boolean)
  if (!words.length) return true
  const spaced = fold(text)
  const joined = spaced.replace(/ /g, '')
  return words.every((word) => spaced.includes(word) || joined.includes(word))
}

/** Whether `text` starts with the query as typed, for putting the closest matches first. */
export const startsWithQuery = (text: string, query: string) => {
  const needle = fold(query)
  return !!needle && fold(text).startsWith(needle)
}
