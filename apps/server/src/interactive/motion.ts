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
const VIDEO = /\.(?:mp4|webm)$/i

export function renderMotion(motion: MotionSource, title: string, files: InteractiveFile[] = []): RenderedKind {
  // The audio and clips the motion names (music, scene sounds and voices, scene videos) are kept with the version;
  // anything else in files is refused.
  const named = new Set(
    [
      motion.music?.path,
      ...motion.scenes.flatMap((scene) => [scene.sound?.path, scene.voice?.path, scene.video?.path]),
    ].filter(Boolean),
  )
  const audio = files.filter((file) => file.encoding === 'base64' && (AUDIO.test(file.path) || VIDEO.test(file.path)))
  const problems = [
    ...[...named]
      .filter((path) => !audio.some((file) => file.path === path))
      .map(
        (path) =>
          `${path} is not among the files. Send it with encoding base64, or as make_music's, make_sound's, speak's or make_video's attachment.`,
      ),
    ...files
      .filter((file) => !audio.includes(file) && file.path !== ARTIFACT_SOURCE_FILES.motion)
      .map(
        (file) =>
          `${file.path} is not an MP3, WAV, OGG, M4A, MP4 or WebM file sent with encoding base64. A motion's files are its audio and clips.`,
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
    // A clip fills the scene behind its html. It carries its scene's start and length so the frame's player and the
    // exported video can put it at the timeline's moment; its sound is mixed into the export, never played here.
    const clip = scene.video && audio.find((file) => file.path === scene.video!.path)
    const video = clip
      ? `<video class="ramu-scene-video" src="data:video/${/\.webm$/i.test(clip.path) ? 'webm' : 'mp4'};base64,${clip.content}" muted playsinline preload="auto" aria-hidden="true" data-ramu-start="${from}" data-ramu-seconds="${scene.seconds}"></video>`
      : ''
    return {
      style: `${keyframes}[data-ramu-scene="${index}"]{animation:ramu-scene-${index} ${total}s linear forwards;--scene-start:${from}s}${css}`,
      html: `<section class="ramu-scene" data-ramu-scene="${index}" aria-label="Scene ${index + 1} of ${motion.scenes.length}">${video ? `${video}<div class="ramu-scene-over">${scene.html}</div>` : scene.html}</section>`,
    }
  })
  return {
    html:
      `<style>.ramu-motion{position:relative;width:100%;max-width:1280px;margin:0 auto;aspect-ratio:16/9;overflow:hidden;background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:8px;font-family:var(--font-sans)}` +
      `.ramu-scene{position:absolute;inset:0;opacity:0;visibility:hidden}.ramu-scene-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.ramu-scene-over{position:absolute;inset:0}@media (prefers-reduced-motion:reduce){.ramu-scene{animation:none!important;opacity:0;visibility:hidden}.ramu-scene:first-child{opacity:1;visibility:visible}}` +
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
