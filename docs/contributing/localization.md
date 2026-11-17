# Localization

Ramu supports English and Bahasa Indonesia. **Settings → Appearance → Language** offers both and **Follow system**. Changes apply after saving, and an explicit choice overrides the OS. Dates follow the selected language. Schedules keep their saved timezone.

Follow system uses the first supported OS language, falling back to English. `id-ID` and the old `in` code resolve to Indonesian.

## Adding copy

English strings are the translation keys and fallbacks. Indonesian translations live in `packages/shared/src/locales/id.ts`. Use `t()` and `useLanguage()` in renderer components. Native menus and notifications use `apps/desktop/src/main/localization.ts`. The mobile app uses `useT()` for named strings and `useSay()` for copy written in English at the call site, and both read the same shared dictionary.

- Use short, direct labels and actionable errors. Explain consequences in confirmations.
- Translate complete sentences. Preserve placeholders for names and counts.
- Keep user text, code, paths, project names, provider output and model names unchanged.
- Keep familiar developer terms such as Git, commit, workspace and terminal. Use natural Indonesian for actions: Cari, Simpan, Batal, Hapus.
- Include the language in the dependencies of memoized translated text. Update both languages when changing copy, and remove strings for removed features.

## Tests

Add focused unit tests for localization changes, and manually verify language switching, persistence, native menus and editor buffers when changing them.
