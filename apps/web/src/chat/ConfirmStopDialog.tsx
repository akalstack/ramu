import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { t, useLanguage } from '../i18n'

/** Stopping a background command ends its process, so it is confirmed first; `force` skips the command's own cleanup. */
export function ConfirmStopDialog({
  command,
  force = false,
  onCancel,
  onConfirm,
}: {
  /** The command being stopped; the dialog is closed while this is null. */
  command: string | null
  force?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useLanguage()
  return (
    <AlertDialog open={command !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{force ? t('Force stop this command?') : t('Stop this command?')}</AlertDialogTitle>
          <AlertDialogDescription>
            <code className="break-all">{command}</code>
            <br />
            {force
              ? t('It stops at once without cleaning up. Unsaved work in the command is lost.')
              : t('The command stops. Anything unfinished is lost.')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {force ? t('Force stop') : t('Stop')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
