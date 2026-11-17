# UI development

The desktop renderer (`apps/web`) uses shadcn/ui on Base UI, Tailwind 4 and Ramu's theme tokens. The phone app (`apps/mobile`) is React Native with its own components (see its [README](../../apps/mobile/README.md)). What each feature does for people is in the [guide](../README.md).

## Components

- Add registry components with `pnpm ui:add <component>`. `apps/web/src/components/ui/` is upstream-owned. Never edit or copy it for Ramu behavior. Build app components beside it, as `components/desktop-button.tsx` does.
- Use the app-owned controls, never raw elements (`sharedButtons.test.ts` rejects raw buttons):

| Control | Use |
| --- | --- |
| `desktop-button.tsx` | Every desktop action |
| `row-button.tsx` | Selectable rows |
| `drag-handle.tsx` | Reorder handles |
| `inline-action.tsx` | Host mutations and external links |
| `desktop-checkbox.tsx`, `desktop-input.tsx` | Form controls |

- Base UI triggers use `render`, not `asChild`. Dialogs use `onOpenChange(open, details)`.
- `ui.css` maps colors and type to tokens and `styles.css` holds shared sizing. Tailwind preflight is off because Monaco and xterm style themselves.
- Brand marks: `ProviderIcon` for agent providers, `DeviceIcon` for operating systems and `BrandIcon` (`components/brand-icon.tsx`) for forges, hosting platforms and services, typed by `BrandId` in `packages/shared/src/brands.ts`. A mark sits beside the brand's name, never instead of it. Add a mark to `apps/web/src/assets/brands/` with its source in its `SOURCES.md`, then run `node apps/mobile/scripts/gen-assets.mjs` so the phone gets it too.
- Settings wait for **Save changes**. Settings stored outside app preferences stage through `useStagedValue` (`settings/stagedChanges.tsx`). Lists use `SettingsCard` and `usePaged`.

## Motion

`packages/shared/src/chat/presentation.ts` is the shared reference for desktop and phone: 180 ms, a 4-point rise and one easing curve. New blocks fade and rise. History, pagination and recycled rows don't animate. System and in-app Reduce Motion turn it all off.

## Copy

Every visible string goes through `t()` with an Indonesian translation ([Localization](localization.md)). Name things the way the product does: **thread** in copy, `task` in code.

## Command palette

`apps/web/src/palette/` is a set of sources, each its own group. With no prefix it searches files, projects, threads and file text. `>` runs commands and `#` searches file contents. To add a source, write a `PaletteSource` (`palette/sources.ts`) and list it in `Palette.tsx`. A source that waits on the server needs a debounce and a minimum length, and must honour `signal`.

## Shortcuts

Commands and their keys live in `apps/web/src/commands.tsx`. Show the shortcut in the control's title with `formatKeys`.

## Isolated content

Theme previews run on a `ramu-theme:` origin and interactive documents on `ramu-content:`. Never render generated documents through terminal or Markdown HTML ([Artifacts](../guide/artifacts.md)).

## Testing UI

Pure parts get unit tests in `apps/web/test`. Visible desktop changes run `pnpm build` then `pnpm test:desktop-smoke`. Include screenshots in pull requests.
