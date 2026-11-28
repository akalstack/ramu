/** Ramu's browser and computer tools, however the provider prefixes them (`mcp__ramu__browser_open`, `browser_open`). */
const DEVICE_TOOL = /(?:^|__)(?:browser|computer)_[a-z_]+$/

/**
 * Whether a call uses the browser or the computer. A browser opened on a desktop is announced only inside that desktop
 * app, so other devices read a thread's browser and computer again when its agent makes such a call.
 */
export const isDeviceTool = (name: string) => DEVICE_TOOL.test(name)
