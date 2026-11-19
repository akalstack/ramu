import { createServer } from 'node:net'

/** Pick the port before printing links, rather than letting Expo silently move the advertised URLs. */
export async function devPort(args, env) {
  const index = args.indexOf('--port')
  const specified = index >= 0 ? args[index + 1] : args.find((arg) => arg.startsWith('--port='))?.slice(7)
  const initial = Number(specified ?? env.RCT_METRO_PORT ?? 8081)
  if (!Number.isInteger(initial) || initial < 1 || initial > 65535)
    throw new Error('Metro needs a port between 1 and 65535.')
  for (let port = initial; port <= Math.min(65535, initial + 20); port++) {
    const available = await new Promise((resolve, reject) => {
      const server = createServer()
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false)
        else reject(error)
      })
      server.listen(port, () => server.close(() => resolve(true)))
    })
    if (available) return port
    if (specified !== undefined)
      throw new Error(`Metro port ${port} is busy. Stop that server or choose another --port.`)
  }
  throw new Error('No free Metro port found. Choose one with --port.')
}

export function withDevPort(args, port) {
  const result = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--port') index++
    else if (!args[index].startsWith('--port=')) result.push(args[index])
  }
  return [...result, '--port', String(port)]
}

/** Native launch links avoid Expo's chooser redirect, which otherwise falls back to the default interface. */
export function devLaunchLinks(addresses, port, scheme) {
  return addresses.map((address) => {
    const authority = `${address.includes(':') ? `[${address}]` : address}:${port}`
    return scheme === 'exp'
      ? `exp://${authority}`
      : `${scheme}://?__expo_url=${encodeURIComponent(`http://${authority}`)}`
  })
}
