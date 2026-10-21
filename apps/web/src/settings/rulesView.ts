import { providerName } from '@ramu/shared/providers/providers'
import type { Rule } from '@ramu/shared/types'
import { t } from '../i18n'

/** Which providers a rule reaches, as short text. */
export function ruleReach(rule: Pick<Rule, 'providers'>): string {
  return rule.providers.length ? rule.providers.map(providerName).join(', ') : t('Every provider')
}
