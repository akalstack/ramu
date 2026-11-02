# UI development

The renderer uses shadcn/ui on Base UI, Tailwind 4 and shared theme tokens. `components.json` defines paths and the `@` alias. Mobile specifics are in the [mobile guide](../apps/mobile/README.md).

## Components

- Add registry components with `pnpm ui:add <component>` and review the generated change. `apps/web/src/components/ui/` is upstream-owned: never edit or copy it for Ramu behavior. Compose app components beside it, as `components/desktop-button.tsx` does, keeping shared variants, tokens and interaction states there and preserving refs, accessibility and composition APIs.
- Base UI triggers use `render`, not `asChild`; dialogs use `onOpenChange(open, details)`, `initialFocus` and `finalFocus`.
- Use the app-owned controls instead of raw elements. `sharedButtons.test.ts` rejects raw buttons (the one exception is the theme-recovery control, which uses a fixed palette so a bad trial cannot remove the way back).

| Control | Use |
| --- | --- |
| `desktop-button.tsx` | Every desktop action, including drag handles and inline Settings actions. Respects host-field restrictions and the text-size preference. |
| `drag-handle.tsx` | Reorder activators (queues, commands, model steps, fallbacks, accounts, favorites). |
| `row-button.tsx` | Selectable rows with hover, focus and disabled states. |
| `inline-action.tsx` | Host mutations (field-aware) and external links. |
| `sidebar-disclosure-button.tsx`, `summary-disclosure-button.tsx` | Sidebar and worked-for disclosures. |

- `ui.css` maps colors and typography to Ramu's tokens; `styles.css` holds shared desktop sizing. Tailwind preflight is omitted because Monaco and xterm manage their own styles. Reuse shared components for menus, dialogs, list rows and empty states.
- Tabs (browser and others) share selected, hover, focus and disabled styling with Arrow/Home/End navigation that skips disabled or hidden tabs.
- Settings lists (memories, approvals, skills, learning reviews) use `SettingsCard` from `settings/cards.tsx` and page with `usePaged` (20 items, 10 for skills and reviews, then **Show more**).
- Customize colors previews the candidate with production components, a read-only Monaco code/diff sample on an isolated `ramu-theme:` origin, xterm ANSI output and an interactive chart. Previews have no workspace, file or provider access and never change the selected theme.

## Motion and chat presentation

`packages/shared/src/chat/presentation.ts` is the shared reference for desktop and mobile: 180 ms, a 4-point rise and one easing curve.

- Disclosures (tool groups, thinking, helpers, file changes, worked-for summaries, questions, goals, queued messages) ease height and opacity. New assistant blocks fade and rise; initial history, pagination and recycled rows do not replay motion. Streamed replies keep existing text still and fade only new words.
- Phase labels (Starting, Working, Thinking, Writing, compacting) fade on change; elapsed-time ticks never restart them. Running tool labels use `TOOL_MOTION`: a 2.2 s highlight, then one completion highlight.
- While a turn runs, on mobile a status line docked above the composer (`WorkingLine`, `currentStep` in `@ramu/shared/chat/agentActivity`) says what the agent is doing, with the running command or file, and how long the turn has run. It never scrolls away and sits beside the composer's Stop; the transcript's "Worked for …" summary takes over when the turn ends.
- System Reduce Motion and the app's Reduce Motion preference disable all of it.
- A message being sent shows immediately and is replaced by the host's transcript or queue entry. The draft clears only after acknowledgement, so a failed send stays recoverable, and sending restores scroll following.
- Reference chips (files, folders, skills, commands, quotes) are inline accent links with a glyph (`REFERENCE_APPEARANCE`); the full target is the accessible label.
- Consecutive tool calls share one row; read, edit and write rows show only the file name (`@ramu/shared/chat/fileTools`) and open to the path and diff.
- Typing `/` lists commands and skills, `@` files, `$` skills, through one parser (`packages/shared/src/chat/composerTrigger.ts`). `$` opens only before a skill name, so `$5` and `$HOME` stay text.
- The unsent message is stored per host and thread (or new-thread scope) on the device and restored on return; a late acknowledgement clears only the state it sent.

