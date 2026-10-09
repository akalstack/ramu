# Editor formatting, linting, language servers and completion

## Format and lint with the project's own tools

Ramu does not bundle formatters or linters. For each file it looks from the file's folder up to the repository root for a tool's configuration (or a direct dependency in `package.json`) and an installed copy in `node_modules`, then runs that tool, so results match the project's CI and other editors. Tools are Node scripts and run on the background service's own runtime, so they work when the app is launched from Finder without a shell `PATH`.

| Tool | Formats | Lints | Lints unsaved text |
| --- | --- | --- | --- |
| Oxfmt | yes | | |
| Biome | yes | yes | no, the saved file |
| Prettier | yes | | |
| ESLint | | yes | yes |
| Oxlint | | yes | no, the saved file |
| Ruff (Python) | yes | yes | yes |
| gofmt (Go) | yes | | |
| rustfmt (Rust) | yes | | |

- **Native tools.** Ruff, gofmt and rustfmt are found in the project's `.venv`/`venv`, then on `PATH` plus the usual install folders (Homebrew, `~/.cargo/bin`, `~/go/bin`, `/usr/local/go/bin`), because an app launched from Finder has a minimal `PATH`. They are used when the project is configured for them: `ruff.toml` or `[tool.ruff]` in `pyproject.toml`, `go.mod`, `Cargo.toml` (rustfmt gets the crate's `edition`). Ruff and gofmt were checked against the real tools; rustfmt is covered only by tests with a stand-in executable.
- **Formatter choice.** The first configured formatter wins, in the order Oxfmt, Biome, Prettier. With none, **Format document** (⇧⌥F, the palette, or the editor context menu) uses Monaco's built-in formatter for languages it supports.
- **Linters.** Every configured linter runs and the results are merged. Problems appear as squiggles, with the rule linked when the tool provides a URL, and the header summarizes them.
- **Unsaved text.** Formatters and ESLint read the editor buffer from stdin; nothing is written until you save. Biome and Oxlint cannot lint stdin, so they check the saved file when a file is opened or saved, and their markers are cleared as soon as you edit so they never point at moved lines.
- **Settings.** *Format on save* is off by default. *Lint while editing* re-checks about a second after you stop typing, with one run in flight per file; when off, files are checked on open and save.
- **Monorepos.** The nearest configuration wins and the tool runs from that folder.

## Language servers

TypeScript and JavaScript files (`ts`, `tsx`, `js`, `jsx`, `mjs`, `cjs`, `mts`, `cts`) get project-aware completion (including auto-imports from other files), hover, go to definition, signature help and the real type errors. Like the lint and format tools, Ramu uses the project's own TypeScript:

- **TypeScript 7 or newer.** The project's native compiler is itself a language server (`tsc --lsp --stdio`) and is started directly.
- **TypeScript 5 or 6.** Ramu's bundled `typescript-language-server` drives the project's own `tsserver`.
- **No TypeScript in the project.** Ramu's bundled TypeScript is used, so loose files still get a server.

Behaviour worth knowing:

- Servers see the editor's unsaved text. Edits are sent after a short pause and always flushed before a request.
- One server runs per repository folder. The same file open in several chats is opened once, and servers stop about three minutes after their last file closes. Closing the window releases every document, since the background service outlives it. At most six servers run at once.
- A crashed server is restarted with its open files replayed. If it keeps crashing, Monaco's built-in TypeScript support takes over again.
- TypeScript 7 does not push diagnostics, so Ramu asks for them after edits settle; TypeScript 5 and 6 push them.
- While servers are on, Monaco's own TypeScript completion, hover, definition and diagnostics are switched off so results are not duplicated. Turn them off in Settings ("Language servers") to go back to the built-in behavior, which checks each file alone.
- Go to definition opens files inside the task's repositories as editor tabs. Library typings elsewhere on disk are not opened.
- Other languages (Python, Go, Rust) have formatting and linting above but no language server yet. Adding one means writing an adapter in `src/main/lsp.ts`; none was added because no such server could be tested here.

## AI inline completion

Grey ghost text suggests the next lines; Tab accepts. It is **off by default** (Settings → Editor & Terminal) because a cloud provider receives the code around the cursor.

- **Ollama (local).** Runs on your machine and is the default choice. Settings lists fill-in-the-middle models (the Qwen2.5-Coder family, 1.5B to 32B) with their download size and how well each suits *this* machine, and recommends one. The recommendation uses a slice of memory so the editor and agents still have room: unified memory on Apple Silicon (8 GB gets 1.5B, 16 GB gets 3B, 24-32 GB gets 7B, 48 GB or more gets 14B), the GPU's memory for NVIDIA cards, and a small model for CPU-only machines. Leave the choice on "Recommended for this device" to follow it, pick any listed model, or enter another Ollama model name. Models already installed in Ollama appear in the list too. If the chosen model is missing, **Install** downloads it through Ollama with a progress bar; nothing is downloaded until you click it. Use base models: instruct models complete code poorly. The 1.5B and 3B models were run live; the larger sizes share their template but were not downloaded here.
- **Codestral (Mistral).** A cloud fill-in-the-middle API. Free keys are rate limited and have their own terms, so check Mistral's console before using it for work code. After a rate limit Ramu pauses requests for the time the provider asks and shows "AI completion paused" in the editor header.

How it stays safe:

- Requests are made by the main process, not page code. The API key is encrypted with the operating system keychain, is bound to the endpoint it was saved for, and is never sent anywhere else. The renderer only learns whether a key exists.
- **Repository context (local Qwen coder models only).** Ahead of the current file the model gets, as `<|file_sep|>path` blocks (about 5,000 characters in all): your other open files in the task (most recently used first); the files the current file imports through relative paths; and **definitions found anywhere in the repository**, including files that are neither open nor imported. For that last part Ramu takes the identifiers nearest the cursor (the word being typed first), searches the repository with ripgrep for where each is declared (functions, classes, types, constants, methods, in JavaScript/TypeScript, Python, Go and Rust style), and adds a short snippet of each, source files before tests. Lookups are remembered for a minute and never delay a suggestion by more than about a third of a second. Large files are cut down to their exported declarations.
  - **Measured, with limits.** On six cases written to need knowledge from another file (completing `queue.enqueueUr` to `enqueueUrgent`, the second argument of a function, and so on) against a live Ollama: with open and imported files as context, `qwen2.5-coder:1.5b-base` got 6 of 6 and the 3B model 6 of 6, against 1 of 6 and 3 of 6 without. With files that were neither open nor imported, retrieval got 4 of 6 for both models, against 0 of 6 and 1 of 6 without it. It cannot help when nothing near the cursor names the thing, such as `p.last` on an untyped parameter; that needs type information from a language server. The cases were written to need cross-file knowledge, so read the numbers as showing the mechanism works, not as a general quality score.
  - **Privacy.** Only local models receive this context. Other models and Codestral get just the code around the cursor, so a cloud provider never sees extra files.
- At most about 4,000 characters before and 1,500 after the cursor are sent. Typing waits for a short pause, and stale requests are cancelled.
- Files that commonly hold secrets (`.env*`, keys, certificates, `credentials`, `secrets.*`) are never sent to a cloud provider.

Tests use local mock servers for both providers, so they confirm request and response handling. A live Ollama with `qwen2.5-coder:1.5b-base` and `3b-base` was also checked by hand (clean fill-in-the-middle output, 75-215 ms once warm for the 1.5B model); `RAMU_LIVE_OLLAMA=1 pnpm test` repeats the cross-file check. Codestral was never called live.
