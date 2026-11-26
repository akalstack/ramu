/**
 * A host's name as a list row shows it. A host nobody renamed carries its machine's network name
 * (`build-box.eu-west-1.compute.internal`, `studio.local`), which pushes the row's other facts off the line, so a row
 * keeps the first label. A name someone typed, or a numeric address, is shown as it is.
 */
export function shortHostName(name: string): string {
  const value = name.trim()
  // A network name ends in a word (`.local`, `.internal`, `.net`); `v1.2` or `10.0.0.5` is a name or an address.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(value)) return value
  return value.slice(0, value.indexOf('.'))
}
