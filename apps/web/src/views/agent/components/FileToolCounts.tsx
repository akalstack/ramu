/** An edit's line counts beside its file name, as in Changes: green additions, red removals; absent counts draw nothing. */
export function FileToolCounts({ added, removed }: { added?: number; removed?: number }) {
  if (!added && !removed) return null
  return (
    <span className="flex-none font-mono text-caption tabular-nums">
      {added ? <span className="text-ok">+{added}</span> : null}
      {added && removed ? ' ' : null}
      {removed ? <span className="text-bad">−{removed}</span> : null}
    </span>
  )
}
