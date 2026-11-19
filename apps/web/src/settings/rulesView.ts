import { providerName } from '@ramu/shared/providers/providers'
import { estimatedTokens, type RuleDuplicate, type RuleScopeCost } from '@ramu/shared/rules'
import type { Rule, RuleActivation } from '@ramu/shared/types'
import { t } from '../i18n'

/** Which providers a rule reaches, as short text. */
export function ruleReach(rule: Pick<Rule, 'providers'>): string {
  return rule.providers.length ? rule.providers.map(providerName).join(', ') : t('Every provider')
}

/** A rule's own estimated context cost, as short text. */
export function ruleTokens(characters: number): string {
  return t('About {0} tokens', { '0': estimatedTokens(characters).toLocaleString() })
}

/** One scope's estimated context cost against its budget, for example "Every project: about 300 tokens (1,200 of 24,000 characters)". */
export function scopeCostLine(cost: RuleScopeCost, scopeName: string): string {
  return t('{0}: about {1} tokens ({2} of {3} characters)', {
    '0': scopeName,
    '1': estimatedTokens(cost.characters).toLocaleString(),
    '2': cost.characters.toLocaleString(),
    '3': cost.limit.toLocaleString(),
  })
}

/** The warning shown on a rule that repeats another one, naming the other rules. */
export function duplicateNote(duplicate: RuleDuplicate, rules: Pick<Rule, 'id' | 'name'>[]): string {
  const names = duplicate.others.map((id) => rules.find((rule) => rule.id === id)?.name ?? id).join(', ')
  return duplicate.kind === 'text'
    ? t('Same text as {0}. Both apply, so turn one off or delete it.', { '0': names })
    : t('Same name as {0}. Both apply, so rename one or turn it off.', { '0': names })
}

/** A rule's activation as short text for its card and the filter. */
export function activationLabel(activation: RuleActivation): string {
  return activation === 'manual' ? t('Manual') : activation === 'paths' ? t('When files match') : t('Always')
}

/** Where Claude Code's copy of a path rule is written, for the editor before and after saving. */
export function claudeCopyNote(projectId: string | null): string {
  return projectId
    ? t(
        "Claude Code's copy is written to .claude/rules in each of this project's repositories, where it can be committed and shared.",
      )
    : t("Claude Code's copy is written to the rules folder in your Claude config home.")
}
