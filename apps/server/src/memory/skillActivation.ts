import { z } from 'zod'
import { parse } from 'yaml'
import type { ManagedSkill } from '@ramu/shared/types'

const names = z.array(z.string().trim().min(1).max(200)).max(100)
export const skillActivationSchema = z
  .object({
    requires_tools: names.optional(),
    fallback_for_tools: names.optional(),
    requires_toolsets: names.optional(),
    fallback_for_toolsets: names.optional(),
  })
  .strict()

/** Accept the Ramu namespace and Hermes' existing portable requirement fields. */
export function metadataActivation(metadata: Record<string, unknown>) {
  const nested = metadata.metadata as { ramu?: Record<string, unknown>; hermes?: Record<string, unknown> } | undefined
  const source = { ...metadata, ...nested?.hermes, ...nested?.ramu }
  const conditions = Object.fromEntries(
    Object.keys(skillActivationSchema.shape)
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  )
  return Object.keys(conditions).length ? skillActivationSchema.parse(conditions) : undefined
}

export function activationOf(skill: ManagedSkill) {
  if (skill.activation) return skillActivationSchema.parse(skill.activation)
  // Existing installs keep their original frontmatter, so no migration or reinstallation is necessary.
  const yaml = skill.installation?.markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
  return yaml ? metadataActivation(parse(yaml, { maxAliasCount: 0 }) as Record<string, unknown>) : undefined
}

export function skillCompatibility(skill: ManagedSkill, tools: string[], toolsets: string[], complete: boolean) {
  const activation = activationOf(skill)
  if (!activation) return { available: true, reasons: [] as string[] }
  const reasons: string[] = []
  for (const [required, available, label] of [
    [activation.requires_tools, tools, 'tool'],
    [activation.requires_toolsets, toolsets, 'toolset'],
  ] as const)
    for (const name of required ?? []) if (!available.includes(name)) reasons.push(`Requires ${label}: ${name}`)
  const fallback = [...(activation.fallback_for_tools ?? []), ...(activation.fallback_for_toolsets ?? [])]
  if (fallback.length && !complete)
    reasons.push('A complete current tool inventory is needed to confirm missing-tool fallbacks.')
  for (const [blocked, available, label] of [
    [activation.fallback_for_tools, tools, 'tool'],
    [activation.fallback_for_toolsets, toolsets, 'toolset'],
  ] as const)
    for (const name of blocked ?? [])
      if (available.includes(name)) reasons.push(`Fallback is unnecessary while ${label} is available: ${name}`)
  return { available: !reasons.length, reasons }
}

/** Stable wrappers avoid rewriting a shared checkout's skill links when concurrent providers have different tools. */
export function gatedSkill(skill: ManagedSkill): ManagedSkill {
  const activation = activationOf(skill)
  if (!activation) return skill
  return {
    ...skill,
    content: `# ${skill.name}\n\nThis skill has runtime tool requirements: ${JSON.stringify(activation)}.\n\nBefore using it, call Ramu's skill_resolve with id ${JSON.stringify(skill.id)}, your current availableTools and availableToolsets, and inventoryComplete only if the inventory is complete. Discover the tool through tool_search if necessary. Use only the instructions returned when available is true. If unavailable, select another compatible skill. Resolve again after a provider or tool change. Do not use an earlier resolution from a different runtime.\n`,
  }
}
