export const ramu = window.ramu
export const invoke = ramu.invoke

/** The renderer has no clipboard permission, so copying goes through the main process. */
export const copyText = (text: string) => invoke('clipboard.write', text)