## Workspace and terminals

- Git status, branches, history, stashes and counts are cached by host, repository and checkout path, so threads on the same checkout share the latest state.
- Thread and workspace panes share a resizable split (drag, arrows, Home, End). Terminals live in tabs of pane groups; hidden groups keep running; layout persists.
- Markdown opens in **Preview**; the header offers **Source** and **Edit**. Settings → Editor sets the default.
- Editors, terminals and attachments use native context menus; clipboard and save dialogs stay in the main process.
- **Background terminals** are commands Ramu launched for a thread (`term.background.*`), owned by the host, not a tab. The activity dock shows a count while any exist. **Open output** attaches by identity without starting a shell. **Stop** asks the process group to end (*Stopping*), then **Force stop** appears. Ownership and the last 64,000 characters of output persist in SQLite, checkpointed about once a second. After a restart, commands without a verified live handle show **Unknown**: inspect-only, never controlled by a saved PID.
  - Agents use `background_terminal_launch`, `_list`, `_inspect` and `_stop`. Launch runs in the session's checkout and thread. In Full access it runs directly; otherwise each launch asks once for approval of the exact command. Sub-agent launches are labelled.
  - Deleting a thread lists unsettled commands first and stops them; graceful stop has a three-second budget before offering Force stop. Unknown records must be explicitly forgotten, and worktree removal is blocked while any status is unknown. Bulk deletion refuses unsettled commands.
  - Mobile shows the same commands in a read-only sheet; Stop and Force stop recheck ownership and capabilities.
- The bottom bar shows the current background job (or a count) beside a bell for retained notifications; both open one **Notifications and activity** popover. Running jobs offer **Stop** only where the host supports cancellation (update checks, memory maintenance, learning, recaps, managed runtime updates).

## Usage limits

The model picker is search, a strip of All, Sets and each provider that reports models, then one compact list: Favorites, then a heading per provider carrying its remaining usage. **Choose models** opens Settings → Providers, where each provider has **Models** to pick what pickers and dropdowns list, on desktop and mobile. Providers list everything until narrowed, and a narrowed list keeps new models out. Models left out don't appear in search either; a favorite or the model in use still shows.

