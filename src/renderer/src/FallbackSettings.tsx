import { t, useLanguage } from './i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { invoke } from './ipc'
import type { AdvisorPreferences, AgentModel, AgentProvider, AppPreferences, FallbackStep, ProviderCatalog, SubagentPreferences, SwitchThreshold, UsageReading } from '../../shared/types'
import { providerName } from '../../shared/providers'
import { Dropdown } from './Menu'
import { effortDisplayName, modelDisplayName, useModelSets } from './ModelSets'
import { ProviderIcon } from './ProviderIcon'
import { peakUsage, usageTone, useUsage } from './Usage'
import { defaultChain } from '../../shared/routing'

const NATIVE = '__native'
const newId = () => crypto.randomUUID()

function stepFor(model: AgentModel, previous?: FallbackStep | null): FallbackStep {
  return { id: previous?.id ?? newId(), provider: model.provider, model: model.id, effort: previous?.effort && model.efforts.includes(previous.effort) ? previous.effort : model.defaultEffort, serviceTier: model.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority') ? previous?.serviceTier ?? 'standard' : 'standard' }
}

function UsageHint({ provider, usage }: { provider: AgentProvider; usage: UsageReading[] }) {
  useLanguage()
  const peak = peakUsage(usage, provider)
  if (!peak) return null
  return <span className={`fallback-usage ${usageTone(peak)}`} title={t("Highest usage window for {0}", { "0": providerName(provider) })}>{peak.status === 'limited' ? t("Limited") : `${peak.usedPercent}%`}</span>
}

/** Model, effort and (for Codex) speed for one step, built from the installed providers' catalogues. */
function StepPicker({ label, step, onChange, allowNative = false, disabled }: { label: string; step: FallbackStep | null; onChange: (step: FallbackStep | null) => void; allowNative?: boolean; disabled?: boolean }) {
  useLanguage()
  const { catalogs } = useModelSets()
  const models = catalogs.flatMap((catalog) => catalog.models)
  const model = step ? models.find((entry) => entry.provider === step.provider && (entry.id === step.model || !step.model && entry.isDefault)) : undefined
  const key = step ? `${step.provider}:${step.model}` : NATIVE
  const options = [...(allowNative ? [{ value: NATIVE, label: t("Native") }] : []), ...models.map((entry) => ({ value: `${entry.provider}:${entry.id}`, label: `${modelDisplayName(entry.name)} · ${providerName(entry.provider)}` }))]
  if (step && !options.some((option) => option.value === key)) options.unshift({ value: key, label: step.model ? t("{0} · Unavailable", { "0": step.model }) : t("{0} default", { "0": providerName(step.provider) }) })
  const fast = !!model?.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority')
  return <div className={`fallback-step-picker${step && fast ? ' with-tier' : ''}`}>
    <Dropdown label={t("{0} model", { "0": label })} value={key} options={options} disabled={disabled} onChange={(value) => { if (value === NATIVE) return onChange(null); const entry = models.find((m) => `${m.provider}:${m.id}` === value); if (entry) onChange(stepFor(entry, step)) }} />
    {step && <Dropdown label={t("{0} effort", { "0": label })} value={step.effort ?? ''} disabled={disabled || !model?.efforts.length} options={[...(model?.defaultEffort ? [] : [{ value: '', label: t("Default effort") }]), ...(model?.efforts ?? []).map((effort) => ({ value: effort, label: effortDisplayName(effort, step.provider) }))]} onChange={(effort) => onChange({ ...step, effort: model?.efforts.find((entry) => entry === effort) ?? null })} />}
    {step && fast && <Dropdown label={t("{0} speed", { "0": label })} value={step.serviceTier ?? 'standard'} disabled={disabled} options={[{ value: 'standard', label: t("Standard") }, { value: 'fast', label: t("Fast") }]} onChange={(tier) => onChange({ ...step, serviceTier: tier === 'fast' ? 'fast' : 'standard' })} />}
  </div>
}

/** An ordered list of steps to continue with when `provider` is limited. */
function ChainEditor({ provider, chain, onChange, onCopy, disabled }: { provider: AgentProvider; chain: FallbackStep[]; onChange: (chain: FallbackStep[]) => void; onCopy?: () => void; disabled?: boolean }) {
  useLanguage()
  const usage = useUsage()
  const { catalogs } = useModelSets()
  const move = (index: number, delta: number) => { const next = [...chain]; const [moved] = next.splice(index, 1); next.splice(index + delta, 0, moved!); onChange(next) }
  const add = () => { const used = new Set(chain.map((step) => `${step.provider}:${step.model}`)); const model = catalogs.flatMap((catalog) => catalog.models).find((entry) => entry.provider !== provider && !used.has(`${entry.provider}:${entry.id}`)) ?? catalogs.flatMap((catalog) => catalog.models)[0]; if (model) onChange([...chain, stepFor(model)]) }
  return <section className="fallback-chain">
    <header className="fallback-chain-heading"><ProviderIcon provider={provider} size={14} /><span>{t("When ")}<strong>{providerName(provider)}</strong> {t(" is limited, continue with")}</span><UsageHint provider={provider} usage={usage} /><span className="grow" />{onCopy && <Button className="ghost small" disabled={disabled} onClick={onCopy}><Copy size={12} />{t("Copy from main")}</Button>}</header>
    {chain.length === 0 && <p className="muted small fallback-empty">{t("No fallback. The chat stops at the limit.")}</p>}
    {chain.map((step, index) => <div className="fallback-row" key={step.id}>
      <span className="settings-step-number">{index + 1}</span>
      <StepPicker label={t("{0} fallback {1}", { "0": providerName(provider), "1": index + 1 })} step={step} disabled={disabled} onChange={(next) => next && onChange(chain.map((entry) => entry.id === step.id ? next : entry))} />
      <UsageHint provider={step.provider} usage={usage} />
      <span className="settings-step-actions">
        <Button className="ghost icon small-icon" aria-label={t("Move fallback {0} up", { "0": index + 1 })} title={t("Move up")} disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></Button>
        <Button className="ghost icon small-icon" aria-label={t("Move fallback {0} down", { "0": index + 1 })} title={t("Move down")} disabled={disabled || index === chain.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></Button>
        <Button className="ghost icon small-icon" aria-label={t("Remove fallback {0}", { "0": index + 1 })} title={t("Remove")} disabled={disabled} onClick={() => onChange(chain.filter((entry) => entry.id !== step.id))}><Trash2 size={13} /></Button>
      </span>
    </div>)}
    <Button className="ghost small fallback-add" disabled={disabled || chain.length >= 10} onClick={add}><Plus size={13} />{t("Add fallback")}</Button>
  </section>
}

const THRESHOLDS: { value: string; label: string }[] = [{ value: '80', label: 'At 80%' }, { value: '90', label: 'At 90%' }, { value: '95', label: 'At 95%' }, { value: 'limit', label: 'Only at the limit' }]
const toThreshold = (value: string): SwitchThreshold => value === '80' ? 80 : value === '90' ? 90 : value === '95' ? 95 : null
const fromThreshold = (value: SwitchThreshold) => value === null ? 'limit' : String(value)

/** Providers that can be configured: everything with a catalogue, Claude and Codex first. */
function useProviders(): AgentProvider[] {
  useLanguage()
  const { catalogs } = useModelSets()
  const installed = catalogs.filter((catalog) => catalog.models.length).map((catalog) => catalog.provider)
  return (['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'] as AgentProvider[]).filter((provider) => installed.includes(provider) || provider === 'claude-code' || provider === 'codex')
}

/** Settings › Access & Fallback: when to switch, and where each provider goes next. */
export function FallbackSettings({ value, onChange, busy }: { value: AppPreferences; onChange: (next: AppPreferences) => void; busy: boolean }) {
  useLanguage()
  const { catalogs } = useModelSets()
  const providers = useProviders()
  const fallback = value.fallback
  const set = (patch: Partial<AppPreferences['fallback']>) => onChange({ ...value, fallback: { ...fallback, ...patch } })
  const off = !value.defaultAutoFallback
  return <>
    <div className="settings-row"><span><strong>{t("Switch before the limit")}</strong><span className="muted block small">{t("Send with the next fallback once either the 5-hour or weekly window reaches this level, so the chat never stops on a limit error.")}</span></span><Dropdown label={t("Switch before the limit")} value={fromThreshold(fallback.switchAt)} options={THRESHOLDS} disabled={busy || off} onChange={(next) => set({ switchAt: toThreshold(next) })} /></div>
    <div className="settings-row settings-toggle"><span><strong>{t("Return after the limit resets")}</strong><span className="muted block small">{t("The first message after a reset goes back to the provider, model and effort the chat started with.")}</span></span><Switch aria-label={t("Return after the limit resets")} checked={fallback.returnAfterReset} disabled={busy || off} onCheckedChange={(checked) => set({ returnAfterReset: checked })} /></div>
    <div className="settings-intro"><h4>{t("Fallback order")}</h4><p className="muted small">{t("Each provider has its own list. Ramu skips entries that are unavailable or also over the limit. Percentages show current usage.")}</p></div>
    {providers.map((provider) => <ChainEditor key={provider} provider={provider} disabled={busy || off} chain={fallback.chains[provider] ?? defaultChain(provider, catalogs)} onChange={(chain) => set({ chains: { ...fallback.chains, [provider]: chain } })} />)}
  </>
}

/**
 * Codex fixes its own sub-agent tools when a chat starts. A hook lets Ramu decide each time instead, which needs one
 * trust entry for the hook in Codex's own config; turning this on writes it, and says so first.
 */
function CodexHookRow({ checked, busy, onChange }: { checked: boolean; busy: boolean; onChange: (checked: boolean) => void }) {
  useLanguage()
  const [status, setStatus] = useState<{ trusted: boolean; error?: string } | null>(null)
  const [working, setWorking] = useState(false)
  useEffect(() => { void invoke('codex.hook.status').then(setStatus, () => setStatus({ trusted: false })) }, [])
  const toggle = async (next: boolean) => {
    if (!next) return onChange(false)
    setWorking(true)
    try { const result = await invoke('codex.hook.trust'); setStatus(result); if (result.trusted) onChange(true) }
    catch (error) { setStatus({ trusted: false, error: String(error) }) }
    finally { setWorking(false) }
  }
  return <div className="settings-row settings-toggle"><span><strong>{t("Decide before Codex starts its own sub-agents")}</strong><span className="muted block small">{t("Without this, a Codex chat keeps its own sub-agents until the next message, when Ramu restarts it if the setup changed. With it, a hook asks Ramu before each one starts, so the sub-agent can go to another provider at once, and type rules work. Turning it on adds one entry for Ramu's hook to Codex's own settings (")}<code>~/.codex/config.toml</code>{t(") right away; turning it off leaves that entry in place, where it does nothing.")}</span>{status && <span className={`block small ${status.error ? 'error' : 'muted'}`}>{status.error ? `Codex: ${status.error}` : status.trusted ? t("Codex trusts the hook.") : t("Codex does not trust the hook yet.")}</span>}</span><Switch aria-label={t("Decide before Codex starts its own sub-agents")} checked={checked} disabled={busy || working} onCheckedChange={(next) => void toggle(next)} /></div>
}

/** Settings › Sub-agents: where sub-agents run, and how they fall back. */
export function SubagentSettings({ value, onChange, busy }: { value: AppPreferences; onChange: (next: AppPreferences) => void; busy: boolean }) {
  useLanguage()
  const { catalogs } = useModelSets()
  const providers = useProviders()
  const sub = value.subagents
  const set = (patch: Partial<SubagentPreferences>) => onChange({ ...value, subagents: { ...sub, ...patch } })
  const firstStep = (): FallbackStep | null => { const model = catalogs.flatMap((catalog) => catalog.models).find((entry) => entry.isDefault); return model ? stepFor(model) : null }
  const mainChain = (provider: AgentProvider) => value.fallback.chains[provider] ?? defaultChain(provider, catalogs)
  const toggle = (key: 'continueNative' | 'isolate' | 'shareContext', title: string, description: string) => <div className="settings-row settings-toggle"><span><strong>{title}</strong><span className="muted block small">{description}</span></span><Switch aria-label={title} checked={sub[key]} disabled={busy} onCheckedChange={(checked) => set({ [key]: checked })} /></div>
  return <div className="settings-form subagent-settings">
    <p className="muted">{t("Sub-agents are the helpers a chat's agent starts for side tasks. They can run on a different provider than the chat itself.")}</p>
    <div className="settings-row"><span><strong>{t("Where sub-agents run")}</strong><span className="muted block small">{t("Native keeps each provider's own sub-agents. The other options start them on the model you choose.")}</span></span><Dropdown label={t("Where sub-agents run")} value={sub.mode} disabled={busy} options={[{ value: 'native', label: t("Native") }, { value: 'single', label: t("One provider for all") }, { value: 'per-provider', label: t("Per provider") }]} onChange={(mode) => set({ mode: mode === 'single' ? 'single' : mode === 'per-provider' ? 'per-provider' : 'native', ...(mode === 'single' && !sub.single ? { single: firstStep() } : {}) })} /></div>
    {sub.mode === 'single' && <div className="settings-row subagent-route"><span><strong>{t("All sub-agents use")}</strong></span><StepPicker label={t("All sub-agents")} step={sub.single} disabled={busy} onChange={(step) => set({ single: step })} /></div>}
    {sub.mode === 'per-provider' && <div className="subagent-routes">{providers.map((provider) => <div className="settings-row subagent-route" key={provider}>
      <span className="subagent-route-label"><ProviderIcon provider={provider} size={14} />{t("When ")}<strong>{providerName(provider)}</strong> {t(" starts one")}</span>
      <StepPicker label={t("{0} sub-agents", { "0": providerName(provider) })} allowNative step={sub.perProvider[provider] ?? null} disabled={busy} onChange={(step) => set({ perProvider: { ...sub.perProvider, [provider]: step } })} />
    </div>)}</div>}
    <div className="settings-intro"><h4>{t("By type")}</h4><p className="muted small">{t("Optional. A matching type wins over the setting above, e.g. Explore on a fast model and Plan on a strong one.")}</p></div>
    {sub.byType.map((rule) => <div className="settings-row subagent-route" key={rule.id}>
      <Input aria-label={t("Sub-agent type")} placeholder={t("Type, e.g. Explore")} value={rule.type} maxLength={80} disabled={busy} className="subagent-type" onChange={(event) => set({ byType: sub.byType.map((entry) => entry.id === rule.id ? { ...entry, type: event.target.value } : entry) })} />
      <StepPicker label={t("{0} sub-agents", { "0": rule.type || 'Type' })} allowNative step={rule.step} disabled={busy} onChange={(step) => set({ byType: sub.byType.map((entry) => entry.id === rule.id ? { ...entry, step } : entry) })} />
      <Button className="ghost icon small-icon" aria-label={t("Remove {0} rule", { "0": rule.type || 'type' })} title={t("Remove")} disabled={busy} onClick={() => set({ byType: sub.byType.filter((entry) => entry.id !== rule.id) })}><Trash2 size={13} /></Button>
    </div>)}
    <Button className="ghost small fallback-add" disabled={busy || sub.byType.length >= 20} onClick={() => set({ byType: [...sub.byType, { id: newId(), type: '', step: firstStep() }] })}><Plus size={13} />{t("Add type rule")}</Button>

    <div className="settings-intro"><h4>{t("When a sub-agent is limited")}</h4></div>
    <div className="settings-row"><span><strong>{t("Fallback order")}</strong><span className="muted block small">{t("Same as main follows each provider's list in Access & Fallback. Separate gives sub-agents their own, e.g. cheaper models.")}</span></span><Dropdown label={t("Sub-agent fallback order")} value={sub.fallback} disabled={busy} options={[{ value: 'same', label: t("Same as main") }, { value: 'separate', label: t("Separate list") }]} onChange={(next) => set({ fallback: next === 'separate' ? 'separate' : 'same' })} /></div>
    <div className="settings-row"><span><strong>{t("Switch sub-agents")}</strong><span className="muted block small">{t("Move sub-agents off a provider earlier than the chat, so the chat keeps the headroom.")}</span></span><Dropdown label={t("Switch sub-agents")} value={sub.switchAt === 'same' ? 'same' : fromThreshold(sub.switchAt)} disabled={busy} options={[{ value: 'same', label: t("Same as main") }, ...THRESHOLDS]} onChange={(next) => set({ switchAt: next === 'same' ? 'same' : toThreshold(next) })} /></div>
    {sub.fallback === 'separate' && providers.map((provider) => <ChainEditor key={provider} provider={provider} disabled={busy} chain={sub.chains[provider] ?? mainChain(provider)} onChange={(chain) => set({ chains: { ...sub.chains, [provider]: chain } })} onCopy={() => set({ chains: { ...sub.chains, [provider]: mainChain(provider).map((step) => ({ ...step, id: newId() })) } })} />)}
    <CodexHookRow checked={sub.codexHook} busy={busy} onChange={(checked) => set({ codexHook: checked })} />
    {toggle('continueNative', 'Continue limited native sub-agents', 'When a provider\'s own sub-agent hits a limit, restart its task on the fallback list with what it had done so far.')}

    <div className="settings-intro"><h4>{t("Running")}</h4></div>
    {toggle('isolate', 'Isolate sub-agents', 'Each sub-agent works in its own copy of the checkout, starting from your current files. When it finishes, its changes are applied back and show up in the chat\'s review. A change that conflicts stays in the copy, and its location is reported.')}
    {toggle('shareContext', 'Share chat context', 'Attach the chat\'s recent transcript to each sub-agent\'s task.')}
    <div className="settings-row"><span><strong>{t("At once per chat")}</strong><span className="muted block small">{t("More wait in line until one finishes.")}</span></span><Dropdown label={t("Sub-agents at once per chat")} value={String(sub.maxConcurrent)} disabled={busy} options={Array.from({ length: 8 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} onChange={(next) => set({ maxConcurrent: Number(next) })} /></div>
  </div>
}

/** Settings › Advisor: a model on any provider that main chat agents consult at decision points. */
export function AdvisorSettings({ value, onChange, busy }: { value: AppPreferences; onChange: (next: AppPreferences) => void; busy: boolean }) {
  useLanguage()
  const { catalogs } = useModelSets()
  const [claude, setClaude] = useState<string | null>(null)
  useEffect(() => { void invoke('advisor.claude').then((status) => setClaude(status.model), () => setClaude(null)) }, [])
  const advisor = value.advisor
  const set = (patch: Partial<AdvisorPreferences>) => onChange({ ...value, advisor: { ...advisor, ...patch } })
  /** Starts from Claude Code's own advisor model when one is set, otherwise the first default model. */
  const firstStep = (): FallbackStep | null => {
    const models = catalogs.flatMap((catalog) => catalog.models)
    const alias = claude?.toLowerCase()
    const model = (alias && models.find((entry) => entry.provider === 'claude-code' && (entry.id.toLowerCase() === alias || entry.id.toLowerCase().includes(alias) || entry.name.toLowerCase().includes(alias)))) || models.find((entry) => entry.isDefault) || models[0]
    return model ? stepFor(model) : null
  }
  const toggle = (enabled: boolean) => set({ enabled, ...(enabled && !advisor.step ? { step: firstStep() } : {}) })
  return <div className="settings-form advisor-settings">
    <p className="muted">{t("The advisor is a second model that reviews a chat's work at key moments: before the agent commits to an approach, when it is stuck, and before it calls the task done. It can run on any provider, so GPT can advise a Claude chat and the other way around.")}</p>
    <div className="settings-row settings-toggle"><span><strong>{t("Advisor")}</strong><span className="muted block small">{t("Let chat agents consult the advisor. Each consultation sends the chat transcript to the advisor model and uses its tokens. Applies to chats started after you save; running chats keep their current setup until they restart. Sub-agents do not consult it.")}</span></span><Switch aria-label={t("Advisor")} checked={advisor.enabled} disabled={busy} onCheckedChange={toggle} /></div>
    <div className="settings-row subagent-route"><span><strong>{t("Advisor model")}</strong><span className="muted block small">{t("Pick a model at least as strong as the one doing the work.")}</span></span><StepPicker label={t("Advisor")} step={advisor.step} disabled={busy || !advisor.enabled} onChange={(step) => set({ step })} /></div>
    <div className="settings-row settings-toggle"><span><strong>{t("Always wait for advice")}</strong><span className="muted block small">{t("Off lets the agent keep doing work the advice cannot change, such as reading code and running tests, and the advice arrives as a message. It still waits before decisions that depend on the advice and before calling the task done. On makes it stop until the advice arrives, like Claude Code's advisor.")}</span></span><Switch aria-label={t("Always wait for advice")} checked={advisor.wait} disabled={busy || !advisor.enabled} onCheckedChange={(wait) => set({ wait })} /></div>
    {claude && <p className="muted small advisor-claude-note">{advisor.enabled
      ? t("Claude Code's own advisor ({0}) is on in your Claude settings. While Ramu's advisor is on, Ramu turns Claude's off in its Claude chats so only one advisor runs. Your Claude settings are not changed.", { "0": claude })
      : t("Claude Code's own advisor ({0}) is on in your Claude settings, so Claude chats use it while Ramu's advisor is off.", { "0": claude })}</p>}
  </div>
}
