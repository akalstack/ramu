// Hostile input shared by the chaos smoke. Each payload targets a class of failure QA would try by hand:
// size, unbroken tokens, bidi/zero-width/combining marks, lone surrogates, NUL, markup, paths, globs, regex.
export const MAX_TEXT = 100_000

export const PAYLOADS = {
  empty: '',
  spaces: '     ',
  newlines: '\n\n\n\n',
  tabs: '\t\t\t',
  single: 'a',
  long2k: 'x'.repeat(2_000),
  long100k: 'lorem ipsum dolor '.repeat(Math.ceil(MAX_TEXT / 18)).slice(0, MAX_TEXT),
  unbroken: 'A'.repeat(2_000),
  unbrokenPath: `${'segment/'.repeat(300)}file.ts`,
  unbrokenUrl: `https://example.com/${'a'.repeat(3_000)}`,
  rtl: '\u202Eevil\u202C العربية עברית \u2067mixed\u2069',
  zeroWidth: 'a\u200B\u200C\u200D\u2060\uFEFFb',
  zalgo: 'Z\u0300\u0301\u0302\u0303\u0304\u0305\u0306\u0307\u0308\u0309'.repeat(40) + 'algo',
  emoji: '👨‍👩‍👧‍👦🏳️‍🌈🧑🏽‍💻'.repeat(80),
  cjk: '漢字かなカナ한국어'.repeat(80),
  loneSurrogate: 'before \uD800 after \uDFFF end',
  nul: 'nul\0byte',
  control: '\u0001\u0002\u001b[31mred\u001b[0m\u007f',
  html: '<img src=x onerror=alert(1)><script>alert(1)</script><b>bold</b>',
  htmlAttr: '"><svg onload=alert(1)>',
  markdown: '# h1\n```\nunclosed fence\n> quote **bold _it_ `code`\n- [ ] task\n| a | b |\n|---|---|\n[x](javascript:alert(1)) ![i](http://x/y.png)',
  markdownDeep: '> '.repeat(500) + 'deep',
  markdownNested: '- '.repeat(300) + 'item',
  template: '${process.exit(1)} {{7*7}} %s %d %n {0} {name} $(whoami) `id`',
  sql: "'; DROP TABLE tasks; --",
  shell: '$(touch /tmp/ramu-chaos-pwned); `touch /tmp/ramu-chaos-pwned`; rm -rf ~',
  path: '../../../etc/passwd',
  absolutePath: '/etc/passwd',
  dashName: '--upload-pack=touch /tmp/ramu-chaos-pwned',
  dotGit: '.git/config',
  windowsPath: 'C:\\Windows\\System32\\con',
  glob: '**/{',
  regexBroken: '(',
  regexCatastrophic: '(a+)+$',
  json: '{"a":[1,2,{"b":null}]}',
  proto: '__proto__',
}

/** A short list for expensive surfaces (those that persist or spawn processes). */
export const CORE = ['empty', 'spaces', 'long2k', 'unbroken', 'rtl', 'zalgo', 'emoji', 'loneSurrogate', 'nul', 'html', 'markdown', 'shell', 'path', 'dashName']

export const pick = (keys) => Object.fromEntries(keys.map((k) => [k, PAYLOADS[k]]))
