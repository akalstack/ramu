import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PHONE_FORWARD_OPEN_PATH,
  PhoneForwards,
  phoneForwardPeer,
  phoneForwardTarget,
} from '../src/remote/phoneForward'

type Answer = { status: number; headers: IncomingMessage['headers']; body: string }

const get = (port: number, path: string, headers: Record<string, string> = {}) =>
  new Promise<Answer>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })

describe('phoneForwardTarget', () => {
  it('forwards only an http page on the host’s localhost, never Ramu’s own port', () => {
    expect(phoneForwardTarget('http://localhost:5173/app?x=1')).toEqual({ port: 5173, path: '/app?x=1' })
    expect(phoneForwardTarget('http://127.0.0.1:3000')).toEqual({ port: 3000, path: '/' })
    expect(phoneForwardTarget('http://[::1]:8080/')).toEqual({ port: 8080, path: '/' })
    expect(() => phoneForwardTarget('https://localhost:5173')).toThrow(/Only an http page/)
    expect(() => phoneForwardTarget('http://example.com:5173')).toThrow(/Only an http page/)
    expect(() => phoneForwardTarget('http://me:pw@localhost:5173')).toThrow(/Only an http page/)
    expect(() => phoneForwardTarget('http://localhost:7788', [7788])).toThrow(/Ramu’s own port/)
    expect(() => phoneForwardTarget('not a url')).toThrow(/no address/)
  })
})

describe('phoneForwardPeer', () => {
  it('opens on the address the phone reached, and refuses a phone that came through a tunnel', () => {
    expect(phoneForwardPeer('::ffff:192.168.1.20', '::ffff:192.168.1.5', false)).toEqual({
      phone: '192.168.1.20',
      bind: '192.168.1.5',
    })
    expect(phoneForwardPeer('fd7a::2', 'fd7a::1', false)).toEqual({ phone: 'fd7a::2', bind: 'fd7a::1' })
    expect(() => phoneForwardPeer('192.168.1.20', '192.168.1.5', true)).toThrow(/tunnel/)
    expect(() => phoneForwardPeer('127.0.0.1', '127.0.0.1', false)).toThrow(/tunnel/)
    expect(() => phoneForwardPeer(undefined, '192.168.1.5', false)).toThrow(/tunnel/)
  })
})

describe('PhoneForwards', () => {
  let dev: Server
  let devPort: number
  let seen: IncomingMessage[]
  let forwards: PhoneForwards

  beforeEach(async () => {
    seen = []
    dev = createServer((req, res) => {
      seen.push(req)
      if (req.url === '/moved') return res.writeHead(302, { Location: `http://localhost:${devPort}/there?a=1` }).end()
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`dev ${req.url}`)
    })
    dev.on('upgrade', (_req, socket) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
      socket.on('data', (data) => socket.write(data))
      socket.on('end', () => socket.end())
    })
    await new Promise<void>((resolve) => dev.listen(0, '127.0.0.1', resolve))
    devPort = (dev.address() as AddressInfo).port
    forwards = new PhoneForwards()
  })

  afterEach(async () => {
    forwards.closeAll()
    dev.closeAllConnections()
    await new Promise((resolve) => dev.close(resolve))
  })

  const open = (phone = '127.0.0.1', path = '/app') =>
    forwards.open({ deviceId: 'phone', phone, bind: '127.0.0.1', target: { port: devPort, path } })

  const redeem = async (forward: Awaited<ReturnType<typeof open>>) => {
    const answer = await get(forward.port, forward.openPath)
    expect(answer.status).toBe(303)
    expect(answer.headers.location).toBe('/app')
    return String(answer.headers['set-cookie']?.[0]).split(';')[0]!
  }

  it('answers only once the one-time token set its cookie, and never redeems the token twice', async () => {
    const forward = await open()
    expect(forward.targetPort).toBe(devPort)
    expect(forward.openPath.startsWith(`${PHONE_FORWARD_OPEN_PATH}?t=`)).toBe(true)
    expect((await get(forward.port, '/app')).status).toBe(403)
    expect((await get(forward.port, `${PHONE_FORWARD_OPEN_PATH}?t=wrong`)).status).toBe(403)
    const cookie = await redeem(forward)
    expect((await get(forward.port, forward.openPath)).status).toBe(403)
    expect((await get(forward.port, '/app', { Cookie: `${cookie}x` })).status).toBe(403)
    expect(seen).toHaveLength(0)

    const page = await get(forward.port, '/app', { Cookie: `theme=dark; ${cookie}` })
    expect(page).toMatchObject({ status: 200, body: 'dev /app' })
    expect(seen[0]!.headers.host).toBe(`localhost:${devPort}`)
    expect(seen[0]!.headers.cookie).toBe('theme=dark')
  })

  it('keeps a redirect to the dev server’s own address on the forward', async () => {
    const forward = await open()
    const cookie = await redeem(forward)
    expect((await get(forward.port, '/moved', { Cookie: cookie })).headers.location).toBe('/there?a=1')
  })

  it('carries hot-reload sockets, with the cookie only', async () => {
    const forward = await open()
    const cookie = await redeem(forward)
    const upgrade = (headers: string) =>
      new Promise<string>((resolve) => {
        const socket = connect(forward.port, '127.0.0.1', () =>
          socket.write(`GET /hmr HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${headers}\r\n`),
        )
        let data = ''
        socket.on('data', (chunk) => {
          data += chunk.toString()
          if (data.includes('\r\n\r\n') && !data.includes('ping')) socket.write('ping')
          if (data.includes('ping')) {
            socket.destroy()
            resolve(data)
          }
        })
        socket.on('close', () => resolve(data))
      })
    expect(await upgrade('')).toBe('')
    expect(await upgrade(`Cookie: ${cookie}\r\n`)).toMatch(/101 Switching Protocols[\s\S]*ping$/)
  })

  it('drops connections from any other address', async () => {
    const forward = await open('10.0.0.9')
    await expect(get(forward.port, forward.openPath)).rejects.toThrow()
  })

  it('closes when its viewer closes it, only for the device that opened it', async () => {
    const forward = await open()
    forwards.close('another', forward.id)
    expect((await get(forward.port, forward.openPath)).status).toBe(303)
    forwards.close('phone', forward.id)
    expect(forwards.size).toBe(0)
    await expect(get(forward.port, '/app')).rejects.toThrow()
  })

  it('closes on its own after its time, and when the device is no longer paired', async () => {
    const short = new PhoneForwards({ ttl: 20 })
    const forward = await short.open({
      deviceId: 'phone',
      phone: '127.0.0.1',
      bind: '127.0.0.1',
      target: { port: devPort, path: '/' },
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(short.size).toBe(0)
    await expect(get(forward.port, '/')).rejects.toThrow()

    await open()
    forwards.keepOnly((id) => id !== 'phone')
    expect(forwards.size).toBe(0)
  })

  it('keeps at most three per device, closing the oldest', async () => {
    const first = await open()
    await open()
    await open()
    await open()
    expect(forwards.size).toBe(3)
    await expect(get(first.port, first.openPath)).rejects.toThrow()
  })
})
