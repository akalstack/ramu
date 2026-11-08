// A Motion drawn on the host: timed scenes on one 16:9 stage, played once in order by CSS animations alone, with no
// script. Each scene's styles are scoped to it, and --scene-start tells its own animations when the scene begins.
import { ARTIFACT_SOURCE_FILES } from '@ramu/shared/artifacts'
import type { MotionSource } from '@ramu/shared/artifactSource'
import type { InteractiveFile } from '@ramu/shared/interactive'
import type { RenderedKind } from './kinds'

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** How long the scenes take together, in seconds. */
export const motionSeconds = (motion: MotionSource) => motion.scenes.reduce((total, scene) => total + scene.seconds, 0)

const FADE = 0.4

const AUDIO = /\.(?:mp3|wav|ogg|m4a)$/i

export function renderMotion(motion: MotionSource, title: string, files: InteractiveFile[] = []): RenderedKind {
  // The audio the motion names (music, scene sounds) is kept with the version; anything else in files is refused.
  const named = new Set([motion.music?.path, ...motion.scenes.map((scene) => scene.sound?.path)].filter(Boolean))
  const audio = files.filter((file) => file.encoding === 'base64' && AUDIO.test(file.path))
  const problems = [
    ...[...named]
      .filter((path) => !audio.some((file) => file.path === path))
      .map(
        (path) =>
          `${path} is not among the audio files in files. Send it with encoding base64, or as make_music's or make_sound's attachment.`,
      ),
    ...files
      .filter((file) => !audio.includes(file) && file.path !== ARTIFACT_SOURCE_FILES.motion)
      .map(
        (file) =>
          `${file.path} is not an MP3, WAV, OGG or M4A file sent with encoding base64. A motion's files are its audio.`,
      ),
  ]
  const total = motionSeconds(motion)
  let start = 0
  const scenes = motion.scenes.map((scene, index) => {
    const from = start
    start += scene.seconds
    const last = index === motion.scenes.length - 1
    // Each scene fades in at its start and out at its end; the last one stays when the motion finishes.
    const at = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / total) * 100)).toFixed(3)}%`
    const keyframes =
      `@keyframes ramu-scene-${index}{0%{opacity:0;visibility:hidden}` +
      `${at(from)}{opacity:0;visibility:visible}${at(from + Math.min(FADE, scene.seconds / 4))}{opacity:1;visibility:visible}` +
      (last
        ? '100%{opacity:1;visibility:visible}}'
        : `${at(start - Math.min(FADE, scene.seconds / 4))}{opacity:1;visibility:visible}${at(start)}{opacity:0;visibility:hidden}100%{opacity:0;visibility:hidden}}`)
    const css = scene.css ? `@scope ([data-ramu-scene="${index}"]) {${scene.css.replace(/<\//g, '<\\/')}}` : ''
    return {
      style: `${keyframes}[data-ramu-scene="${index}"]{animation:ramu-scene-${index} ${total}s linear forwards;--scene-start:${from}s}${css}`,
      html: `<section class="ramu-scene" data-ramu-scene="${index}" aria-label="Scene ${index + 1} of ${motion.scenes.length}">${scene.html}</section>`,
    }
  })
  return {
    html:
      `<style>.ramu-motion{position:relative;width:100%;max-width:1280px;margin:0 auto;aspect-ratio:16/9;overflow:hidden;background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:8px;font-family:var(--font-sans)}` +
      `.ramu-scene{position:absolute;inset:0;opacity:0;visibility:hidden}@media (prefers-reduced-motion:reduce){.ramu-scene{animation:none!important;opacity:0;visibility:hidden}.ramu-scene:first-child{opacity:1;visibility:visible}}` +
      `${scenes.map((scene) => scene.style).join('')}</style>` +
      `<div class="ramu-motion" role="region" aria-label="${escapeHtml(title)}, ${total} seconds">${scenes.map((scene) => scene.html).join('')}</div>`,
    files: [
      {
        path: ARTIFACT_SOURCE_FILES.motion,
        content: JSON.stringify({ scenes: motion.scenes, ...(motion.music ? { music: motion.music } : {}) }),
      },
      ...audio
        .filter((file) => named.has(file.path))
        .map(({ path, content }) => ({ path, content, encoding: 'base64' as const })),
    ],
    problems: problems.slice(0, 20),
  }
}
