import type { ComponentProps } from 'react'
import './theme-recovery-button.css'

/** Intentionally native: recovery must never inherit a trial palette or a host Settings disabled context. */
export function ThemeRecoveryButton({
  variant = 'outline',
  ...props
}: Omit<ComponentProps<'button'>, 'style' | 'className'> & { variant?: 'outline' | 'solid' }) {
  return <button {...props} type="button" className="theme-recovery-button" data-variant={variant} />
}
