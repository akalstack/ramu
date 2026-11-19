import { expect, it } from 'vitest'
import { namesPrivateHost, serverNameFromUrl } from '../src/mcp'

it('recognizes an address that names a private host, and nothing else', () => {
  for (const url of [
    'http://localhost:3000/mcp',
    'http://127.0.0.1:8080',
    'http://10.0.0.5/mcp',
    'http://172.20.1.1',
    'http://192.168.1.10/mcp',
    'http://nas.local/mcp',
    'http://tools.internal',
    'http://[::1]:9000',
  ])
    expect(namesPrivateHost(url)).toBe(true)
  for (const url of ['https://mcp.deepwiki.com/mcp', 'http://172.32.0.1', 'https://8.8.8.8', 'not a url'])
    expect(namesPrivateHost(url)).toBe(false)
})

it('names a server after its address', () => {
  expect(serverNameFromUrl('https://mcp.deepwiki.com/mcp')).toBe('deepwiki')
  expect(serverNameFromUrl('https://api.github.com/mcp')).toBe('github')
  expect(serverNameFromUrl('http://localhost:3000')).toBe('localhost')
  expect(serverNameFromUrl('nope')).toBe('')
})
