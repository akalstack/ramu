/** A changed file's path: when space runs out the folder shortens first, so the file name stays readable. */
export function FilePath({ path, className }: { path: string; className: string }) {
  const slash = path.lastIndexOf('/')
  return (
    <span className={`file-path flex min-w-0 overflow-hidden whitespace-nowrap ${className}`}>
      {slash >= 0 && (
        <span className="file-path-dir [flex:0_1000_auto] min-w-[2ch] overflow-hidden text-ellipsis text-muted-foreground font-normal">
          {path.slice(0, slash + 1)}
        </span>
      )}
      <span className="file-path-name flex-initial text-foreground min-w-0 overflow-hidden text-ellipsis">
        {path.slice(slash + 1)}
      </span>
    </span>
  )
}
