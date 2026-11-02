let wanted = false

/** Opens the model bar straight on its model list, for something that already knows a model has to change. */
export function openModelList(trigger: HTMLElement) {
  wanted = true
  trigger.click()
}

/** Whether this opening was asked to start on the model list; a request lasts for one opening. */
export function takeModelListRequest() {
  const asked = wanted
  wanted = false
  return asked
}
