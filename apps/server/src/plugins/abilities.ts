import { ABILITIES, type Ability, type AbilityMcpTool } from '@ramu/shared/providers/abilities'
import type { AppPreferences } from '@ramu/shared/types'

/**
 * Points Auto at a plugin's mapped tools for abilities nobody chose yet, so Settings → Models → Abilities offers them
 * with no mapping by hand; each is used only once its live check passes. Removing the plugin takes them back.
 */
export function mapPluginAbilities(
  preferences: { load(): AppPreferences; save(preferences: AppPreferences): void },
  tools: ({ ability: string } & AbilityMcpTool)[],
  removed: string[] = [],
) {
  const current = preferences.load()
  const abilities = current.abilities
  const autoMcp: Partial<Record<Ability, AbilityMcpTool>> = { ...(abilities.autoMcp ?? {}) }
  const choices = { ...abilities.choices }
  let changed = false
  for (const ability of ABILITIES) {
    const auto = autoMcp[ability]
    if (auto && removed.includes(auto.connectionId)) {
      delete autoMcp[ability]
      changed = true
    }
    const choice = choices[ability]
    if (choice && typeof choice === 'object' && 'connectionId' in choice && removed.includes(choice.connectionId)) {
      delete choices[ability]
      changed = true
    }
  }
  for (const entry of tools) {
    const ability = entry.ability as Ability
    if (!ABILITIES.includes(ability) || autoMcp[ability] || (choices[ability] && choices[ability] !== 'auto')) continue
    autoMcp[ability] = {
      connectionId: entry.connectionId,
      tool: entry.tool,
      ...(entry.status ? { status: entry.status } : {}),
      ...(entry.balance ? { balance: entry.balance } : {}),
      ...(entry.fromImage ? { fromImage: entry.fromImage } : {}),
      ...(entry.refine ? { refine: entry.refine } : {}),
      ...(entry.downloads?.length ? { downloads: entry.downloads } : {}),
    }
    changed = true
  }
  if (changed) preferences.save({ ...current, abilities: { ...abilities, choices, autoMcp } })
}
