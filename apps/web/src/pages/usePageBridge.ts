import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { readInteractiveState, type InteractiveState } from '@ramu/shared/interactive'
import type { ArtifactRun } from '@ramu/shared/artifacts'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'

export interface PickedElement {
  selector: string
  text: string
  html: string
}

interface FrameFunction {
  name: string
  description: string
  input: Record<string, string>
}

/** A run the page started, followed on pages:changed until it ends. */
interface Following {
  requestId: string
  stepRequestId?: string
  shown: number
}

/**
 * Connects an artifact's frame to its host: ramuContent calls go to artifacts.call (or artifacts.shareCall for a share
 * link), runs stream their steps back, artifact functions run in the frame, errors are reported for Fix this, and the shared state is
 * saved over the revision this device read.
 */
export function usePageBridge({
  artifactId,
  share,
  version,
  frame,
  instance,
  stateRevision,
  onPicked,
  onError,
  onStartThread,
}: {
  artifactId: string
  share?: string
  version: number
  frame: RefObject<HTMLIFrameElement | null>
  instance: string
  stateRevision: RefObject<number>
  onPicked(element: PickedElement): void
  onError(message: string): void
  /** Asks the person before a page hands work to a thread; resolves to whether they agreed. */
  onStartThread(prompt: string): Promise<boolean>
}) {
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const functions = useRef<FrameFunction[]>([])
  const following = useRef(new Map<string, Following>())
  const [confirm, setConfirm] = useState<{ id: string; text: string } | null>(null)
  const [running, setRunning] = useState<ArtifactRun | null>(null)
  const post = useCallback(
    (type: string, value: unknown, requestId?: string) =>
      frame.current?.contentWindow?.postMessage({ ramuInteractive: 1, instance, type, value, requestId }, '*'),
    [frame, instance],
  )
  const answer = useCallback(
    (requestId: string, work: Promise<unknown>) =>
      void work.then(
        (value) =>
          frame.current?.contentWindow?.postMessage(
            { ramuInteractive: 1, instance, type: 'reply', requestId, value: value ?? null },
            '*',
          ),
        (error: unknown) =>
          frame.current?.contentWindow?.postMessage(
            {
              ramuInteractive: 1,
              instance,
              type: 'reply',
              requestId,
              error:
                error instanceof Error
                  ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
                  : String(error),
            },
            '*',
          ),
      ),
    [frame, instance],
  )
  const saving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      const m = event.data as {
        ramuInteractive?: number
        instance?: string
        type?: string
        value?: unknown
        requestId?: string
      }
      if (!m || m.ramuInteractive !== 1 || m.instance !== instance) return
      if (m.type === 'tools' && Array.isArray(m.value)) functions.current = (m.value as FrameFunction[]).slice(0, 16)
      if (m.type === 'tool-result' && m.value && typeof m.value === 'object') {
        const result = m.value as { id: string; value?: unknown; error?: string }
        void invoke('artifacts.runReply', result.id, result.value ?? null, result.error).catch(() => {})
      }
      if (m.type === 'picked' && m.value && typeof m.value === 'object') onPicked(m.value as PickedElement)
      if (m.type === 'error') {
        const error = (typeof m.value === 'string' ? { message: m.value } : (m.value ?? {})) as {
          message?: string
          steps?: string[]
        }
        const message = String(error.message ?? 'An interaction failed.')
        onError(message)
        if (!share)
          void invoke('artifacts.reportError', artifactId, {
            message,
            version,
            device: 'desktop',
            steps: Array.isArray(error.steps) ? error.steps.map(String).slice(-20) : undefined,
          }).catch(() => {})
      }
      if (m.type === 'state' && !share) {
        const next = readInteractiveState(m.value)
        if (!next) return
        clearTimeout(saving.current)
        saving.current = setTimeout(() => {
          void invoke('artifacts.saveState', artifactId, next, stateRevision.current ?? 0)
            .then((saved) => {
              stateRevision.current = saved.revision
              // Another device saved first: show its values rather than overwrite them.
              if (!saved.accepted) post('restore', saved.state)
            })
            .catch(() => {})
        }, 400)
      }
      if (m.type !== 'call' || !m.requestId || !m.value || typeof m.value !== 'object') return
      const { method, args } = m.value as { method: string; args: unknown[] }
      const requestId = m.requestId
      if (method === 'ai.run' || method === 'ai.flow') {
        if (share) return answer(requestId, Promise.reject(new Error('Runs are not available through a share link.')))
        const options = (args[1] ?? {}) as { shape?: unknown; maxSteps?: number; runId?: string; name?: string }
        const start =
          method === 'ai.flow'
            ? invoke('artifacts.runFlow', artifactId, String(args[0]), functions.current)
            : invoke('artifacts.runStart', artifactId, String(args[0]), {
                shape: options.shape,
                maxSteps: options.maxSteps,
                name: options.name,
                functions: functions.current,
              })
        void start.then(
          (runId) => {
            if (runId) following.current.set(runId, { requestId, stepRequestId: options.runId, shown: 0 })
            else answer(requestId, Promise.reject(new Error('The run did not start.')))
          },
          (error) => answer(requestId, Promise.reject(error)),
        )
        return
      }
      if (method === 'thread.start') {
        if (share)
          return answer(requestId, Promise.reject(new Error('Threads cannot be started through a share link.')))
        const prompt = String(args[0] ?? '')
        answer(
          requestId,
          onStartThread(prompt).then((agreed) => (agreed ? invoke('artifacts.startThread', artifactId, prompt) : null)),
        )
        return
      }
      answer(
        requestId,
        share ? invoke('artifacts.shareCall', share, method, args) : invoke('artifacts.call', artifactId, method, args),
      )
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [
    frame,
    instance,
    invoke,
    artifactId,
    share,
    version,
    stateRevision,
    post,
    answer,
    onPicked,
    onError,
    onStartThread,
  ])
  useEffect(
    () =>
      on('artifacts:changed', (payload) => {
        const run = payload.run
        if (payload.artifactId !== artifactId || !run) return
        const follow = following.current.get(run.id)
        if (!follow) return
        setRunning(run.status === 'running' ? run : null)
        for (const step of run.steps.slice(follow.shown))
          if (follow.stepRequestId) post('run-step', step, follow.stepRequestId)
        follow.shown = run.steps.length
        if (run.call) post('tool-call', run.call)
        setConfirm(run.confirm ?? null)
        if (run.status !== 'running') {
          following.current.delete(run.id)
          setConfirm(null)
          post(
            'reply',
            {
              status: run.status,
              answer: run.answer ?? null,
              error: run.error ?? null,
              steps: run.steps,
              changes: run.changes,
              id: run.id,
            },
            follow.requestId,
          )
        }
      }),
    [on, artifactId, post],
  )
  useEffect(() => () => clearTimeout(saving.current), [])
  return {
    /** Starts pick mode in the frame for Edit; the next click reports its element instead of acting. */
    pick: (active: boolean) => post('pick', active),
    /** Puts values another device saved into the frame. */
    restore: (state: InteractiveState | null) => post('restore', state),
    confirm,
    running,
    answerConfirm: (allowed: boolean) => {
      if (!confirm) return
      setConfirm(null)
      void invoke('artifacts.runConfirm', confirm.id, allowed).catch(() => {})
    },
    stopRun: () => running && void invoke('artifacts.runStop', running.id).catch(() => {}),
  }
}
