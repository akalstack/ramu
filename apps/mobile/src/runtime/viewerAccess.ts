/** Advisory device-side controls; the execution host authorizes every request. */
export const canWriteHost = (computer: { status: string; access?: 'owner' | 'viewer' } | undefined): boolean =>
  computer?.status === 'online' && computer.access !== 'viewer'

export const VIEW_ONLY_WRITE_NOTICE = {
  en: 'This device is view-only, so it cannot change this. Ask the host owner to pair it with full access.',
  id: 'Perangkat ini hanya dapat melihat dan tidak dapat mengubah ini. Minta pemilik host memasangkannya dengan akses penuh.',
}

export const VIEW_ONLY_BROWSER_NOTICE = {
  en: 'This device can view threads, but cannot open the host browser. Ask the host owner to pair it with full access.',
  id: 'Perangkat ini dapat melihat thread, tetapi tidak dapat membuka browser host. Minta pemilik host memasangkannya dengan akses penuh.',
}

export const VIEW_ONLY_COMPUTER_NOTICE = {
  en: 'This device can watch screens the host owner has shared with this thread. Control requires full access.',
  id: 'Perangkat ini dapat melihat layar yang dibagikan pemilik host ke thread ini. Kontrol memerlukan akses penuh.',
}
