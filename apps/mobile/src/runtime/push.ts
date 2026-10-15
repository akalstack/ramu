import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
export async function registerPush(): Promise<string> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  if (Platform.OS === 'web' || !Device.isDevice || Constants.appOwnership === 'expo' || !projectId)
    throw new Error(
      'Background alerts need a physical phone, a signed development build, and an Expo projectId with APNs/FCM credentials. In-app alerts work now.',
    )
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Ramu',
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  let permission = await Notifications.getPermissionsAsync()
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync()
  if (!permission.granted)
    throw new Error('Notification permission was not granted. Enable it in phone settings to receive alerts.')
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data
}
