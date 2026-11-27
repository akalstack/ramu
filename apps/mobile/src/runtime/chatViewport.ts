/** Native prompts and Control Center report inactive without suspending the app. */
export function appForeground(previous: boolean, next: string): boolean {
  return next === 'inactive' ? previous : next === 'active'
}
