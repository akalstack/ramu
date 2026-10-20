import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import { ComposerTraySection } from '../../../composer/ComposerTraySection'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  CircleAlert,
  CornerDownRight,
  GripVertical,
  ListEnd,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react'
import type { Attachment, QueuedMessage } from '@ramu/shared/types'
import { parseTaskMessage } from '@ramu/shared/chat/agentTasks'
import { Attachments } from '../../../composer/Attachments'
import { Menu } from '../../../Menu'
import { useHost } from '../../../workspace/HostProvider'
import { outbox, type OutboxItem } from '../../../composer/outbox'
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
  reorderDisabled,
  act,
  onRecall,
}: {
  message: QueuedMessage
  sessionId: string
  busyAgent: boolean
  supportsSteering: boolean
  configuring: boolean
  reorderDisabled: boolean
  act: Act
  onRecall: (attachments: Attachment[], text: string) => void
}) {
  const { invoke } = useHost()
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
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: message.id,
    disabled: configuring || reorderDisabled,
  })
  return (
    <div
      ref={setNodeRef}
      className={QUEUED_MESSAGE_CLASS}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
        position: 'relative',
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      {reorderDisabled ? null : (
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="flex-none cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:cursor-default"
          aria-label={translate('Drag to reorder')}
          title={translate('Drag to reorder')}
          disabled={configuring}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
      )}
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
  const host = useHost().id
  const text = visibleText(item.text) || translate('Attachments')
  const recall = () => {
    const taken = outbox(host).remove(item.id)
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
            onClick={() => outbox(host).retry(item.id)}
          >
            <RotateCcw size={14} />
          </Button>
        </div>
      )}
      <QueuedRowActions
        removeDisabled={sending}
        onRemove={() => outbox(host).remove(item.id)}
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
  const { invoke } = useHost()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = queued.map((message) => message.id)
  const reorder = (event: DragEndEvent) => {
    const from = ids.indexOf(String(event.active.id)),
      to = event.over ? ids.indexOf(String(event.over.id)) : -1
    if (from < 0 || to < 0 || from === to) return
    void act(() => invoke('agent.reorderQueued', sessionId, arrayMove(ids, from, to)))
  }
  return (
    <ComposerTraySection
      className="message-queue"
      aria-label={translate('Queued messages')}
      defaultOpen
      title={
        <>
          {translate('Queued messages')}{' '}
          <span className="text-muted-foreground tabular-nums">{queued.length + pending.length}</span>
        </>
      }
      icon={<ListEnd />}
      actions={
        paused && (
          <>
            <span className="text-muted-foreground text-caption">{translate('Paused')}</span>
            <Button
              variant="ghost"
              size="sm"
              className={GHOST_TEXT_BUTTON_CLASS}
              onClick={() => void act(() => invoke('agent.resumeQueue', sessionId))}
            >
              {translate('Resume messages')}
            </Button>
          </>
        )
      }
    >
      <div className="message-queue-list">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {queued.map((message) => (
              <HostQueuedRow
                key={message.id}
                message={message}
                sessionId={sessionId}
                busyAgent={busyAgent}
                supportsSteering={supportsSteering}
                configuring={configuring}
                reorderDisabled={queued.length < 2}
                act={act}
                onRecall={onRecall}
              />
            ))}
          </SortableContext>
        </DndContext>
        {/* Outbox messages wait on this device, after everything the host already queued. Same row, but the host can't send them early. */}
        {pending.map((item) => (
          <OutboxRow key={item.id} item={item} hostName={hostName} hostOffline={hostOffline} onRecall={onRecall} />
        ))}
      </div>
    </ComposerTraySection>
  )
}
