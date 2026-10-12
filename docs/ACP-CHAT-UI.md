# Shared ACP chat presentation

ACP describes tool calls with a human-readable `title`, an optional programmatic `name`, a tool `kind`, status, input/output, content, and file locations. Updates replace fields they include; message and thought chunks are deltas. Ramu now preserves these distinctions instead of flattening all tool results to text.

The shared boundary is `src/main/acpEvents.ts`. `AcpEvents` converts external ACP updates into durable `AgentEvent` rows, and `AcpEventEncoder` publishes standard fields from maintained hosts while preserving native extensions. `acp.ts` retains process/session/permission handling; `acpNativeHost.ts` retains owning-runner controls; `claudeAcpQuery.ts` retains Claude's owning SDK Query and hooks. These transport/control concerns remain separate from presentation normalization.

`src/shared/agentContent.ts` normalizes ACP and equivalent native/MCP content blocks. `src/shared/agentTools.ts` supplies the shared tool taxonomy and native-name fallbacks. The renderer uses those shared types for every provider, with no separate provider-specific content UI.

## Presentation

- Human descriptions appear on tool rows. ACP `title` takes precedence; descriptions are a fallback. Claude input descriptions and OpenCode tool titles are retained. Commands and arguments remain in the disclosure as Input.
- Pending, running, completed, failed, and incomplete/stopped tools have distinct statuses. Active tool groups initially open to show their rows. Finished work remains accessible through the existing turn summary.
- Thought chunks stream in their own disclosure. The UI displays only reasoning text the provider supplies; signatures, redacted blocks, and encrypted/private reasoning payloads are not rendered.
- Text, inline raster images, audio, embedded text/binary resources, resource links, file diffs, terminal references, plans, and unrecognized content have dedicated presentations. Unknown content gets an explicit fallback instead of vanishing.
- Images from local paths resolve only through the chat's scoped file APIs. Remote resources are explicit links, not automatically fetched. Inline SVG/HTML is not rendered as media.
- Terminal references show supplied output when available. Ramu does not advertise ACP client-owned terminal support; a reference without output is labeled accordingly. A UI fallback is not a claim that terminal creation/control has been implemented.
- Tool updates replace the same durable row, retaining input and content when fields are omitted. A completed tool cannot be revived by a late progress packet. Text blocks on opposite sides of a tool/thinking/media boundary retain separate positions.
- Rich content and human titles survive reload. Native metadata, helper ownership, usage limits, and existing control extensions remain available through the maintained hosts.

See the [ACP tool call specification](https://agentclientprotocol.com/protocol/v1/tool-calls) and [content specification](https://agentclientprotocol.com/protocol/v1/content).

## Verification

`pnpm check` covers normalization, native host round trips, provider adapters, streaming thinking, durable row replacement, and production builds. `pnpm test:acp-ui` uses a local executable ACP stub over the actual external ACP wire and an isolated Electron profile. It checks thoughts, plans, description updates, command input, live output, image decoding, diffs, resources, terminal references, unknown content, and reload persistence. It makes no model calls and uses no provider credentials.

The fixture checks do not certify every live provider version. Providers may omit reasoning, images, descriptions, or tool content; the UI cannot display information that never arrives. Existing protocol/migration limitations are tracked in `ACP-MIGRATION-AUDIT.md`.
