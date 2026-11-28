// Runs inside the bundled terminal surface; no host credentials or network calls.
// Holding ⌫ on a phone keyboard repeats only while the field it types into has something to delete, and the field the
// terminal types through is always empty, so a hold deleted once. The field keeps a few invisible characters, so the
// keyboard's own repeat runs at its own pace and speeds up as it does in any text field. Each delete still reaches the
// terminal the way xterm reads keys (a Backspace key, or a field that got shorter); one that came with no key event at
// all is sent here. The characters are put back after every change, and never while a word is being composed.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- injected into the terminal bundle as source text by gen-terminal.mjs
function installTerminalDelete(field, send) {
  const pad = '​'.repeat(16)
  let composing = false,
    keyed = false
  const refill = () => {
    if (composing || field.value === pad) return
    field.value = pad
    try {
      field.setSelectionRange(pad.length, pad.length)
    } catch {}
  }
  field.addEventListener('compositionstart', () => (composing = true), true)
  field.addEventListener(
    'compositionend',
    () => {
      composing = false
      setTimeout(refill, 0)
    },
    true,
  )
  field.addEventListener(
    'keydown',
    () => {
      keyed = true
      setTimeout(() => (keyed = false), 0)
    },
    true,
  )
  field.addEventListener(
    'input',
    (event) => {
      if (event.inputType === 'deleteContentBackward' && !keyed && !composing) send()
      setTimeout(refill, 0)
    },
    true,
  )
  field.addEventListener('focus', refill)
  refill()
}
