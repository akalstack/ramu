import { t } from '../i18n'

/** App-authored sample HTML, executed only inside the isolated document renderer. */
export function interactiveThemeSample() {
  const text = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    )
  return `<label>${text(t('Quantity'))} <input id="quantity" aria-label="${text(t('Quantity'))}" type="range" min="1" max="10" value="3"></label>
<svg role="img" aria-label="${text(t('Quantity chart'))}" viewBox="0 0 240 48" style="display:block;width:100%;height:48px"><rect id="bar" x="0" y="4" width="72" height="12" fill="var(--chart-1)"/><rect x="0" y="20" width="144" height="12" fill="var(--chart-2)"/><rect x="0" y="36" width="216" height="12" fill="var(--chart-3)"/></svg>
<output id="total" style="display:block;margin-block:8px;color:var(--primary)">3</output>
<button type="button" id="increment">${text(t('Add one'))}</button>
<p style="color:var(--muted);margin-block:8px">${text(t('Try a control, then change a theme color.'))}</p>
<script>const input=document.querySelector('input'),output=document.querySelector('output');function update(){output.textContent=input.value;document.querySelector('#bar').setAttribute('width',Number(input.value)*24)}input.addEventListener('input',update);document.querySelector('button').onclick=()=>{input.value=Math.min(10,Number(input.value)+1);input.dispatchEvent(new Event('input',{bubbles:true}))};update();</script>`
}
