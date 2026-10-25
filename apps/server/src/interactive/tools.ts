import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { interactiveInput, type InteractiveStore } from './store'
export const INTERACTIVE_GUIDE = `Create Interactive Content when working with something beats reading about it: architecture and request-flow diagrams, algorithm or state-machine walkthroughs, data/log/JSON explorers, API, regex or config playgrounds, UI prototypes, performance or cost comparisons, calculators and simulations. Use the conversation's real code, data and numbers rather than placeholders. Use preview_interactive then publish_interactive; the card opens live in the chat, so the first frame must already be useful.
Quality bar: complete and dependable rather than decorative. Lead with the answer (the key diagram, chart or result) and let controls refine it; label units, states and edge cases; keep layout dense, aligned and readable in the app's dark/light theme; use motion only where it explains change. When the user asks for something creative (a game, story or illustration), make it a finished, polished piece with considered art and evolving state. Check the preview screenshot critically and revise visual flaws, clipped text or dead controls before publishing.
Structure: send one html document, or files [{path, content, encoding?}] with an HTML entry (default index.html). Local CSS, classic scripts, SVG and base64 assets are inlined. For React/TSX use <script type="module" src="./src/main.tsx"></script>; local JS/TS/TSX/JSON/CSS and asset imports are compiled before preview. Available pinned imports: react, react/jsx-runtime, react-dom/client, chart.js, chart.js/auto, chart.js/helpers, @dagrejs/dagre. Use Chart.js for interactive charts and Dagre plus accessible SVG for flow/architecture diagrams. Simple diagrams can use SVG directly. No arbitrary package installs, Node imports or host filesystem access. Use imported assets in modules; strings containing file paths are not imports. Sources, library versions and the exact tested runnable bytes are retained with each publication.
Runtime: new documents work offline by default, including bundled libraries. If remote data or resources are essential, declare network: {resources: ["https://images.example.com"], connect: ["https://data.example.com"]}; use exact public HTTPS origins, not paths, wildcards or broad CDN access. Resources and API connections are separate, immutable per published version. Prefer bundled libraries and local assets. No eval/new Function is available in new documents. Plain http, frames, forms, plugins, page navigation, local files and app commands are unavailable; controls run locally with no model call. Remote parts are missing when the reader is offline, so prefer the kit and icons for app-styled UI and use libraries for heavy lifting. Use accessible labels, keyboard controls and responsive layouts; preview checks narrow phone, phone, tablet and desktop widths and returns phone/desktop screenshots, your console.log/info/warn output, script errors and failed remote loads, so check both screenshots and fix every failure. Leave html, body and the outermost element without a background, border or outer card, and do not repeat the title as a heading: the card header already shows it and the document sits on the thread's own background. Give charts fixed pixel heights; viewport height units (vh, svh, lvh, dvh) are rejected because the frame grows to fit the content. Include check actions with expected visible text. Preview validates rendering/observed behavior, not factual accuracy. For custom state use window.ramuContent.setState(JSON-compatible data), onRestore(state=>...), and onActive(active=>...) to pause animation offscreen. Standard input/select/textarea values restore automatically. Theme tokens follow the app's live palette and light/dark mode: --background, --foreground, --muted (secondary text), --primary (brand accent), --surface (cards), --surface-raised (buttons, inputs), --border, --code-background, --button and --button-foreground (solid actions), --success, --warning, --danger, --chart-1 to --chart-6, --radius, --font-sans, --font-mono. Artwork may use its own palette.
Built-ins (inlined at preview, so they work offline and never change after publishing; prefer them over a CSS framework): <link rel="stylesheet" href="ramu:kit"> adds app-styled defaults for headings, inputs and :focus-visible plus classes .card, .btn (data-variant=primary|ghost|danger, data-size=sm|icon), .badge, .callout, .dot and .bar>span (data-tone=primary|success|warning|danger), .stat/.stat-label/.stat-value/.stat-delta, .table (td.num right-aligns), [role=tablist]/[role=tab][aria-selected], .field, .stack, .row, .grid, .muted, .small, .mono, .num; all rules have zero specificity so your CSS wins. Any Lucide icon: <svg data-icon="chevron-right"></svg> (kebab-case name; sized 1em, currentColor; add aria-label for meaningful icons). For icons created from JS, put them in a <template> and clone them. Prefer the kit and icons over hand-drawn equivalents.
Revisions: read the current version, preserve content id/expected version and resend all files. Set stateSchema to the same explicit identifier across revisions ONLY when control keys and custom JSON retain the exact same meaning; otherwise use a new identifier or omit it. Do not put document bytes in chat or claim static screenshots are working interactions.`
export function registerInteractiveTools(server: McpServer, store: InteractiveStore, session: string) {
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  server.registerTool(
    'preview_interactive',
    { description: INTERACTIVE_GUIDE, inputSchema: interactiveInput.shape },
    async (input, extra) => {
      const preview = await store.preview(session, input, extra.signal)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              ...preview,
              screenshot: undefined,
              wideScreenshot: undefined,
              lightScreenshot: undefined,
            }),
          },
          { type: 'text' as const, text: 'Screenshot at 390 px (phone):' },
          { type: 'image' as const, mimeType: 'image/png', data: preview.screenshot.split(',')[1]! },
          ...(preview.lightScreenshot
            ? [{ type: 'image' as const, mimeType: 'image/png', data: preview.lightScreenshot.split(',')[1]! }]
            : []),
          ...(preview.wideScreenshot
            ? [
                { type: 'text' as const, text: 'Screenshot at 900 px (desktop):' },
                { type: 'image' as const, mimeType: 'image/png', data: preview.wideScreenshot.split(',')[1]! },
              ]
            : []),
        ],
      }
    },
  )
  server.registerTool(
    'publish_interactive',
    {
      description:
        'Publish a previewed Interactive Content version in this conversation. Supply a stable requestId for retries; use previous to revise an existing version. Failed/expired previews cannot publish. The saved event appears independently of this tool result.',
      inputSchema: {
        previewId: z.string().uuid(),
        requestId: z.string().min(1).max(160),
        previous: z.object({ id: z.string().uuid(), version: z.number().int().positive() }).optional(),
      },
    },
    ({ previewId, requestId, previous }) => result(store.publish(session, previewId, requestId, previous)),
  )
  server.registerTool(
    'interactive_read',
    {
      description:
        'Read the saved source (html, and files for multi-file projects) of an Interactive Content version before revising it. Only this conversation can read it.',
      inputSchema: { id: z.string().uuid(), version: z.number().int().positive() },
    },
    ({ id, version }) => result(store.get(session, id, version)),
  )
  server.registerTool(
    'interactive_list',
    { description: 'List saved Interactive Content versions belonging to this conversation.', inputSchema: {} },
    () => result(store.list(session)),
  )
}