Marking threads done or archiving them (one, a project's, or a selection) shows an **Undo** toast on desktop and mobile. Pin, Reopen and Unarchive have none: the thread stays where the person is looking and one click reverses them.

Desktop toasts sit bottom-right above the status bar and step left while the notification popover is open, so neither covers the other. On mobile, errors appear under the header, clear of the keyboard and composer, and never block a press; toasts with a button such as **Undo** stay near the bottom within reach.

A thread at a usage limit is idle, not failed. Every surface reads **Limit reached · resumes around 5:00 PM** (or **resuming automatically** when the time is a guess); **Paused** means only a goal the person paused. The sidebar clock, Home and Inbox groups, goal bar and mobile transcript all read the thread's `provider-wait` event through `packages/shared/src/chat/providerWait.ts` and `limitPolicy.ts`.

- **Settings → Models → When a usage limit is reached** is one choice: **Switch to another model**, **Wait on this model** or **Stop and let me decide**. It writes `defaultAutoFallback` and `fallback.autoResume` (`settings/LimitChoiceRow.tsx`).
- The tray row (`models/ProviderWait.tsx`) offers **Try anyway**, **Try again** or **Resume** (all `agent.retryLimitNow`) and a per-thread **Auto-resume** menu (`agent.setAutoResume`). The provider chip menu also lists **Continue with <provider>** for each provider not known to be limited.
- While at a limit the composer says when the message will be sent, the send label is **Queue**, and Stop is hidden. A reset notice fires once per wait while auto-resume is off.
- A **Context handoff** separator names what carried over ("Carried events 1–412 from Claude (compacted handoff…)", `views/agent/handoffLine.ts`).

## Models

- The picker hides older models behind **Show legacy models**. The host publishes optional `isLegacy` metadata; without it Ramu marks an older Codex or Claude family version only when the provider reports a newer one. Aliases and unknown families are never guessed.
- Settings → Models → Model sets offers **Steps** and **Model then effort**. The read-only **Default** set spreads up to five distinct model/effort choices across available providers, ordered from the cheapest to the most capable (light models such as Flash or Haiku first, top models such as Opus or Pro last) and regenerates when catalogs change; custom sets are never overwritten.
- Mobile exposes the flow in Providers & models with an **Apply to** scope: all devices (the host setting), all mobile devices, or this phone. The effective source is shown, and **Use inherited setting** removes an override. Viewer phones can set only this phone.
- The picker follows the project's configured provider and model after catalog validation and names the source file ([Configuration](CONFIGURATION.md#repository-configuration)). Choices are revalidated before a thread is created or a message queued.

## Workspace defaults and branch names

- Settings → Git → New threads & worktrees sets the host's default checkout mode (initially Current checkout) and branch prefix. An untouched new-thread draft follows the default; a manual choice or an existing workspace wins. Plain folders and repositories without commits fall back to Current checkout.
- Fixed names are `ramu/<title-slug>` (the namespace may be empty or nested) and need no provider. **Semantic name** and **Custom instructions** send only the bounded opening message to an isolated, tool-free analysis with a 15-second deadline; failure falls back to the fixed name with a visible notice. The server allocates names (pending bindings count as collisions, generated collisions get bounded suffixes, a manual name is used exactly or rejected), stores the exact base commit, and deduplicates retries by creation request ID. Previews are advisory and never authorize a path.
- Desktop and mobile drafts keep the manual or generated branch candidate and the workspace choice per host and project for 30 days; a late send acknowledgement clears only what it sent. **Rename workspace…** edits the shared label (viewer grants cannot).

## Plan usage

Desktop account details show each allowance window for other logins, labelled as used. The next-message provider chip checks the thread's own login and previews another eligible account before another model; rotation preserves model, effort and service tier. A five-hour allowance never overrides a weekly or model-specific threshold. Mobile shows one header ring (amber at 70%, red at 90%) opening a shared detail sheet. Measured values, notice-only holds, missing values and stale readings stay distinct, and one login's readings are never substituted for another's.

## Command palette

`apps/web/src/palette/` is a set of sources, each drawn as its own group. No prefix searches files, projects, threads and file text; `>` runs commands only; `#` searches file contents only. Results never merge into one ranking.

To add a source, write a `PaletteSource` (`palette/sources.ts`) and add it to the list in `Palette.tsx`:

- `id`, `label` (translated), `priority` (group order), `modes` (`all`, `commands`, `content`).
- `query(text, { signal, limit, mode })` returns a batch, a Promise or an AsyncIterable of batches. Each result has a label, optional highlight offsets, detail, snippet and a `run` that opens it.
- `minLength`, `debounceMs`, `limit`, `initialShow`. Cheap sources use `debounceMs: 0`; anything waiting on the server needs a debounce and minimum length and honours `signal`. A new keystroke aborts the old query. Set `scope` so a running query survives source-list rebuilds but not a project switch.

Content search reuses `files.search` (ripgrep, bounded). Pure parts are tested in `apps/web/test/palette*.test.ts`.

## Integrated browser

**Settings → Browser** separates the host's agent-browser choice (integrated or provider setup, with per-provider overrides) from the device's link destination. New installations default to integrated; older settings without a choice keep provider setup. Provider-native browser tools stay available; Ramu does not rewrite provider configuration.

- **Agent access:** in Full access the agent gets status, tabs, open, snapshot, navigate, click, type, select, press, scroll, wait, screenshot, dialog and close tools, plus `browser_upload`. Other access modes and helpers ask for browser-only approval for the turn; helpers use only tabs they opened. The server derives thread and run identity and freezes the choice with the provider process.
- **Guest page:** Chromium sandbox, context isolation, no Node or preload, site permissions denied. Observations are bounded visible text and element references without cookies, storage or form values; any DOM change, navigation or ownership change expires references. Passwords, rich editors and custom widgets need a human. Screenshots are bounded JPEGs of the guest only; network excerpts keep method, origin, status and error. Both engines present themselves as plain Chromium (no automation flag, headless brand or Electron and app tokens), so sites do not treat them as bots.
- **Control:** **Take control** blocks new agent mutations, drains earlier input, then enables native mouse and keyboard; **Give control** returns it. Taking control on another of your devices moves it there; the device that had it says another device has control. A disconnect pauses control and never hands the page to the agent. Uncertain actions are never replayed. Tabs a person opens start under their control.
- **Tabs and profiles:** the pane adopts the agent's tab on first use without duplicating it, and background work never switches the selected host or thread. **Default** shares sign-ins on this host; **Temporary** is isolated per run and cleared at its end. Settings → Browser manages named profiles (bounded atomic catalog; cookies stay in Chromium partitions; Default and Temporary cannot be renamed or deleted). Clear data and Delete review the exact affected tabs first.
- **Import…** copies sign-in cookies once from Chrome, Chromium, Edge or Firefox (macOS, Linux) into a new profile, in whichever browser the profiles list belongs to: the desktop's own browser, or the host's Chromium when Host Chromium is in use (the browsers read are the ones on that computer, and cookie values stay in its process): choose a profile, then sites (none preselected; Chrome and Edge prompt for keychain access), name it, review, import. The copy runs on a private copy of the source database, keeps each cookie's host, path, secure, HttpOnly and SameSite attributes, skips partitioned and expired cookies with reasons, and reports counts. The profile stays hidden from agents until **Keep profile**; Discard, a failed write or a restart removes it. Some logins live outside cookies, so a copy does not guarantee a signed-in site.
- **Uploads and downloads:** uploads take a relative path inside the run's workspace (no `.git`, outside symlinks, directories or files over 8 MiB), staged in memory (four files, one minute). Downloads need a one-use 60-second grant before the click; the desktop stages at most two active and twenty retained files of 32 MiB each, keeps them an hour for explicit Save, and never opens them. Existing files are never overwritten.
- **Browser engine** (Settings → Browser, on the host): **Automatic** (default) uses the desktop app's own browser while Ramu is open on the host, so the desktop pane is native and not streamed, and falls back to Host Chromium when no desktop is open, as on a headless server. **Host Chromium** always uses it; it adds phone layout and upload/download transfers. A running turn keeps the browser it started with.
- **Host Chromium:** downloads on first use and never disables its sandbox. Desktop and mobile view it through a cursor-based compositor feed (up to 30 fps, newest frame only, screenshot fallback). Viewers send input through ordered requests; a change of controller or an uncertain failure drops queued actions. On the desktop you type straight into the streamed page, paste, and use editing shortcuts such as ⌘A (sent as the page's computer's own shortcut key); **Upload a file** is in the toolbar. Five seconds without a heartbeat pauses input. Viewer-role devices cannot use it.
- **Mobile viewer:** a full-screen browser layout (tabs, address field, reload, a ⋯ menu with only the actions that work for the tab), control strip, device keyboard matched to the focused field's type. The Browser pill above the composer opens it; nothing pops over the chat when the agent opens a page. While the phone controls a host page the host lays it out at the phone size and restores the default on handoff. **Open on this phone** (⋯ menu) loads the current page in a private phone WebView instead of the stream, with no cookies from the host's profiles and none kept after closing. A page on the host's `localhost` opens at the address the phone uses for the host, so it loads when the dev server listens on all addresses; otherwise the phone explains why and **Back to the host browser** returns to the stream, which pauses meanwhile. The agent keeps working in the host browser. A website or search typed into a new tab on the phone opens there directly, and **Open in the host browser** moves it to the host as your tab. The address field searches with the phone's own engine (⋯ → **Search engine**), as the desktop's does.
- Tabs show the site's same-origin favicon (globe fallback). Link context menus offer the system and integrated browser.

## Computer use

Settings → Computer use has switches for computer access, real-pointer drags, screen sharing with other hosts and paired screen runtimes. All default off, as does Locked Use (enabling it explains the signed macOS components first). Each thread still needs a screen or app grant. A paired device also needs the host's **Computer use** permission; without it the computer tray and viewers show **Request access**, and the host allows it this time, for a while or always (the browser, terminals and settings changes work the same way; see [Security](../SECURITY.md)). **Reset defaults** turns everything off and revokes sessions and viewer grants; installed tools and macOS permissions stay.

- Agents call **computer_open**, optionally naming an app. Root threads open targets once computer use is enabled on the host; helpers and hosts with it off ask for approval in the thread. Approval grants only that target; denial is remembered for the run. A phone can also share a target from its Computer menu and revoke it with **Stop computer use**, which ends only that thread's grant.
- Open Computer Use (`ocu`) is a Ramu-managed install pinned to the tested version, outside the desktop bundle. **Install & set up** installs it and launches `ocu doctor` for Accessibility and Screen Recording; settings read `ocu doctor --json` without opening onboarding. Updates need all computer sessions stopped. Custom executables must match the tested version. The installer needs Node/npm on the host.
- Desktop: the thread's Computer tray shows a slow thumbnail that opens the viewer, with **Stop the agent** and **Stop computer use**. While you control the screen, clicks, scrolling, typing and shortcuts go to it as in a remote desktop (Command and Control swap when systems differ); Escape returns the keyboard to Ramu.
- Mobile: tap clicks, double tap double-clicks, hold right-clicks, drag scrolls, hold then drag drags, pinch zooms. A keyboard button and a Keys menu send text and shortcuts one at a time, in order. Tapping a text field on a Mac raises the matching keyboard when the app reports its focused field (through Accessibility); otherwise use the keyboard button. Rows show a monitor badge and status with an always-reachable **Stop computer use**.
- Video uses WebRTC when the native module is linked and falls back to image frames otherwise; a JavaScript update cannot add the module, so rebuild the development client to enable it.

## Viewer role

On a viewer-paired desktop or phone, threads, schedules and history stay readable and question and approval replies work. Anything that changes the host is disabled with an explanation: sending, Stop/Resume, goals, model and access, routing, queue changes, attachments, helper and aside actions, edits, rewinds, schedules, settings, files, Git, terminals and host browser. Local drafts stay mounted and survive role changes; local outbox cleanup and device-only preferences remain available. Roles are read per host, a failed refresh keeps a confirmed viewer restriction, and callbacks recheck the current role before acting. The host remains the authority ([Security](../SECURITY.md)).

## Mobile surfaces

- Native navigation bar with compact two-line titles, a solid header background and a native thread menu: workspace tools (Browse files, Terminal, Background terminals, Browser, Computer, Side questions), Plan usage, thread actions (Pin, Rename, Rename with AI, Archive, Copy thread ID), then Delete. Side questions are one chat per thread.
- Bottom composers ride the keyboard (`useKeyboardInset`). List screens use the iOS 26 bottom search bar; screens with their own bottom actions put search behind a header button (`BottomSearch placement="header"`).
- A turn that changed files ends with the same Changes card as desktop. The composer has separate Queue and Steer actions and one scrolling activity row with Computer, Browser and Terminal pills when present.
- **New thread** is one native page: pick a project, then write; drafts are kept per project. Complex panels (questions) are full-screen; simple pickers are sheets.
- **Explorer:** project cards open Browse files on the current checkout; a thread's Explorer opens its exact checkout. Neither creates a thread or worktree. Directories load lazily (pages of at most 2,000 entries, **Load more files**); search is bounded to 200 matches; stale pages from another host or checkout are discarded. Long-press a row for Copy path, Share a copy, Duplicate, Move to folder, Rename and Delete (host `files.*`, never overwriting). **Add to message** and **New thread with file** stage references without sending anything; **Show in Explorer** reveals and scrolls to a file.
- Schedules: viewer phones can inspect but not create, edit, run, pause or delete.

## Related

- [Interactive content](INTERACTIVE-CONTENT.md): generated documents use a dedicated event and an isolated renderer; never route them through terminal or Markdown HTML rendering.
- [Themes](THEMES.md), [Localization](LOCALIZATION.md), [branding assets](../assets/branding/README.md), [provider logos](../apps/web/src/assets/providers/README.md), [releases](RELEASING.md).
