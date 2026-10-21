import type { PageAction, PageSnapshot } from './browserRuntime'

/** Runs only in the guest's isolated world. Never interpolates page text or caller-supplied JavaScript. */
function guestOperation(
  operation: 'inspect' | 'act' | 'invalidate',
  action?: PageAction,
): PageSnapshot | { ok: boolean; reason?: string } {
  type Record = { element: HTMLElement; signature: string }
  type State = { records: Record[]; observer: MutationObserver; dirty: boolean }
  const world = globalThis as typeof globalThis & { __ramuBrowserObservation?: State }
  const old = world.__ramuBrowserObservation
  const refuse = (reason: string) => ({ ok: false, reason })
  const clean = (text: string | null | undefined, limit = 240) =>
    (text ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
  const visible = (element: HTMLElement) => {
    const style = getComputedStyle(element)
    return (
      element.isConnected &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      element.getClientRects().length > 0
    )
  }
  const name = (element: HTMLElement) => {
    const labelled = clean(element.getAttribute('aria-labelledby'))
      .split(' ')
      .slice(0, 10)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
    const labels =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
        ? Array.from(element.labels ?? [])
            .slice(0, 10)
            .map((label) => label.textContent ?? '')
            .join(' ')
        : ''
    return clean(
      element.getAttribute('aria-label') ||
        labelled ||
        labels ||
        element.getAttribute('alt') ||
        element.getAttribute('placeholder') ||
        element.innerText ||
        element.getAttribute('title'),
    )
  }
  const signature = (element: HTMLElement) =>
    JSON.stringify([
      element.tagName,
      element.getAttribute('role'),
      element.getAttribute('type'),
      element.getAttribute('name'),
      element.getAttribute('href'),
      name(element),
    ])
  if (operation === 'invalidate') {
    old?.observer.disconnect()
    delete world.__ramuBrowserObservation
    return { ok: true }
  }
  if (operation === 'inspect') {
    old?.observer.disconnect()
    const state: State = {
      records: [],
      dirty: false,
      observer: new MutationObserver(() => {
        state.dirty = true
      }),
    }
    const elements: PageSnapshot['elements'] = []
    const text: string[] = []
    let textSize = 0,
      visited = 0,
      truncated = false
    // Bound traversal as well as the returned payload. No form values, cookies, storage or hidden DOM are read.
    const walker = document.createTreeWalker(
      document.body ?? document.documentElement,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    )
    let node: Node | null
    while ((node = walker.nextNode())) {
      if (++visited > 10000) {
        truncated = true
        break
      }
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement
        if (!parent || parent.closest('script,style,noscript,textarea,select,option') || !visible(parent)) continue
        const value = clean(node.textContent, 2000)
        if (value && textSize < 32000) {
          const part = value.slice(0, 32000 - textSize)
          text.push(part)
          textSize += part.length + 1
          if (part.length < value.length) truncated = true
        } else if (value) truncated = true
        continue
      }
      if (
        !(node instanceof HTMLElement) ||
        !visible(node) ||
        !node.matches(
          'a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="textbox"],[tabindex]',
        )
      )
        continue
      if (elements.length >= 200) {
        truncated = true
        continue
      }
      const ref = elements.length + 1
      state.records.push({ element: node, signature: signature(node) })
      elements.push({
        ref,
        tag: node.tagName.toLowerCase(),
        role: clean(node.getAttribute('role')),
        name: name(node),
        ...(node instanceof HTMLInputElement ? { type: node.type } : {}),
        ...(node instanceof HTMLAnchorElement ? { href: node.href.slice(0, 4000) } : {}),
        ...(node instanceof HTMLSelectElement ? { options: Array.from(node.options).slice(0, 40).map((option) => ({ label: clean(option.label), disabled: option.disabled || !!option.closest('optgroup:disabled') })) } : {}),
      })
    }
    state.observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
    world.__ramuBrowserObservation = state
    return {
      url: location.href.slice(0, 4000),
      title: document.title.slice(0, 500),
      text: text.join('\n').slice(0, 32000),
      elements,
      truncated,
    }
  }
  if (!action || !old || old.dirty || old.observer.takeRecords().length)
    return refuse('The page changed. Take a new snapshot first.')
  if (action.kind === 'scroll' && action.ref === undefined) {
    old.observer.disconnect()
    delete world.__ramuBrowserObservation
    window.scrollBy({ left: Math.max(-2000, Math.min(2000, action.x)), top: Math.max(-2000, Math.min(2000, action.y)), behavior: 'instant' })
    return { ok: true }
  }
  const record = old.records[action.ref! - 1]
  if (!record || !visible(record.element) || signature(record.element) !== record.signature)
    return refuse('That element changed or is no longer visible. Take a new snapshot first.')
  const element = record.element
  if (element.matches(':disabled, [aria-disabled="true"]')) return refuse('That element is disabled.')
  // Every attempted mutation consumes this observation, including a refusal after scrolling/focus.
  delete world.__ramuBrowserObservation
  try {
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    if (!hit || (hit !== element && !element.contains(hit)))
      return refuse('Another element covers this target. Take a new snapshot first.')
    if (old.dirty || old.observer.takeRecords().length || signature(element) !== record.signature)
      return refuse('The page changed while locating the target. Take a new snapshot first.')
    if (element instanceof HTMLInputElement && element.type === 'file') return refuse('File selection requires an explicit upload handle or human control.')
    if (action.kind === 'scroll') {
      element.scrollBy({ left: Math.max(-2000, Math.min(2000, action.x)), top: Math.max(-2000, Math.min(2000, action.y)), behavior: 'instant' })
      return { ok: true }
    }
    if (action.kind === 'select') {
      if (!(element instanceof HTMLSelectElement)) return refuse('This target is not a native select control. Use its visible buttons or human control.')
      if (action.labels.length > 20 || (!element.multiple && action.labels.length !== 1)) return refuse('Choose one option for a single-select control.')
      const choices: HTMLOptionElement[] = []
      for (const label of action.labels) {
        const matches = Array.from(element.options).filter((option) => clean(option.label) === label)
        if (matches.length !== 1 || matches[0]!.disabled || matches[0]!.closest('optgroup:disabled')) return refuse('An option is missing, ambiguous or disabled. Take a new snapshot first.')
        choices.push(matches[0]!)
      }
      for (const option of Array.from(element.options)) option.selected = choices.includes(option)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true }
    }
    if (action.kind === 'press') {
      if (element instanceof HTMLInputElement && element.type === 'password') return refuse('Use human control for password fields.')
      element.focus()
      if (document.activeElement !== element || old.dirty || old.observer.takeRecords().length || signature(element) !== record.signature) return refuse('The target changed while focusing. Take a new snapshot first.')
      // Main dispatches the fixed named key through Chromium after this snapshot-bound focus check.
      return { ok: true }
    }
    if (action.kind === 'click') {
      element.click()
      return { ok: true }
    }
    if (action.text.length > 20000) return refuse('Text is too long.')
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement))
      return refuse('Typing is supported in plain input and textarea fields. Use human control for this editor.')
    if (
      element.readOnly ||
      (element instanceof HTMLInputElement && !['text', 'search', 'email', 'url', 'tel'].includes(element.type))
    )
      return refuse('This field cannot accept plain text through the browser tool. Use human control.')
    element.focus()
    if (
      old.dirty ||
      old.observer.takeRecords().length ||
      signature(element) !== record.signature ||
      !element.isConnected ||
      !visible(element) ||
      element.readOnly ||
      element.disabled
    )
      return refuse('The field changed while receiving focus. Take a new snapshot first.')
    const prototype =
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, action.text)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    if (action.submit && element.isConnected) {
      if (!element.form)
        return refuse('Text was inserted, but this field has no form to submit. Inspect the result before continuing.')
      element.form.requestSubmit()
    }
    return { ok: true }
  } finally {
    old.observer.disconnect()
  }
}

/** Isolated-world code is fixed application code plus JSON data; no general-purpose evaluate endpoint exists. */
export function browserGuestScript(operation: 'inspect' | 'act' | 'invalidate', action?: PageAction): string {
  return `(${guestOperation.toString()})(${JSON.stringify(operation)}, ${JSON.stringify(action)})`
}
