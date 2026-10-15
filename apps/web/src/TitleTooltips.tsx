import { useEffect, useId, useState } from 'react'
import { Tooltip } from '@/components/ui/tooltip'
import { AnchoredTooltip } from '@/components/anchored-tooltip'

interface Tip {
  text: string
  anchor: HTMLElement
  side: 'bottom' | 'right'
}

/** Adapts existing title attributes to the shared tooltip, including keyboard focus. */
export function TitleTooltips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const id = useId()
  useEffect(() => {
    let current: HTMLElement | null = null,
      original = '',
      description: string | null = null,
      timer: number | undefined
    const hide = () => {
      window.clearTimeout(timer)
      setTip(null)
      if (current) {
        if (original && !current.hasAttribute('title')) current.setAttribute('title', original)
        if (description === null) current.removeAttribute('aria-describedby')
        else current.setAttribute('aria-describedby', description)
      }
      current = null
      original = ''
      description = null
    }
    const over = (event: MouseEvent | FocusEvent) => {
      const target = event.target as Element | null
      const element = target?.closest?.('[title]') as HTMLElement | null
      if (current?.contains(target)) return
      hide()
      const text = element?.getAttribute('title')?.trim()
      if (!element || !text || element.closest('[data-slot="tooltip-trigger"]')) return
      // Focus from a click is not keyboard focus; a tip left behind by it would cover the next row.
      if (event.type === 'focusin' && !target?.matches(':focus-visible')) return
      current = element
      original = element.getAttribute('title') ?? ''
      description = element.getAttribute('aria-describedby')
      element.removeAttribute('title')
      const side = element.closest('.rail') ? 'right' : 'bottom'
      timer = window.setTimeout(
        () => {
          if (!element.isConnected || current !== element) return
          element.setAttribute('aria-describedby', [description, id].filter(Boolean).join(' '))
          setTip({ text, anchor: element, side })
        },
        event.type === 'focusin' ? 0 : side === 'right' ? 250 : 450,
      )
    }
    const out = (event: MouseEvent | FocusEvent) => {
      if (current && !(event.relatedTarget instanceof Node && current.contains(event.relatedTarget))) hide()
    }
    document.addEventListener('mouseover', over, true)
    document.addEventListener('mouseout', out, true)
    document.addEventListener('focusin', over, true)
    document.addEventListener('focusout', out, true)
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('mouseover', over, true)
      document.removeEventListener('mouseout', out, true)
      document.removeEventListener('focusin', over, true)
      document.removeEventListener('focusout', out, true)
      document.removeEventListener('mousedown', hide, true)
      document.removeEventListener('keydown', hide, true)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
      hide()
    }
  }, [id])
  return (
    <Tooltip open={!!tip}>
      {tip && (
        <AnchoredTooltip
          id={id}
          anchor={tip.anchor}
          side={tip.side}
          sideOffset={6}
          className="ramu-tooltip [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.45),_0_2px_8px_rgba(0,_0,_0,_0.25),_inset_0_1px_0_rgba(255,_255,_255,_0.07)] [&_>_svg]:hidden relative z-1300 max-w-[320px] p-[5px_9px] [border:1px_solid_var(--edge)] rounded-(--radius-s) [background:color-mix(in_srgb,_var(--raised)_80%,_transparent)] [-webkit-backdrop-filter:blur(24px)_saturate(1.6)] [backdrop-filter:blur(24px)_saturate(1.6)] [box-shadow:0_8px_24px_rgba(0,_0,_0,_0.4)] text-foreground text-caption leading-[16px] whitespace-pre-line pointer-events-none [animation:pop_0.1s_var(--ease)]"
        >
          {tip.text}
        </AnchoredTooltip>
      )}
    </Tooltip>
  )
}
