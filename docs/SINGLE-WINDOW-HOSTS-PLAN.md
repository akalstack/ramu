# Plan: one renderer for every host

Status: proposal, not started. Nothing here is implemented.

## Why

Ramu opens one `WebContentsView` per paired host (`openComputer` and `ensureView` in `apps/desktop/src/main/index.ts`). Each is a full copy of the web app. Switching hosts swaps windows. This causes:

- A flash while the incoming window repaints (`SWAP_SETTLE_MS`, hidden windows blank their page).
- A splash reload when an idle host window is closed (`WorkspaceViewCache`, `releaseView`) and reopened.
- Inconsistent scroll positions, sidebar state and scrollbars, because UI state lives per window.
- Native dialogs that open on the wrong machine (`repos.pick`), so a remote host needs a custom dialog.
- Memory: one Chromium renderer per host, up to four cached.
- Every cross-host action in the sidebar, Activity page and Inbox goes through `computers.navigate`, which switches windows first.

T3 Code (`pingdotgg/t3code`) avoids this. It uses one renderer, routes carry the environment (`/_chat/$environmentId/$threadId`), state is keyed by environment id, and a connection catalog holds one connection per environment inside the renderer. Switching host is a selection or route change, not a window swap.

## How it works today

- The preload bridge (`apps/desktop/src/preload/index.ts`) exposes `ramu.invoke(method, ...args)` and `ramu.on(event, listener)`. `invoke` carries no host. The main process decides the host from which window sent the call (`owners`, `computers.endpoint(id)`).
- Push events are delivered per window (`sendTo`, `deliverTo`). A hidden window's events are buffered in `HiddenEvents` and drained when it is shown.
- Host-targeted calls already exist, but only for part of the surface: `computers.overview`, `computers.tasks.invoke`, `computers.settings.get/patch`, `computers.recapAct`, `computers.navigate`.
- The web app holds one workspace store (`apps/web/src/workspace/workspace.tsx`, about 1100 lines), one react-query cache (`dataQueries.ts`, keyed by method and args with no host), terminals (`terminalRegistry.ts`), unread marks, layout prefs and `localStorage` keys, all assuming one host.
- The unified sidebar and Activity page already read per-host overviews in one window (`useHostOverviews`). That read path is the part that is already multi-host.

## Target design

1. **Host is an explicit parameter.** `invoke(method, args)` becomes `invoke(hostId, method, args)`, or a host-bound client obtained from a `useHost(hostId)` hook. The main process routes by that id and stops inferring it from the window.
2. **Events carry the host.** Every push event is `{ hostId, payload }`. All events go to the single window with no per-host buffering.
3. **State is keyed by host id.** The workspace store, react-query keys, terminal registry, unread set, layout prefs and `localStorage` keys are namespaced by host id. One store instance per host, mounted lazily when a host is first used.
4. **The route names the host.** Active thread, project and view are `(hostId, id)`. The sidebar "All hosts" and single-host filter just choose which stores to show.
5. **Native actions are host-aware.** Anything that opens a dialog or touches the local machine (folder pick, attachments, terminals' cwd, open in editor) checks whether the target host is the local one. Remote hosts use in-app UI (the folder browser already exists).
6. **Connection lifecycle stays in main.** `computers.ts`, `remoteServers.ts` and `sshComputers.ts` keep owning pairing, reconnect and status. The renderer subscribes to their state.

## Phases

Each phase ships on its own, keeps the app working, and ends with `pnpm --filter @ramu/web test`, `typecheck`, and for desktop-facing phases `pnpm build` then `pnpm test:desktop-smoke`.

**Phase 0: measure and stabilise (small).** Record memory and CPU with two and three hosts. Keep the current fixes (longer idle limit). Move shared UI state (sidebar width, scroll, scrollbar setting) out of per-window storage so windows stay consistent until the refactor lands.

**Phase 1: host-addressed bridge (medium).**
- Add `host?: string` to `invoke` in `RamuBridge` and the `ramu:invoke` handler. When omitted, keep today's behaviour (the window's own host).
- Add the host to push events behind a flag. Keep delivering per window.
- Generalise `computers.tasks.invoke` into a single host-targeted passthrough with an allow-list of methods.
- Tests: `apps/desktop/test` for routing, unknown host, offline host, and a method outside the allow-list.

**Phase 2: host-scoped data layer (medium).**
- Add the host id to react-query keys in `dataQueries.ts` and `ipc.ts` (`ipcQueryKey`, `invalidateData`).
- Add a `HostProvider` and `useHost()` that give components a bound `invoke`, the host's status and whether it is local.
- Namespace `localStorage` and layout prefs by host id, with a one-time migration of existing keys to the local host.

**Phase 3: multi-instance workspace store (large, riskiest).**
- Split `workspace.tsx` into a per-host store factory. Keep `useWorkspace()` as "the active host's store" so existing components keep working.
- Mount stores lazily and keep them subscribed while the host is connected.
- Move terminal registry, unread tracking and checkpoint logic to per-host instances (`terminalRegistry.ts`, `workspaceCheckpoint.ts`, `terminalActivity.ts`).
- Decide what happens to hidden hosts' events: apply them to that store immediately (cheap) instead of buffering.

**Phase 4: routing and sidebar (medium).**
- The active selection becomes `(hostId, thread/project/view)`.
- `navigateHost` becomes a local selection change. Remove `computers.navigate`, `HostNavigation` and the `add-project` destination, or keep them only for notifications that open a specific host.
- The sidebar renders every host from its own store instead of overview polling, which also removes the 15 second poll for connected hosts.
- Remote rows use the same `TaskRow` with the host's bound `invoke` (drop the `remote` prop and `callTask`).

**Phase 5: remove per-host windows (medium).**
- Delete `ensureView`, `openComputer`'s view swap, `WorkspaceViewCache`, `hiddenEvents`, `SWAP_SETTLE_MS` and the `owners` map from `index.ts`.
- Notifications open the host and thread through the same selection path.
- Update `docs/ARCHITECTURE.md`.

**Phase 6: cleanup.** Remove the compatibility shims from phases 1 to 3 and the old tests for window swapping.

## Risks and open questions

- **Terminals:** output is streamed per session. Hosts that are not shown must keep their buffers bounded. Check `HiddenEvents` limits and carry them over.
- **Agent streaming volume:** with every host's events in one renderer, a busy host can starve the UI. Batch or throttle per host.
- **Settings:** some settings are per host (`computers.settings.*`), some are device-wide. List them before namespacing so device-wide ones stay shared.
- **Single-host users** must see no change and no regression. Phase 1 to 3 default to the local host.
- **Crash isolation:** one renderer means a renderer crash affects every host. Today a crash only affects one window.
- **Mobile:** it needs no refactor. It is already one app that holds every host, with host-scoped ids (`scoped(computerId, id)`) and `store.invoke(computerId, ...)`. Its client model can inform the shared `invoke` signature. Row labels use `project · host` on both platforms.

## Order of value

Phases 0 to 2 are low risk and make the data layer host-aware, and Phase 0 evens out the shared UI state. They do not remove the flash or the splash reloads, because those need Phase 5. Phases 3 to 5 are what remove the window swapping, and they should be done together on a branch.
