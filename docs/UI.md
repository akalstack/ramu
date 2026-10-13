# UI development

The renderer uses shadcn/ui with Base UI, Tailwind 4, and shared theme tokens. `components.json` defines paths and the `@` alias.

Add components with `pnpm ui:add <component>`. Review generated changes before replacing customized components. Base UI triggers use `render`, not `asChild`; dialogs use `onOpenChange(open, details)`, `initialFocus`, and `finalFocus`.

`ui.css` maps colors and typography to Ramu's tokens. `styles.css` contains shared desktop sizing. Tailwind preflight is omitted because Monaco and xterm manage their own styles. Reuse shared components for menus, dialogs, list rows, and empty states. Respect reduced-motion preferences.

## Workspace and terminals

Chat and workspace panes share a resizable split. Bottom terminals span both panes. Right-docked terminals have their own column. Resize handles support dragging and arrow keys, Home, and End.

Terminal tabs contain groups of panes. Splitting keeps the shell in its group; moving a pane to a tab preserves it. Hidden groups keep running. Layout and grouping persist with workspace state.

Editors, terminals, and attachments use native context menus. Keep clipboard and save-dialog operations in the main process.

## Branding

See [branding assets](../assets/branding/README.md) and [provider logos](../src/renderer/src/assets/providers/README.md) for source assets and attribution.

For packaging and updates, use the [release guide](RELEASING.md).
