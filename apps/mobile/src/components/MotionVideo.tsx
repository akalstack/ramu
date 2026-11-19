export interface MotionVideoProps {
  computerId: string
  artifactId: string
  version: number
  title: string
  onError: (message: string) => void
}

/** The browser companion plays a motion in its frame; the native video is for the phone apps. */
export default function MotionVideo(_props: MotionVideoProps) {
  return null
}
