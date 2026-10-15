import { PassThrough, Readable, Writable } from 'node:stream'
import {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  type Agent,
  type Client,
} from '@agentclientprotocol/sdk'

/** Local hosts use the same validated, newline-JSON ACP wire as external agents.
 * Functions/hooks stay on the host side; only protocol payloads cross the wire. */
export function localAcp(client: Client, host: (connection: AgentSideConnection) => Agent) {
  const requests = new PassThrough(),
    responses = new PassThrough()
  // Up to ten 10-MB images, base64 encoded, plus the prompt envelope.
  const stream = (out: PassThrough, input: PassThrough) =>
    ndJsonStream(
      Writable.toWeb(out) as WritableStream<Uint8Array>,
      Readable.toWeb(input) as ReadableStream<Uint8Array>,
      { maxMessageBytes: 160 * 1024 * 1024 },
    )
  const server = new AgentSideConnection(host, stream(responses, requests))
  const connection = new ClientSideConnection(() => client, stream(requests, responses))
  return {
    connection,
    server,
    close() {
      requests.end()
      responses.end()
    },
  }
}
