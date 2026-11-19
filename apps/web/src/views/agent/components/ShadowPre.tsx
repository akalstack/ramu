import { useLanguage } from '../../../i18n'
import { useScrollFade } from '../hooks/useScrollFade'

/** Preformatted text in a scroll area whose edges fade where more content lies beyond. */
export function ShadowPre({ children }: { children: React.ReactNode }) {
  useLanguage()
  const ref = useScrollFade<HTMLPreElement>()
  return (
    <pre
      ref={ref}
      className="tool-output p-[8px_10px] rounded-(--radius-s) text-soft max-h-[260px] overflow-auto m-[2px_0_6px_26px] [background:rgb(var(--ink)_/_0.03)] [border:1px_solid_transparent] fade-scroll [--fade-top:0px] [--fade-bottom:0px] [mask-image:linear-gradient(to_bottom,_transparent_0,_#000_var(--fade-top),_#000_calc(100%_-_var(--fade-bottom)),_transparent_100%)] [transition:--fade-top_0.14s_ease-out,_--fade-bottom_0.14s_ease-out] overflow-y-auto"
    >
      {children}
    </pre>
  )
}
