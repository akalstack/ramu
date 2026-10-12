import { t, useLanguage } from './i18n'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { TerminalView } from './views/TerminalView'

type SetupCommand = { id: string; title: string; command: string }
export function runProviderCommand(title: string, command: string) {
  window.dispatchEvent(new CustomEvent<SetupCommand>('ramu:provider-terminal', { detail: { id: crypto.randomUUID(), title, command } }))
}

/** A regular interactive PTY, kept separate from project terminals and the Settings draft. */
export function ProviderSetupTerminal() {
  useLanguage()
  const [setup, setSetup] = useState<SetupCommand | null>(null)
  useEffect(() => {
    const open = (event: Event) => setSetup((event as CustomEvent<SetupCommand>).detail)
    window.addEventListener('ramu:provider-terminal', open)
    return () => window.removeEventListener('ramu:provider-terminal', open)
  }, [])
  return <Dialog open={!!setup} disablePointerDismissal onOpenChange={(open) => { if (!open) setSetup(null) }}><DialogContent className="provider-terminal-dialog" showCloseButton={false} aria-describedby={undefined} initialFocus={false}>
    <DialogTitle className="sr-only">{setup?.title ?? t("Provider setup terminal")}</DialogTitle>
    {setup && <TerminalView key={setup.id} taskId="provider-setup" repoId={null} label={setup.title} active initialCommand={setup.command} onExit={() => setSetup(null)} actions={<Button className="ghost icon small-icon" aria-label={t("Close setup terminal")} onClick={() => setSetup(null)}><X size={14} /></Button>} />}
  </DialogContent></Dialog>
}
