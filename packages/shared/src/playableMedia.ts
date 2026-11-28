/** A video or audio file, which the host streams to a player instead of sending whole. */
export const playableMedia = (mimeType: string) => /^(video|audio)\//.test(mimeType)
