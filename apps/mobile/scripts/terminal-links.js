// Runs inside the bundled terminal surface; no host credentials or network calls.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- injected into the terminal bundle as source text by gen-terminal.mjs
function installTerminalLinks(term, post, terminalLinkAt) {
  // An OSC 8 hyperlink xterm already opened; the tap that opened it must not also open the text under it.
  let hyperlinkAt = -Infinity
  function hyperlink(uri) {
    hyperlinkAt = performance.now()
    if (/^https?:\/\//i.test(uri)) post({ kind: 'link', link: 'url', text: uri })
    else if (/^file:\/\//i.test(uri)) {
      // `ls --hyperlink` names the host in the URI; the path is what the phone opens.
      try {
        post({ kind: 'link', link: 'path', text: decodeURIComponent(new URL(uri).pathname) })
      } catch {}
    }
  }
  term.options.linkHandler = { allowNonHttpProtocols: true, activate: (_event, uri) => hyperlink(uri) }
  // A tap on a printed web address or path. A hold-and-drag never ends in a click: the gesture driver swallows it.
  term.element.addEventListener('click', (event) => {
    if (performance.now() - hyperlinkAt < 300 || term.hasSelection()) return
    const screen = term.element.querySelector('.xterm-screen')
    if (!screen) return
    const box = screen.getBoundingClientRect()
    if (!box.width || !box.height) return
    const column = Math.floor((event.clientX - box.left) / (box.width / term.cols))
    const row = Math.floor((event.clientY - box.top) / (box.height / term.rows))
    if (column < 0 || column >= term.cols || row < 0 || row >= term.rows) return
    const buffer = term.buffer.active
    const link = terminalLinkAt({ row: row + buffer.viewportY, column }, (index) => buffer.getLine(index))
    if (link) post({ kind: 'link', link: link.kind, text: link.text })
  })
}
