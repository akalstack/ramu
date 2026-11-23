/** The macOS Privacy & Security pages Ramu sends the person to when it needs a permission. */
export const PRIVACY_PANES = {
  /** Reading other apps' data, such as a browser's sign-ins to import. */
  'full-disk-access': 'Privacy_AllFiles',
  accessibility: 'Privacy_Accessibility',
  'screen-recording': 'Privacy_ScreenCapture',
  'input-monitoring': 'Privacy_ListenEvent',
  microphone: 'Privacy_Microphone',
  camera: 'Privacy_Camera',
} as const

export type PrivacyPane = keyof typeof PRIVACY_PANES

/** The System Settings address of a Privacy & Security page. */
export const privacyPaneUrl = (pane: PrivacyPane) =>
  `x-apple.systempreferences:com.apple.preference.security?${PRIVACY_PANES[pane]}`
