import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ENVIRONMENT_KEY_PATTERN, reservedEnvironmentKey } from '@ramu/shared/providers/environment'
import type { AgentService } from '../agent'

const FILE_NOTE =
  'Owner-only file holding the value. Read it inside the command that needs it, for example `TOKEN="$(cat <file>)" cmd` or `cmd --password-file <file>`. Never print, copy or commit it. It is deleted after 24 hours.'
const NOTES = {
  declined: 'The user declined. Do not ask for it in chat or another way; say what is blocked and go on without it.',
  cancelled: 'The card closed with the run. Ask again only if the secret is still needed.',
  timed_out: 'No answer in time. Do not ask in chat; ask again only if it is still needed.',
} as const

const secretRequestSchema = {
  label: z.string().trim().min(1).max(100).describe("Card title, such as 'Vercel token'."),
  reason: z.string().trim().min(1).max(2000).describe('What it is for and where the user gets it.'),
  placeholder: z.string().trim().min(1).max(200).optional(),
  url: z
    .string()
    .trim()
    .max(2000)
    .url()
    .refine((value) => value.startsWith('https://'), 'Use an https:// page')
    .optional()
    .describe(
      'The page where the user creates or copies the value, such as https://vercel.com/account/tokens. The card shows it as a button.',
    ),
  envName: z
    .string()
    .regex(ENVIRONMENT_KEY_PATTERN)
    .refine((name) => !reservedEnvironmentKey(name), 'RAMU_ variables are reserved')
    .optional()
    .describe(
      'The environment variable a CLI reads this from, such as VERCEL_TOKEN. The card offers to keep it for later threads, so the user is not asked again.',
    ),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(60 * 60 * 1000)
    .default(10 * 60 * 1000),
}

/** `request_secret`: one secret per card, delivered as a file so the value stays out of the transcript and model context. */
export function registerSecretTools(server: McpServer, agents: AgentService, sessionId: string) {
  const reply = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  server.registerTool(
    'request_secret',
    {
      description:
        'Ask the user for one secret only they can give (API token, password, PIN, pairing code) on a masked card in the thread, never in chat. One value per call; pass url when a page gives the value. Waits for the answer and returns an owner-only file path; you never see the value. Not for access you already have: check the environment variable first.',
      inputSchema: secretRequestSchema,
    },
    async ({ timeoutMs, ...input }, extra) => {
      try {
        const result = await agents.requestSecret(sessionId, { ...input, timeoutMs }, extra.signal)
        if (result.status !== 'saved') return reply({ status: result.status, note: NOTES[result.status] })
        return reply({
          status: 'saved',
          file: result.file,
          note: result.savedAs
            ? `${FILE_NOTE} The user also kept it as ${result.savedAs}, set in later threads' environments.`
            : FILE_NOTE,
        })
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: (error as Error).message }] }
      }
    },
  )
}
