// Runs inside the bundled terminal surface; no host credentials or network calls.
// A finger cannot drag a selection across xterm's canvas, so the phone asks for the text it offers to copy (commands
// with their output, the screen, recent output) and reads it here from the terminal's own buffer.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- injected into the terminal bundle as source text by gen-terminal.mjs
function installTerminalCopy(term, post, terminalRowsText, blocks) {
  const LIMIT = 200000
  const clip = (text) => (text.length > LIMIT ? text.slice(-LIMIT) : text)
  function receive(event) {
    let value
    try {
      value = JSON.parse(event.data)
    } catch {
      return
    }
    // Pasted through xterm, which brackets it only for a program that asked, so others never see stray markers.
    if (value.kind === 'paste' && typeof value.data === 'string') term.paste(value.data)
    if (value.kind !== 'capture' || !Number.isInteger(value.id)) return
    const buffer = term.buffer.active
    const rows = (start, end) => clip(terminalRowsText(buffer, { start: Math.max(0, start), end }))
    const last = buffer.length - 1
    post({
      kind: 'capture',
      id: value.id,
      selection: clip(term.getSelection()),
      blocks: blocks
        .blocks()
        .slice(-5)
        .reverse()
        .map((range) => clip(blocks.text(range))),
      screen: rows(buffer.viewportY, buffer.viewportY + term.rows - 1),
      recent: rows(last - 999, last),
    })
  }
  window.addEventListener('message', receive)
  document.addEventListener('message', receive)
}
