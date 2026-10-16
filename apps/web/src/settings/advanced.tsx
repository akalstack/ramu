import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { t } from '../i18n'

// Per-device view choice, not a synced preference: it only decides which settings this window shows.
const KEY = 'ramu.settings.showAdvanced'
const listeners = new Set<() => void>()

const read = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

export function setShowAdvanced(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* Private mode: the choice just doesn't persist. */
  }
  listeners.forEach((listener) => listener())
}

export function useShowAdvanced() {
  return useSyncExternalStore(subscribe, read)
}

/**
 * One collapsed group per settings page, at its bottom, for power-user controls. It opens on its own;
 * "Show advanced settings" in the sidebar opens or closes every page's group. Values apply either way.
 */
export function Advanced({ children }: { children: ReactNode }) {
  const all = useShowAdvanced()
  const [open, setOpen] = useState(all)
  useEffect(() => setOpen(all), [all])
  return (
    <div className="settings-advanced mt-4">
      <button
        type="button"
        aria-expanded={open}
        className="settings-group-title m-[4px_0_10px] flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-caption font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={13} className={open ? 'rotate-90' : undefined} />
        {t('Advanced')}
      </button>
      {open && children}
    </div>
  )
}
