import { Alert } from 'react-native'

/** Clearing ends what may be hours of automatic work and cannot be undone, so the phone asks first, as the desktop does. */
export function confirmClearGoal(say: (text: string) => string, clear: () => void): void {
  Alert.alert(
    say('Clear this goal?'),
    say('The thread stops working toward it on its own. Its messages and changes stay; start another with /goal.'),
    [
      { text: say('Cancel'), style: 'cancel' },
      { text: say('Clear goal'), style: 'destructive', onPress: clear },
    ],
  )
}
