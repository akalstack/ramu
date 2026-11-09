import { ABILITY_LABELS, MEDIA_ABILITIES } from '@ramu/shared/providers/abilities'
import { MEDIA_SERVICE_NAMES, MEDIA_SERVICES } from '@ramu/shared/types/deploy'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'
import { SETTINGS_FORM_CLASS } from './constants'
import { DeployAccounts } from './DeployAccounts'

/** Settings › Media: API keys for the services that make video, speech, music and sound effects. */
export function MediaSettings({ onOpenAbilities }: { onOpenAbilities: () => void }) {
  useLanguage()
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <p className="muted text-muted-foreground small text-caption">
        {t(
          'When no signed-in provider can make video, speech, music or sound effects, they run on a media service with your own API key, billed to that account. Auto tries these after your signed-in providers.',
        )}{' '}
        {MEDIA_SERVICES.map(
          (service) =>
            `${MEDIA_SERVICE_NAMES[service]}: ${MEDIA_ABILITIES[service].map((ability) => t(ABILITY_LABELS[ability]).toLowerCase()).join(', ')}`,
        ).join(' · ')}
      </p>
      <DeployAccounts only="media" />
      <span>
        <Button variant="ghost" size="sm" onClick={onOpenAbilities}>
          {t('Choose which service each ability uses')}
        </Button>
      </span>
    </div>
  )
}
