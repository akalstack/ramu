import { Redirect, useLocalSearchParams } from 'expo-router'

/** `ramu://page/…` links from share links and home-screen icons made before artifacts open the artifact screen. */
export default function PageLinkRedirect() {
  const { computer, id, share } = useLocalSearchParams<{ computer: string; id: string; share?: string }>()
  return (
    <Redirect
      href={{
        pathname: '/artifact/[computer]/[id]',
        params: { computer: String(computer), id: String(id), ...(share ? { share: String(share) } : {}) },
      }}
    />
  )
}
