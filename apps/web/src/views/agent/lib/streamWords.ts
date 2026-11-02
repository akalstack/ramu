/** Slightly past the CSS fade, so a word is never dropped from its span while still fading. */
const FADE_MS = 240
// A message already this long when it first appears (a chat opened mid-stream) shows what it has and fades only what follows.
const SETTLED_CHARS = 160

interface HastNode {
  type: string
  tagName?: string
  value?: string
  position?: { start: { offset?: number } }
  children?: HastNode[]
}

/** Which source characters arrived when. Offsets survive re-parsing; a word's place in the rendered tree does not. */
export interface StreamClock {
  length: number
  arrivals: { offset: number; at: number }[]
}

export const streamClock = (text: string): StreamClock => ({
  length: text.length > SETTLED_CHARS ? text.length : 0,
  arrivals: [],
})

/** Call once per render, before the markdown is rendered. */
export function noteArrival(clock: StreamClock, text: string, now = Date.now()) {
  if (text.length < clock.length) {
    clock.length = text.length
    clock.arrivals = []
  } else if (text.length > clock.length) {
    clock.arrivals.push({ offset: clock.length, at: now })
    clock.length = text.length
  }
  clock.arrivals = clock.arrivals.filter((arrival, i, all) => {
    const next = all[i + 1]
    return !next || now - next.at < FADE_MS
  })
}

function age(clock: StreamClock, offset: number, now: number): number | null {
  for (let i = clock.arrivals.length - 1; i >= 0; i--) {
    const arrival = clock.arrivals[i]!
    if (offset >= arrival.offset) return now - arrival.at < FADE_MS ? now - arrival.at : null
  }
  return null
}

function split(node: HastNode, clock: StreamClock, now: number): HastNode[] {
  const start = node.position?.start.offset
  if (start === undefined || !node.value) return [node]
  const nodes: HastNode[] = []
  let at = 0
  for (const part of node.value.split(/(\s+)/)) {
    const elapsed = part.trim() ? age(clock, start + at, now) : null
    at += part.length
    if (elapsed === null) {
      const last = nodes.at(-1)
      if (last?.type === 'text') last.value += part
      else if (part) nodes.push({ type: 'text', value: part })
      continue
    }
    nodes.push({
      type: 'element',
      tagName: 'span',
      // A word rendered again after a re-parse resumes its fade instead of restarting it.
      properties: { className: ['stream-word'], ...(elapsed > 0 ? { style: `animation-delay:-${elapsed}ms` } : {}) },
      children: [{ type: 'text', value: part }],
    } as HastNode)
  }
  return nodes
}

function walk(parent: HastNode, clock: StreamClock, now: number) {
  parent.children = parent.children?.flatMap((child) => {
    if (child.type === 'text') return split(child, clock, now)
    if (child.tagName !== 'code' && child.tagName !== 'pre') walk(child, clock, now)
    return [child]
  })
}

/** Fades only the words that just arrived, whatever the markdown around them turned into on this parse. */
export const rehypeStreamWords = (clock: StreamClock) => () => (tree: HastNode) => walk(tree, clock, Date.now())
