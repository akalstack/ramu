/**
 * Lets overlapping async reads of the same thing apply only the newest one. Call `start()` before each read and
 * check the returned function after its awaits: it is true only while no later read has started, so a slow, older
 * response never replaces newer state.
 */
export function latestOnly(): () => () => boolean {
  let latest = 0
  return () => {
    const mine = ++latest
    return () => mine === latest
  }
}
