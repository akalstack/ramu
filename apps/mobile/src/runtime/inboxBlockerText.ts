import type { InboxBlocker } from '@ramu/shared/hostInbox'

/** One line saying what a waiting thread needs from the person, in the app's two languages. */
export function inboxBlockerText(blocker: InboxBlocker, language: 'en' | 'id'): string {
  const id = language === 'id'
  const count = blocker.count ?? 1
  const reason = blocker.reason ? `: ${blocker.reason}` : ''
  switch (blocker.kind) {
    case 'approval':
      return id ? `${count} persetujuan diperlukan` : count === 1 ? '1 approval needed' : `${count} approvals needed`
    case 'connector':
      return id
        ? `Masuk ke ${count} konektor`
        : count === 1
          ? 'Sign in to 1 connector'
          : `Sign in to ${count} connectors`
    case 'question':
      return id
        ? `${count} pertanyaan untuk dijawab`
        : count === 1
          ? '1 question to answer'
          : `${count} questions to answer`
    case 'verification-failed':
      return (id ? 'Pemeriksaan tujuan gagal' : 'Goal check failed') + reason
    case 'goal-blocked':
      return (id ? 'Tujuan terhambat' : 'Goal blocked') + reason
    case 'turn-limit':
      return id ? 'Tujuan mencapai batas giliran' : 'Goal reached its turn limit'
    case 'goal-paused':
      return id ? 'Tujuan dijeda' : 'Goal paused'
  }
}
