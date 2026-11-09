// Review comments arrive as GitHub-flavored Markdown with GitHub's own conventions: emoji shortcodes, HTML such as
// <details>, and hidden HTML comments. The renderer handles the HTML; this turns the shortcodes review bots use most
// into the emoji GitHub shows, so a comment reads the same here as on the service.

const EMOJI: Record<string, string> = {
  warning: '⚠️',
  bulb: '💡',
  memo: '📝',
  broom: '🧹',
  hammer_and_wrench: '🛠️',
  wrench: '🔧',
  bug: '🐛',
  rocket: '🚀',
  white_check_mark: '✅',
  heavy_check_mark: '✔️',
  x: '❌',
  exclamation: '❗',
  bangbang: '‼️',
  question: '❓',
  information_source: 'ℹ️',
  lock: '🔒',
  zap: '⚡',
  fire: '🔥',
  sparkles: '✨',
  tada: '🎉',
  eyes: '👀',
  thumbsup: '👍',
  '+1': '👍',
  thumbsdown: '👎',
  '-1': '👎',
  mag: '🔍',
  pencil: '📝',
  pencil2: '✏️',
  rabbit: '🐰',
  robot: '🤖',
  red_circle: '🔴',
  orange_circle: '🟠',
  yellow_circle: '🟡',
  green_circle: '🟢',
  large_blue_circle: '🔵',
  stop_sign: '🛑',
  no_entry: '⛔',
  construction: '🚧',
  recycle: '♻️',
  chart_with_upwards_trend: '📈',
  link: '🔗',
  package: '📦',
  shield: '🛡️',
  test_tube: '🧪',
  hourglass: '⌛',
}

/** A comment body as GitHub would display it: known emoji shortcodes replaced, outside code. */
export function forgeCommentMarkdown(body: string): string {
  // Code spans and fences keep their text as written.
  return body
    .replace(/\r\n?/g, '\n')
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2 ? part : part.replace(/:([a-z0-9_+-]{1,40}):/g, (match, name: string) => EMOJI[name] ?? match),
    )
    .join('')
}
