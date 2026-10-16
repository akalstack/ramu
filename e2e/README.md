# End-to-end tests

Specs drive the built desktop app (`apps/desktop/out`) and standalone servers (`apps/server/dist`) with simulated providers (`RAMU_FAKE_AGENT`), disposable Git repositories and an isolated profile. Run `pnpm build` first.

```sh
pnpm test:e2e                # every gating spec in e2e/specs
pnpm test:e2e settings goals # specs whose file name contains one of the words
pnpm test:e2e:perf           # on-demand performance and chaos checks in e2e/perf (not part of CI)
pnpm test:e2e:perf fps
```

Specs are plain `node:test` files run by `e2e/run.mjs`, one process per file, one app launch per file.

## Headless and headed

Windows are hidden by default: the launcher sets `RAMU_E2E_HEADLESS=1`, so the desktop main process creates its windows with `show: false`, hides the Dock icon, and disables background throttling. The page is told it has focus, so focus-gated code runs. Nothing steals focus. Set `RAMU_E2E_HEADED=1` to show the windows. Perf numbers (frame rate, paint timing) are more representative headed.

## Writing a spec

```js
import { startRamu } from '../support/index.mjs'
const ramu = await startRamu('my-feature', { repos: { demo: { 'a.txt': 'x\n' } } })
ramu.test('does a thing', async () => {
  await ramu.page.getByRole('button', { name: 'Home' }).click()
  ramu.check(true, 'it worked')
})
```

`support/app.mjs` launches the app (`ramu.page`, `ramu.app`, `ramu.api` for the server's local socket, `ramu.relaunch`, `ramu.shot`), `support/ui.mjs` holds shared UI flows (`startChat`, `showChat`, `openSettings`, `palette`), `support/util.mjs` has `until` and `createRepo`. A spec is a journey: after the first failing test the rest are skipped.

## Performance and chaos checks (`e2e/perf`)

On-demand, never part of CI or `pnpm test:e2e`. They use the same launcher and run as `node:test` files through `pnpm test:e2e:perf [name]`:

| Name | What it does |
| --- | --- |
| `fps` | Frame times for pane drags, tool, sidebar and terminal toggles and window resizes on a long thread. Set `RAMU_FPS_BUDGET_MS` to fail when a p95 exceeds it. Run headed (`RAMU_E2E_HEADED=1`) for representative numbers. |
| `rendering` | A 5,000-file review, its file tree and a 500-match search mount a bounded number of rows and diff editors. |
| `remote-scale` | Six paired computers behind loopback proxies: only four clean workspace views stay warm; dirty editors, terminals and open settings are pinned. |
| `chaos` | Hostile input (`chaos-payloads.mjs`) against every text surface and the IPC layer. Each surface records findings instead of stopping; `findings.json` is written to `e2e/output/chaos`. |

## Output

Screenshots and the failure screenshot go to `e2e/output/<spec>/` (override with `RAMU_E2E_SCREENSHOTS`), uploaded by CI on failure. `RAMU_PACKAGED_EXECUTABLE=/path/to/Ramu` runs the specs against a packaged app. `RAMU_E2E_APP_DIR` points at another desktop checkout.
