import { useStore } from './runtime/store'

const en = {
  newChat: 'New thread',
  workspaces: 'Workspaces',
  search: 'Search threads',
  needsYou: 'Needs you',
  projects: 'Projects',
  chats: 'Threads',
  standalone: 'Standalone threads',
  computers: 'Computers',
  pair: 'Pair a computer',
  settings: 'Settings',
  running: 'running',
  waiting: 'waiting',
  online: 'Online',
  connecting: 'Connecting',
  offline: 'Offline',
  revoked: 'Pair again',
  messagePlaceholder: 'Ask for follow-up changes',
  newPlaceholder: 'What should the agent do?',
  queue: 'Queue',
  steer: 'Steer',
  queued: 'Queued',
  stop: 'Stop',
  changes: 'Changes',
  terminal: 'Terminal',
  appearance: 'Appearance',
  language: 'Language',
  usage: 'Usage',
  about: 'About',
  offlineHint:
    'This computer is not reachable. You can still send messages and start threads; they wait in the outbox until it is back.',
  empty: 'No threads yet',
  outbox: 'Outbox',
}

const id: typeof en = {
  newChat: 'Thread baru',
  workspaces: 'Ruang kerja',
  search: 'Cari thread',
  needsYou: 'Butuh kamu',
  projects: 'Proyek',
  chats: 'Thread',
  standalone: 'Thread mandiri',
  computers: 'Komputer',
  pair: 'Pasangkan komputer',
  settings: 'Pengaturan',
  running: 'berjalan',
  waiting: 'menunggu',
  online: 'Daring',
  connecting: 'Menghubungkan',
  offline: 'Luring',
  revoked: 'Pasangkan lagi',
  messagePlaceholder: 'Minta perubahan lanjutan',
  newPlaceholder: 'Apa yang harus dikerjakan agen?',
  queue: 'Antrekan',
  steer: 'Arahkan',
  queued: 'Dalam antrean',
  stop: 'Hentikan',
  changes: 'Perubahan',
  terminal: 'Terminal',
  appearance: 'Tampilan',
  language: 'Bahasa',
  usage: 'Pemakaian',
  about: 'Tentang',
  offlineHint:
    'Komputer ini tidak terjangkau. Kamu tetap bisa mengirim pesan dan memulai thread; semuanya menunggu di kotak keluar sampai komputer kembali.',
  empty: 'Belum ada thread',
  outbox: 'Kotak keluar',
}

export type Strings = typeof en

export function useT(): Strings {
  return useStore().language === 'id' ? id : en
}

export function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}

export function until(at: number): string {
  const m = Math.max(0, Math.round((at - Date.now()) / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.round(h / 24)}d`
}
