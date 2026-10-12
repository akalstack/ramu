# App languages

Ramu supports English and Bahasa Indonesia. **Settings → Appearance → Language** offers Follow system (the default), Bahasa Indonesia, and English. Save changes to apply a choice. Cancel keeps the saved language. The choice persists on this device and switching does not remount editors, terminals, or chats.

Follow system reads Electron's preferred OS languages, chooses the first supported language, and falls back to English if none are supported. Indonesian regional codes such as `id-ID` and the legacy `in` code resolve to Indonesian. The app checks system languages again on focus and when saving Follow system. Explicit choices override the OS. Older preference records default to Follow system.

## Copy and implementation

English source copy is the translation key and fallback. Indonesian copy lives in `src/shared/locales/id.ts`; language resolution and interpolation live in `src/shared/i18n.ts`. Renderer components use `t()` for app-owned copy and `useLanguage()` to update when the language changes. Include the language in dependencies for memoized translated copy. Desktop menus and app notifications use `src/main/localization.ts`.

Use concise, friendly Indonesian: “Mau kerjain apa hari ini?”, “Cari pengaturan”, “Simpan perubahan”. Use “kamu” where helpful, avoid stiff literal translations, and keep familiar developer terms such as Git, commit, terminal, and model names. Keep English when an Indonesian equivalent is uncommon or sounds forced. Use familiar technical terms consistently in labels and helper text: Explorer, Source Control, command palette, workspace, repository, provider, fallback, sub-agent, preview, review, refresh, undo, word wrap, AI completion, language server, reasoning, effort, and service tier. Preserve effort names (Light, Low, Medium, High, Extra High, Max). Keep everyday actions in natural Indonesian, such as Cari, Simpan, Batal, and Hapus. Keep confirmations precise about what changes or gets deleted. Language names remain Bahasa Indonesia and English in either interface.

Translate complete sentences with placeholders for names and counts. Pass user text as interpolation values; do not translate project names, paths, source code, terminal output, or chat/agent content. New strings fall back to their English source until added to the catalog. Dates and times follow the selected interface language while schedules keep their saved timezone.

## Verification

- `pnpm typecheck`
- `pnpm exec vitest run test/i18n.test.ts test/chatDates.test.ts test/editMenu.test.ts`
- `pnpm build && node scripts/i18n-smoke.mjs`

The Electron smoke check uses a temporary profile and repository without model calls. It checks cancellation, live switching, native menus, translated settings search, restart persistence, unsaved editor buffers, and OS language overrides. Screenshots are written to `output/playwright/languages/`.
