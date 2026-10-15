import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import {
  CircleAlert,
  CornerDownRight,
  ListEnd,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react'
import type { Attachment, QueuedMessage } from '@ramu/shared/types'
import { parseTaskMessage } from '@ramu/shared/agentTasks'
import { Attachments } from '../../../Attachments'
import { Menu } from '../../../Menu'
import { invoke } from '../../../ipc'
import { outbox, type OutboxItem } from '../../../outbox'
import { visibleText } from '../lib/messages'
import { ICON_BUTTON_CLASS, QUEUED_MESSAGE_CLASS, GHOST_TEXT_BUTTON_CLASS } from '../styles'

/** Runs an action and shows its failure above the message box. */
type Act = (fn: () => Promise<unknown>) => Promise<void>

/** Remove and "Edit message" for a queued row. */
function QueuedRowActions({
  removeDisabled,
  onRemove,
  editDisabled,
  onEdit,
}: {
  removeDisabled: boolean
  onRemove: () => void
  editDisabled?: boolean
  onEdit: () => void
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        className={ICON_BUTTON_CLASS}
        disabled={removeDisabled}
        aria-label={translate('Remove queued message')}
        title={translate('Remove')}
        onClick={onRemove}
      >
        <Trash2 size={14} />
      </Button>
      <Menu
        label={translate('Queued message actions')}
        icon={<MoreHorizontal size={14} />}
        className={ICON_BUTTON_CLASS}
        align="end"
        items={[
          {
            key: 'edit',
            label: (
              <>
                <Pencil size={14} /> {translate(' Edit message')}
              </>
            ),
            ...(editDisabled === undefined ? {} : { disabled: editDisabled }),
            onSelect: onEdit,
          },
        ]}
      />
    </>
  )
}

/** A message the host has queued. Steering keeps the row until the active tools finish; an idle chat sends it straight away. */
function HostQueuedRow({
  message,
  sessionId,
  busyAgent,
  supportsSteering,
  configuring,
  act,
  onRecall,
}: {
  message: QueuedMessage
  sessionId: string
  busyAgent: boolean
  supportsSteering: boolean
  configuring: boolean
  act: Act
  onRecall: (attachments: Attachment[], text: string) => void
}) {
  const relay = parseTaskMessage(message.text)
  const text = relay ? `To ${relay.name}: ${relay.body}` : visibleText(message.text) || 'Attachments'
  const recall = () =>
    void act(async () => {
      await invoke('agent.removeQueued', sessionId, message.id)
      onRecall(message.attachments ?? [], message.text)
    })
  // Steering keeps the row until the active tools finish; an idle chat sends it straight away, even with the queue paused.
  const sendNow = () => void act(() => invoke('agent.sendQueuedNow', sessionId, message.id))
  // Steering stays visible but disabled while it waits; the hover tip says why.
  const steering = message.mode === 'steer'
  const sendTip = steering
    ? translate('Steering pending until active tools finish')
    : !busyAgent
      ? translate('Send now')
      : supportsSteering
        ? translate('Send after active tools finish')
        : translate("This provider can't steer a running turn")
  return (
    <div className={QUEUED_MESSAGE_CLASS}>
      <ListEnd size={15} className="queued-icon flex-none text-muted-foreground" aria-hidden="true" />
      <span className="queued-text" title={text}>
        {text}
        {message.attachments?.length ? <Attachments files={message.attachments} size="small" /> : null}
      </span>
      <div className="inline-flex flex-none" title={sendTip}>
        <Button
          variant="ghost"
          size="icon-xs"
          className={`${ICON_BUTTON_CLASS} queued-steer gap-[5px] text-soft disabled:pointer-events-none`}
          aria-label={busyAgent ? translate('Steer') : translate('Send now')}
          disabled={configuring || steering || (busyAgent && !supportsSteering)}
          onClick={sendNow}
        >
          {busyAgent ? <CornerDownRight size={14} /> : <Send size={14} />}
        </Button>
      </div>
      <QueuedRowActions
        removeDisabled={configuring}
        onRemove={() => void act(() => invoke('agent.removeQueued', sessionId, message.id))}
        onEdit={recall}
      />
    </div>
  )
}

/** A message waiting on this device for the host to come back, after everything the host already queued. The host can't send it early. */
function OutboxRow({
  item,
  hostName,
  hostOffline,
  onRecall,
}: {
  item: OutboxItem
  hostName: string
  hostOffline: boolean
  onRecall: (attachments: Attachment[], text: string) => void
}) {
  const text = visibleText(item.text) || translate('Attachments')
  const recall = () => {
    const taken = outbox().remove(item.id)
    if (!taken) return
    onRecall(taken.attachments, text)
  }
  const sending = item.state === 'sending',
    failed = item.state === 'failed'
  const status = sending
    ? translate('Sending…')
    : failed
      ? translate('Not sent: {0}', { 0: item.error ?? '' })
      : translate('Sends when {0} is back', { 0: hostName })
  return (
    <div className={QUEUED_MESSAGE_CLASS}>
      {sending ? (
        <LoaderCircle
          size={15}
          className="queued-icon flex-none text-muted-foreground spin [animation:spin_0.9s_linear_infinite]"
          aria-hidden="true"
        />
      ) : failed ? (
        <CircleAlert size={15} className="queued-icon flex-none text-bad" aria-hidden="true" />
      ) : (
        <ListEnd size={15} className="queued-icon flex-none text-muted-foreground" aria-hidden="true" />
      )}
      <span className="queued-text" title={`${text}\n\n${status}`}>
        {text}
        {item.attachments.length ? <Attachments files={item.attachments} size="small" /> : null}
        <span className="sr-only">{status}</span>
      </span>
      {failed && (
        <div className="inline-flex flex-none" title={hostOffline ? status : translate('Retry')}>
          <Button
            variant="ghost"
            size="icon-xs"
            className={`${ICON_BUTTON_CLASS} queued-steer gap-[5px] text-soft disabled:pointer-events-none`}
            aria-label={translate('Retry')}
            disabled={hostOffline}
            onClick={() => outbox().retry(item.id)}
          >
            <RotateCcw size={14} />
          </Button>
        </div>
      )}
      <QueuedRowActions
        removeDisabled={sending}
        onRemove={() => outbox().remove(item.id)}
        editDisabled={sending}
        onEdit={recall}
      />
    </div>
  )
}

/**
 * The messages waiting to be sent: those the host queued, then those held on this device while the host is
 * unreachable. `onRecall` moves one back into the message box.
 */
export function QueuedMessages({
  sessionId,
  queued,
  pending,
  paused,
  hostName,
  hostOffline,
  busyAgent,
  supportsSteering,
  configuring,
  act,
  onRecall,
}: {
  sessionId: string
  queued: QueuedMessage[]
  pending: OutboxItem[]
  paused: boolean
  hostName: string
  hostOffline: boolean
  busyAgent: boolean
  supportsSteering: boolean
  configuring: boolean
  act: Act
  onRecall: (attachments: Attachment[], text: string) => void
}) {
  useLanguage()
  return (
    <div
      className="message-queue flex flex-col gap-1.5 p-[8px_12px] mb-2 max-h-[180px] overflow-auto [border:1px_solid_transparent] rounded-(--radius-s) bg-raised"
      aria-label={translate('Queued messages')}
    >
      {paused && (
        <div className="message-queue-heading flex items-center justify-between gap-2">
          <span className="muted text-muted-foreground small text-caption">{translate('Paused')}</span>
          <Button
            variant="ghost"
            size="sm"
            className={GHOST_TEXT_BUTTON_CLASS}
            onClick={() => void act(() => invoke('agent.resumeQueue', sessionId))}
          >
            {translate('Resume messages')}
          </Button>
        </div>
      )}
      {queued.map((message) => (
        <HostQueuedRow
          key={message.id}
          message={message}
          sessionId={sessionId}
          busyAgent={busyAgent}
          supportsSteering={supportsSteering}
          configuring={configuring}
          act={act}
          onRecall={onRecall}
        />
      ))}
      {/* Outbox messages wait on this device, after everything the host already queued. Same row, but the host can't send them early. */}
      {pending.map((item) => (
        <OutboxRow key={item.id} item={item} hostName={hostName} hostOffline={hostOffline} onRecall={onRecall} />
      ))}
    </div>
  )
}
