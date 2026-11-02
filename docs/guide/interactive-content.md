# Interactive content

Agents can publish small interactive documents in a thread: explanations, diagrams, data explorers, calculators and prototypes. Their controls run locally with no further model call.

## In a thread

Each document appears as a card. The card can **Reset**, switch width (Fit, Tablet, Phone), **Expand**, show older **Versions**, keep **Saved scenarios**, and **Export** HTML or source. **Ask about this** adds the document, with its current state, to your next message; **Choose values** attaches only the values you pick.

Documents run in an isolated, sandboxed frame with no access to your files or Ramu. They are offline unless the agent declared the exact HTTPS sites they need. On the phone they open in a separate private browser.

## For agents

Agents use `preview_interactive` to test a document (one HTML file or a small project, up to 512 KB) and `publish_interactive` to publish the exact tested version. Preview clicks the declared controls in a headless browser, takes screenshots at phone and desktop widths, and blocks publication on script errors or failed checks.

- Pinned libraries: React 19.3.0, Chart.js 4.6.1, Dagre 2.0.4.
- `<link rel="stylesheet" href="ramu:kit">` adds app-styled cards, buttons, badges, tables and tabs; `<svg data-icon="name">` inserts a [Lucide](https://lucide.dev) icon. Both work offline.
- Theme variables (`--background`, `--foreground`, `--primary`, `--surface`, `--border`, `--chart-1` to `--chart-6` and more) follow the app's colors and light or dark mode.
- `window.ramuContent.setState()` and `onRestore()` keep custom state between views.
