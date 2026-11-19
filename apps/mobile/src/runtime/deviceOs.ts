import { Platform } from 'react-native'
import * as Device from 'expo-device'
import type { DeviceOs } from '@ramu/shared/types'

/** What this phone or tablet runs on, as it tells each host it connects to so the host shows the right icon. */
export function thisDeviceOs(): DeviceOs {
  const tablet = Device.deviceType === Device.DeviceType.TABLET
  const os = Platform.OS === 'ios' ? (tablet ? 'ipados' : 'ios') : Platform.OS === 'android' ? 'android' : 'unknown'
  return {
    os,
    form: tablet ? 'tablet' : 'phone',
    ...(Device.osVersion ? { version: Device.osVersion.slice(0, 40) } : {}),
    ...(Device.modelName ? { model: Device.modelName.slice(0, 60) } : {}),
  }
}
