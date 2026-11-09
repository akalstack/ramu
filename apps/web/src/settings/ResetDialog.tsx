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
import { t } from '../i18n'
import { SETTINGS_SECTIONS, type SettingsSection } from './SettingsPage'

export type ResetTarget = SettingsSection | 'models' | 'sizes'

export function ResetDialog({
  reset,
  onCancel,
  onConfirm,
}: {
  reset: ResetTarget | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog
      open={reset !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {reset === 'sizes'
              ? t('Reset layout sizes?')
              : reset
                ? t('Reset {0} to defaults?', {
                    '0': t(
                      reset === 'models' ? 'Model sets' : SETTINGS_SECTIONS.find((entry) => entry.id === reset)!.label,
                    ),
                  })
                : ''}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {reset === 'sizes'
              ? t(
                  'The sidebar width, editor/thread split and terminal height go back to default in every workspace. This applies right away.',
                )
              : t(
                  'This replaces your changes in this section with the default settings. Choose Save changes to apply them.',
                )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t('Reset')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
