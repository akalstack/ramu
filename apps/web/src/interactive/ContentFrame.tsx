import { forwardRef } from 'react'

/** Every desktop document uses the same capability-free frame boundary. */
export const ContentFrame = forwardRef<
  HTMLIFrameElement,
  { url: string; title: string; ready: boolean; onLoad(): void }
>(function ContentFrame({ url, title, ready, onLoad }, ref) {
  return (
    <iframe
      ref={ref}
      key={url}
      aria-label={title}
      onLoad={onLoad}
      sandbox="allow-scripts"
      // A game may go fullscreen and read a gamepad; nothing else is delegated to the frame.
      allow="fullscreen; gamepad"
      allowFullScreen
      src={url}
      className="absolute inset-0 block size-full border-0 transition-opacity duration-150 motion-reduce:transition-none"
      style={{ opacity: ready ? 1 : 0 }}
    />
  )
})
