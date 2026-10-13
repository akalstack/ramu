# Localization

Ramu supports English and Bahasa Indonesia. **Settings → Appearance → Language** offers both and **Follow system**. Changes apply after saving; explicit choices override the OS. Dates follow the selected language, while schedules retain their saved timezone.

Follow system uses the first supported OS language, falling back to English. `id-ID` and legacy `in` codes resolve to Indonesian.

## Adding copy

English strings are translation keys and fallbacks. Indonesian translations live in `src/shared/locales/id.ts`. Use `t()` and `useLanguage()` in renderer components; native menus and notifications use `src/main/localization.ts`.

- Use short, direct labels and actionable errors. Explain consequences in confirmations.
- Translate complete sentences. Preserve placeholders for names and counts.
- Keep user text, code, paths, project names, provider output, and model names unchanged.
- Keep familiar developer terms such as Git, commit, workspace, and terminal. Use natural Indonesian for actions: Cari, Simpan, Batal, Hapus.
- Include language in dependencies for memoized translated text. Update both languages when changing copy and remove unused strings for retired features.

## Checks

Run `pnpm typecheck` and `pnpm exec vitest run test/i18n.test.ts test/chatDates.test.ts test/editMenu.test.ts`. After building, `node scripts/i18n-smoke.mjs` checks switching, persistence, native menus, and editor buffers with an isolated profile.
