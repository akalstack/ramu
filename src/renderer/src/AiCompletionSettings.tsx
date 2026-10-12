import { t, useLanguage } from './i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useCallback, useEffect, useState } from 'react'
import type { AiCompletionPreferences, CompletionStatus, OllamaModelOption, PullProgress } from '../../shared/types'
import { invoke, ramu } from './ipc'
import { Dropdown } from './Menu'
import { errorText } from './TaskPane'

const CUSTOM = '__custom__'
const FIT: Record<OllamaModelOption['fit'], string> = { recommended: 'Recommended', fits: 'Fits', tight: 'May be slow', 'too-large': 'Too large' }
const size = (gb: number) => gb ? `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB` : ''

export function AiCompletionSettings({ value, onChange, busy }: { value: AiCompletionPreferences; onChange: (value: AiCompletionPreferences) => void; busy: boolean }) {
  useLanguage()
  const [status, setStatus] = useState<CompletionStatus | null>(null)
  const [key, setKey] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [pull, setPull] = useState<PullProgress | null>(null)
  const [custom, setCustom] = useState(false)
  const refresh = useCallback(() => { void invoke('completion.status').then(setStatus, () => setStatus(null)) }, [])
  useEffect(() => { if (value.enabled) refresh() }, [value.enabled, refresh])
  useEffect(() => ramu.on('completion:pull', (progress) => { setPull(progress.done ? (progress.error ? progress : null) : progress); if (progress.done) refresh() }), [refresh])
  const saveKey = async (next: string | null) => {
    setMessage(null)
    try { await invoke('completion.setKey', next); setKey(''); refresh() } catch (reason) { setMessage(errorText(reason)) }
  }
  const install = (model: string) => { setPull({ model, status: 'starting', completed: 0, total: 0, done: false, error: null }); void invoke('completion.pull', model).catch((reason) => setPull({ model, status: '', completed: 0, total: 0, done: true, error: errorText(reason) })) }

  const options = status?.options ?? []
  const effective = value.ollamaModel || status?.recommended || ''
  const selected = options.find((option) => option.id === effective)
  const showCustom = custom || (!!value.ollamaModel && !!status && !selected)
  const hardware = status?.hardware
  const keyHostNote = status?.keyHost ? `Keys are saved for ${new URL(status.keyHost).host}. Save settings first if you changed the endpoint.` : null
  const recommendedOption = options.find((option) => option.id === status?.recommended)
  const modelOptions = [
    { value: '', label: recommendedOption ? t("Recommended for this device · {0}", { "0": recommendedOption.label }) : t("Recommended for this device") },
    ...options.map((option) => ({ value: option.id, label: `${option.label}${option.curated ? ` · ${size(option.sizeGb)} · ${FIT[option.fit]}` : ''}${option.installed ? ' · Installed' : ''}` })),
    { value: CUSTOM, label: t("Other model…") },
  ]
  return <>
    <div className="settings-row settings-toggle"><span><strong>{t("AI inline completion")}</strong><span className="muted block small">{t("Suggest the next lines as grey text. Press Tab to accept. Off by default.")}</span></span><Switch aria-label={t("AI inline completion")} checked={value.enabled} disabled={busy} onCheckedChange={(enabled) => onChange({ ...value, enabled })} /></div>
    {value.enabled && <>
      <div className="settings-row"><span><strong>{t("Completion provider")}</strong><span className="muted block small">{value.provider === 'ollama' ? t("Runs on this device. Your code is not sent anywhere.") : t("Sends the code around your cursor to Mistral. Free keys are rate limited, so check Mistral's current terms before using it for work code.")}</span></span><Dropdown label={t("Completion provider")} value={value.provider} options={[{ value: 'ollama', label: t("Ollama · Local") }, { value: 'codestral', label: 'Codestral · Mistral' }]} onChange={(provider) => onChange({ ...value, provider: provider as AiCompletionPreferences['provider'] })} /></div>
      {value.provider === 'ollama' && <>
        {hardware && <p className="muted small">{t("This device: ")}{hardware.chip} · {hardware.memoryGb} GB {hardware.unifiedMemory ? t("unified memory") : t("memory")}{hardware.gpu ? ` · ${hardware.gpu} (${hardware.gpuMemoryGb} GB)` : ''}{t(". Larger models suggest better code but answer more slowly and use more memory.")}</p>}
        <div className="settings-row"><span><strong>{t("Local model")}</strong><span className="muted block small">{selected ? `${selected.note}${selected.curated ? ` ${FIT[selected.fit]} on this device.` : ''}` : t("Use a base (fill-in-the-middle) model. Instruct models complete code poorly.")}</span></span>
          <Dropdown label={t("Local model")} value={showCustom ? CUSTOM : value.ollamaModel} options={modelOptions} disabled={busy || !status} onChange={(next) => { if (next === CUSTOM) { setCustom(true); return } setCustom(false); onChange({ ...value, ollamaModel: next }) }} /></div>
        {showCustom && <div className="settings-row"><span><strong>{t("Model name")}</strong><span className="muted block small">{t("The exact name Ollama uses, such as qwen2.5-coder:3b-base.")}</span></span><Input aria-label={t("Custom model name")} value={value.ollamaModel} placeholder="model:tag" disabled={busy} onChange={(event) => onChange({ ...value, ollamaModel: event.target.value.trim() })} /></div>}
        {status && !status.ollama.running && <p className="muted small">{t("Ollama is not running. Install it from ollama.com, then start it with `ollama serve`.")}</p>}
        {status?.ollama.running && effective && !status.ollama.models.includes(effective) && !pull && <p className="small"><span className="muted">{effective} {t(" is not installed. ")}</span><Button disabled={busy} onClick={() => install(effective)}>{t("Install")}{selected?.sizeGb ? ` (${size(selected.sizeGb)})` : ''}</Button></p>}
        {pull && !pull.error && <p className="small" role="status"><progress aria-label={t("Installing {0}", { "0": pull.model })} max={pull.total || undefined} value={pull.total ? pull.completed : undefined} /> <span className="muted">{t("Installing ")}{pull.model}{pull.total ? ` · ${Math.round(pull.completed / pull.total * 100)}%` : ''}</span> <Button onClick={() => void invoke('completion.cancelPull', pull.model)}>{t("Cancel")}</Button></p>}
        {pull?.error && <p className="small error" role="alert">{t("Could not install ")}{pull.model}: {pull.error}</p>}
        {status?.ollama.running && effective && status.ollama.models.includes(effective) && <p className="muted small">{effective} {t(" is installed and ready.")}</p>}
        <p className="muted small">{t("Next edit suggestions (predicting your follow-up change) need Codestral. A local model good enough for them needs 7B or more, and took several seconds per prediction in testing.")}</p>
      </>}
      {value.provider === 'codestral' && <>
        <div className="settings-row"><span><strong>Model</strong><span className="muted block small">{t("Model name sent to the provider.")}</span></span><Input aria-label={t("Codestral model")} value={value.codestralModel} placeholder="codestral-latest" disabled={busy} onChange={(event) => onChange({ ...value, codestralModel: event.target.value })} /></div>
        <div className="settings-row"><span><strong>Endpoint</strong><span className="muted block small">{t("Where the key is sent. Must be https.")}</span></span><Input aria-label={t("Codestral endpoint")} value={value.codestralUrl} disabled={busy} onChange={(event) => onChange({ ...value, codestralUrl: event.target.value })} /></div>
        <div className="settings-row"><span><strong>{t("API key")}</strong><span className="muted block small">{status?.hasKey ? t("A key is saved in your system keychain.") : t("Stored in your system keychain, never in settings.")}</span></span>
          <span className="settings-inline"><Input type="password" aria-label={t("Codestral API key")} autoComplete="off" value={key} placeholder={status?.hasKey ? '••••••••' : t("Paste key")} disabled={busy} onChange={(event) => setKey(event.target.value)} />
            <Button disabled={busy || key.trim().length < 8} onClick={() => void saveKey(key.trim())}>{t("Save key")}</Button>{status?.hasKey && <Button disabled={busy} onClick={() => void saveKey(null)}>{t("Remove")}</Button>}</span></div>
        {(message || keyHostNote) && <p className={`small ${message ? 'error' : 'muted'}`} role={message ? 'alert' : undefined}>{message ?? keyHostNote}</p>}
        <div className="settings-row settings-toggle"><span><strong>{t("Next edit suggestions")}</strong><span className="muted block small">{t("After you change something, predict the follow-up (the same rename elsewhere, the next line of a pattern) and show it as a diff. Tab accepts it.")}</span></span><Switch aria-label={t("Next edit suggestions")} checked={value.nextEdit} disabled={busy} onCheckedChange={(nextEdit) => onChange({ ...value, nextEdit })} /></div>
        {value.nextEdit && <div className="settings-row settings-toggle"><span><strong>{t("Allow Codestral to read my code")}</strong><span className="muted block small">{t("Each time you pause after editing, Ramu sends the file you are editing (up to about 120 lines around your cursor) and your recent edits to Mistral. Files such as .env and keys are never sent. Suggestions stay off until you allow this.")}</span></span><Switch aria-label={t("Allow Codestral to read my code")} checked={value.nextEditAck} disabled={busy} onCheckedChange={(nextEditAck) => onChange({ ...value, nextEditAck })} /></div>}
      </>}
    </>}
  </>
}
