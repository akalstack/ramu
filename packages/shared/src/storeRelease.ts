// What the app stores need from an Expo app before a release, read from app.json and eas.json, and the words both
// clients use for it. Pure: the server reads the files and passes them in.
import type { Translate } from './forgeStatus'
import type { StoreCheck, StoreCheckId, StorePlatform, StoreTarget } from './types/deploy'

/** The build and submit profile Release uses. */
export const RELEASE_PROFILE = 'production'

/** The eas.json Ramu proposes: build numbers kept by EAS and raised on every build, Android to the internal track. */
export const EAS_JSON = `${JSON.stringify(
  {
    cli: { version: '>= 16.0.0', appVersionSource: 'remote' },
    build: {
      preview: { distribution: 'internal' },
      [RELEASE_PROFILE]: { autoIncrement: true },
    },
    submit: { [RELEASE_PROFILE]: { android: { track: 'internal' } } },
  },
  null,
  2,
)}\n`

/**
 * iOS asks for a sentence naming why the app uses each of these; App Review rejects a missing or generic one. Keyed by
 * the Expo library that needs it.
 */
const USAGE_KEYS: Record<string, string[]> = {
  'expo-camera': ['NSCameraUsageDescription'],
  'expo-image-picker': ['NSPhotoLibraryUsageDescription', 'NSCameraUsageDescription'],
  'expo-media-library': ['NSPhotoLibraryUsageDescription'],
  'expo-location': ['NSLocationWhenInUseUsageDescription'],
  'expo-contacts': ['NSContactsUsageDescription'],
  'expo-calendar': ['NSCalendarsUsageDescription'],
  'expo-audio': ['NSMicrophoneUsageDescription'],
  'expo-av': ['NSMicrophoneUsageDescription'],
  'expo-tracking-transparency': ['NSUserTrackingUsageDescription'],
  'expo-local-authentication': ['NSFaceIDUsageDescription'],
  'expo-sensors': ['NSMotionUsageDescription'],
}

/** Which store a check matters for; null for both. */
const CHECK_PLATFORM: Partial<Record<StoreCheckId, StorePlatform>> = {
  'ios-bundle': 'ios',
  'ios-app': 'ios',
  'ios-privacy': 'ios',
  'android-package': 'android',
  'android-track': 'android',
}

export interface StoreFacts {
  /** app.json as parsed, or null when there is none. */
  appJson: unknown
  /** eas.json as parsed, or null when there is none. */
  easJson: unknown
  /** `app.config.js` or `app.config.ts`, when the app computes its configuration in code. */
  dynamicConfig: string | null
  /** The app's dependencies from package.json. */
  dependencies: string[]
  /** Whether the icon app.json names is a file in the repository. */
  iconExists: boolean
}

type Json = Record<string, unknown>
const record = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null

/** The `expo` section of app.json, or the whole file when it has none. */
export function expoConfig(appJson: unknown): Json {
  const root = record(appJson)
  return 'expo' in root ? record(root.expo) : root
}

/** The EAS project the app is linked to, from `extra.eas.projectId`. */
export const easProjectId = (appJson: unknown): string | null =>
  text(record(record(expoConfig(appJson).extra).eas).projectId)

/** The usage keys the app's libraries need, with whether app.json gives each its own sentence. */
function privacy(expo: Json, dependencies: string[]): StoreCheck {
  const infoPlist = record(record(expo.ios).infoPlist)
  const plugins = Array.isArray(expo.plugins) ? expo.plugins : []
  /** A plugin entry with options that hold a sentence, such as `["expo-camera", { "cameraPermission": "…" }]`. */
  const worded = (library: string) =>
    plugins.some(
      (entry) =>
        Array.isArray(entry) &&
        entry[0] === library &&
        Object.values(record(entry[1])).some((value) => typeof value === 'string' && /\s/.test(value.trim())),
    )
  const listed = (library: string) =>
    plugins.some((entry) => entry === library || (Array.isArray(entry) && entry[0] === library))
  const missing = new Set<string>()
  const generic = new Set<string>()
  for (const library of dependencies) {
    for (const key of USAGE_KEYS[library] ?? []) {
      if (text(infoPlist[key]) || worded(library)) continue
      if (listed(library)) generic.add(key)
      else missing.add(key)
    }
  }
  for (const key of missing) generic.delete(key)
  if (missing.size) return { id: 'ios-privacy', state: 'missing', detail: [...missing].join(', ') }
  if (generic.size) return { id: 'ios-privacy', state: 'warning', detail: [...generic].join(', ') }
  return { id: 'ios-privacy', state: 'ok', detail: null }
}

const IOS_BUNDLE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/

