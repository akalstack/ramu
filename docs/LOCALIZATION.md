# Localization

Ramu supports English and Bahasa Indonesia. **Settings → Appearance → Language** offers both and **Follow system**. Changes apply after saving; explicit choices override the OS. Dates follow the selected language, while schedules retain their saved timezone.

Follow system uses the first supported OS language, falling back to English. `id-ID` and legacy `in` codes resolve to Indonesian.

## Adding copy

English strings are translation keys and fallbacks. Indonesian translations live in `packages/shared/src/locales/id.ts`. Use `t()` and `useLanguage()` in renderer components; native menus and notifications use `src/main/localization.ts`.

- Use short, direct labels and actionable errors. Explain consequences in confirmations.
- Translate complete sentences. Preserve placeholders for names and counts.
- Keep user text, code, paths, project names, provider output, and model names unchanged.
- Keep familiar developer terms such as Git, commit, workspace, and terminal. Use natural Indonesian for actions: Cari, Simpan, Batal, Hapus.
- Include language in dependencies for memoized translated text. Update both languages when changing copy and remove unused strings for retired features.

## Checks

Run `pnpm typecheck` and `pnpm test`. Add focused unit tests for localization changes. After building, run `pnpm test:desktop-smoke` for startup validation; manually verify language switching, persistence, native menus and editor buffers when changing them.
