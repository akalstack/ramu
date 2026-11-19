import { BrowserWindow } from 'electron'

const escape = (text: string) =>
  text.replace(/[<>&"']/g, (s) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[s]!)

/** The page the window shows: static, with no script, so it needs no preload or bridge. */
function startupPage(title: string, detail: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Ramu</title><style>
html,body{margin:0;height:100%;background:#131315;color:#ececee;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-user-select:none;user-select:none;-webkit-app-region:drag}
main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:0 28px;box-sizing:border-box;text-align:center}
.spinner{width:22px;height:22px;border-radius:50%;border:2px solid #3a3a40;border-top-color:#a99bff;animation:spin .9s linear infinite}
h1{margin:4px 0 0;font-size:15px;font-weight:600}
p{margin:0;color:#9a9aa3}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spinner{animation-duration:3s}}
</style></head><body><main role="status" aria-live="polite"><div class="spinner" aria-hidden="true"></div><h1>${escape(title)}</h1><p>${escape(detail)}</p></main></body></html>`
}

/**
 * Shows a small "Starting Ramu" window while `task` runs, but only once it has taken long enough to notice, so a quick
 * start never flashes it. A new copy of the app can take most of a minute to start while macOS checks it, and without
 * this nothing would be on screen.
 */
export async function whileStarting<T>(
  task: () => Promise<T>,
  text: { title: string; detail: string },
  delayMs = 1000,
): Promise<T> {
  let win: BrowserWindow | null = null
  const timer = setTimeout(() => {
    win = new BrowserWindow({
      width: 400,
      height: 210,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'Ramu',
      backgroundColor: '#131315',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    })
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupPage(text.title, text.detail))}`)
  }, delayMs)
  try {
    return await task()
  } finally {
    clearTimeout(timer)
    const shown = win as BrowserWindow | null
    if (shown && !shown.isDestroyed()) shown.destroy()
  }
}