/** Every check, in the order the sheet lists them. */
export function storeChecks(facts: StoreFacts): StoreCheck[] {
  const checks: StoreCheck[] = []
  const eas = record(facts.easJson)
  const build = record(record(eas.build)[RELEASE_PROFILE])
  const submit = record(record(eas.submit)[RELEASE_PROFILE])
  checks.push(
    facts.easJson === null
      ? { id: 'eas-json', state: 'missing', detail: null }
      : Object.keys(build).length || RELEASE_PROFILE in record(eas.build)
        ? { id: 'eas-json', state: 'ok', detail: null }
        : { id: 'eas-json', state: 'missing', detail: RELEASE_PROFILE },
  )
  if (facts.dynamicConfig) checks.push({ id: 'dynamic-config', state: 'warning', detail: facts.dynamicConfig })
  if (facts.appJson === null) return checks
  const expo = expoConfig(facts.appJson)
  const ios = record(expo.ios)
  const android = record(expo.android)
  const projectId = easProjectId(facts.appJson)
  checks.push({ id: 'eas-project', state: projectId ? 'ok' : 'missing', detail: projectId })
  const bundle = text(ios.bundleIdentifier)
  checks.push({ id: 'ios-bundle', state: bundle && IOS_BUNDLE.test(bundle) ? 'ok' : 'missing', detail: bundle })
  const pkg = text(android.package)
  checks.push({ id: 'android-package', state: pkg && ANDROID_PACKAGE.test(pkg) ? 'ok' : 'missing', detail: pkg })
  const icon = text(expo.icon)
  checks.push({ id: 'icon', state: icon && facts.iconExists ? 'ok' : 'missing', detail: icon })
  const version = text(expo.version)
  checks.push({ id: 'version', state: version ? 'ok' : 'missing', detail: version })
  const managed = record(eas.cli).appVersionSource === 'remote' || build.autoIncrement === true
  checks.push({
    id: 'build-number',
    state: managed ? 'ok' : 'warning',
    detail: managed ? null : [text(ios.buildNumber), text(android.versionCode)].filter(Boolean).join(' / ') || null,
  })
  const ascAppId = text(record(submit.ios).ascAppId)
  checks.push({ id: 'ios-app', state: ascAppId ? 'ok' : 'missing', detail: ascAppId })
  const track = text(record(submit.android).track)
  checks.push({ id: 'android-track', state: !track || track === 'internal' ? 'ok' : 'missing', detail: track })
  checks.push(privacy(expo, facts.dependencies))
  return checks
}

/** The checks that stop a release of `target`: missing ones that matter for its platforms. */
export function blockingChecks(checks: StoreCheck[], target: StoreTarget): StoreCheck[] {
  return checks.filter((check) => {
    if (check.state !== 'missing') return false
    const platform = CHECK_PLATFORM[check.id]
    return !platform || target === 'all' || platform === target
  })
}

/** What only the person can do, on the stores' own sites. English; pass through `t()`. */
export const STORE_PERSON_STEPS = [
  'Enroll in the Apple Developer Program (a yearly fee) with the Apple account that publishes the app.',
  'Create the app in App Store Connect with the same bundle identifier, and put its Apple ID in eas.json as submit.production.ios.ascAppId.',
  'Run the first iOS build once in a terminal (eas build --platform ios) and sign in to Apple there, so EAS creates the signing certificate and profile. Later releases reuse them.',
  'Create the app in Google Play Console with the same package name.',
  'Upload the first Android build to Play Console by hand: Google accepts uploads through its API only after that.',
  'Give EAS a Google service account key for submissions (eas credentials, then Android, then Google Service Account).',
  'Invite testers in TestFlight and in Play’s internal testing, fill in each store listing, and submit for review on each store when you are ready. Ramu never submits for review.',
] as const

/** Words for a check, shared by the Deploy sheet and the agent's status. */
export function storeCheckText(t: Translate, check: StoreCheck): string {
  const detail = check.detail ?? ''
  const ok = check.state === 'ok'
  switch (check.id) {
    case 'eas-json':
      return ok
        ? t('eas.json has a {0} build profile', { 0: RELEASE_PROFILE })
        : detail
          ? t('eas.json has no {0} build profile', { 0: RELEASE_PROFILE })
          : t('No eas.json: EAS needs one to build')
    case 'dynamic-config':
      return t('{0} computes the configuration in code; these checks read app.json only', { 0: detail })
    case 'eas-project':
      return ok
        ? t('Linked to EAS project {0}', { 0: detail })
        : t('Not linked to an EAS project: an agent can run eas init to link it')
    case 'ios-bundle':
      return ok
        ? t('iOS bundle identifier {0}', { 0: detail })
        : t('No iOS bundle identifier (ios.bundleIdentifier, such as com.example.app)')
    case 'android-package':
      return ok
        ? t('Android package {0}', { 0: detail })
        : t('No Android package name (android.package, such as com.example.app)')
    case 'icon':
      return ok
        ? t('App icon {0}', { 0: detail })
        : detail
          ? t('The app icon {0} is not in the repository', { 0: detail })
          : t('No app icon (icon, a 1024×1024 PNG)')
    case 'version':
      return ok ? t('Version {0}', { 0: detail }) : t('No version (version, such as 1.0.0)')
    case 'build-number':
      return ok
        ? t('EAS raises the build number on every build')
        : t(
            'Build numbers are set by hand; the stores refuse a number they already have. Set autoIncrement in eas.json',
          )
    case 'ios-app':
      return ok
        ? t('App Store Connect app {0}', { 0: detail })
        : t('No App Store Connect app in eas.json (submit.production.ios.ascAppId)')
    case 'android-track':
      return ok
        ? t('Android goes to Play’s internal testing track')
        : t('eas.json submits Android to the {0} track; Release submits to the internal track only', { 0: detail })
    case 'ios-privacy':
      return ok
        ? t('iOS permission texts are set')
        : check.state === 'warning'
          ? t('iOS permission texts use the library’s generic wording, which App Review can reject: {0}', {
              0: detail,
            })
          : t('iOS permission texts are missing, which App Review rejects: {0}', { 0: detail })
  }
}
