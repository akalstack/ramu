# ACP integration

All providers use the same chat presentation. ACP updates become durable `AgentEvent` rows through `src/main/acpEvents.ts`. Content normalization and tool names live in `src/shared/agentContent.ts` and `src/shared/agentTools.ts`.

## Behavior

- Tool titles take precedence over generated descriptions. Inputs and arguments appear in the disclosure.
- Active tools use an animated icon. Pending and stopped tools show labels; results retain success or failure status.
- Thinking appears only when the provider supplies it. Private, encrypted, or redacted reasoning is not displayed.
- Text, images, audio, resources, diffs, terminal output, and plans use shared renderers. Unknown content has a fallback.
- Local media uses scoped file access. Remote resources open as links; they are not fetched automatically.
- Updates replace the same row and preserve fields omitted by later packets. Late progress cannot revive a completed tool.
- Saved titles and rich content survive reload.

Transport and process ownership remain in `acp.ts`, `acpNativeHost.ts`, and provider-specific hosts. Ramu does not advertise ACP client-owned terminal creation.

## Checks

`pnpm check` covers adapters, normalization, and persistence. After building, `pnpm test:acp-ui` checks the external ACP wire and renderer using a local stub and isolated profile, without provider credentials or model calls.

These checks do not certify every provider version. See [provider setup](PROVIDERS.md).
