let wanted: 'bar' | 'model' = 'bar'

/** Opens the model bar straight on its model list, for something that already knows a model has to change. */
export function openModelList(trigger: HTMLElement) {
  wanted = 'model'
  trigger.click()
}

/** Which page the bar opens on; a request lasts for one opening. */
export function takeOpeningPage() {
  const page = wanted
  wanted = 'bar'
  return page
}
