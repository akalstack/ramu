/**
 * The peer name of a Ramu Link stream from an account the host's owner shared it with. Such a device may pair only as a
 * viewer, whether by code or by request, and never through the shortcut the owner's own account gets.
 */
export const SHARED_LINK_PEER = 'link-shared:'
export const isSharedLinkPeer = (peer: string) => peer.startsWith(SHARED_LINK_PEER)
