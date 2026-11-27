import { expect, it } from 'vitest'
import {
  buildDaemon,
  attributeServers,
  ownerFromEnvironment,
  parseListening,
  parseSs,
  processOwners,
  serverUrl,
} from '../src/servers'
import type { ProcessRoot, ProcessRow } from '../src/resources'

const row = (pid: number, ppid: number): ProcessRow => ({ pid, ppid, rssBytes: 0, cpu: 0 })

it('reads listening sockets once per port, preferring IPv4, and skips other interfaces', () => {
  const text = [
    'p100',
    'cnode',
    'f20',
    'n*:5173',
    'f21',
    'n[::1]:5173',
    'p200',
    'cadb',
    'n127.0.0.1:5037',
    'p300',
    'cvite',
    'n[::1]:4000',
    'p400',
    'cpostgres',
    'n192.168.1.4:5432',
  ].join('\n')
  expect(parseListening(text)).toEqual([
    { pid: 100, port: 5173, process: 'node', host: '127.0.0.1' },
    { pid: 200, port: 5037, process: 'adb', host: '127.0.0.1' },
    { pid: 300, port: 4000, process: 'vite', host: '::1' },
  ])
})

it('reads ss output on Linux hosts without lsof', () => {
  expect(parseSs('LISTEN 0 511 *:3000 *:* users:(("node",pid=12,fd=21))')).toEqual([
    { pid: 12, port: 3000, process: 'node', host: '127.0.0.1' },
  ])
})

it('finds the owner a detached process names in its environment', () => {
  expect(ownerFromEnvironment('node server.js PATH=/bin RAMU_OWNER=term-1 HOME=/x')).toBe('term-1')
  expect(ownerFromEnvironment('PATH=/bin\0RAMU_OWNER=session-2\0')).toBe('session-2')
  expect(ownerFromEnvironment('node server.js')).toBeNull()
})

it('gives servers to the item that started them, by tree or by environment, and leaves agents’ own ports out', () => {
  const agent: ProcessRoot = { pid: 10, taskId: 't1', item: { kind: 'agent', id: 's1', name: 'Fix login' } }
  const command: ProcessRoot = { pid: 20, taskId: 't1', item: { kind: 'command', id: 'c1', name: 'npm run dev' } }
  const gone: ProcessRoot = { pid: 30, taskId: 't2', item: { kind: 'terminal', id: 'term-old', name: 'zsh' } }
  const rows = [row(10, 1), row(20, 10), row(21, 20), row(40, 1), row(50, 1)]
  const roots = [agent, command]
  const owners = processOwners(rows, roots)
  const servers = attributeServers(
    [
      { pid: 10, port: 9000, process: 'claude', host: '127.0.0.1' },
      { pid: 21, port: 5173, process: 'node', host: '127.0.0.1' },
      { pid: 40, port: 8080, process: 'python3', host: '127.0.0.1' },
      { pid: 50, port: 3000, process: 'node', host: '127.0.0.1' },
    ],
    owners,
    roots,
    new Map([
      [40, 's1'],
      [50, 'term-old'],
    ]),
    new Map([['term-old', gone]]),
  )
  expect(servers.map(({ port, taskId, owner, orphaned }) => ({ port, taskId, owner: owner.id, orphaned }))).toEqual([
    { port: 3000, taskId: 't2', owner: 'term-old', orphaned: true },
    { port: 5173, taskId: 't1', owner: 'c1', orphaned: false },
    { port: 8080, taskId: 't1', owner: 's1', orphaned: false },
  ])
})

it('writes the address a person would type', () => {
  expect(serverUrl({ port: 5173, host: '127.0.0.1' })).toBe('http://localhost:5173')
  expect(serverUrl({ port: 4000, host: '::1' })).toBe('http://[::1]:4000')
})

it('recognises build daemons by their command line, and nothing else, even with build options in the environment', () => {
  const java =
    '/Library/Java/JavaVirtualMachines/jdk-26.jdk/Contents/Home/bin/java --add-opens=java.base/java.lang=ALL-UNNAMED'
  expect(
    buildDaemon(`${java} -cp gradle-daemon-main.jar org.gradle.launcher.daemon.bootstrap.GradleDaemon 9.4.1`),
  ).toBe('Gradle daemon')
  expect(
    buildDaemon(`${java} -cp kotlin-compiler-embeddable.jar org.jetbrains.kotlin.daemon.KotlinCompileDaemon`),
  ).toBe('Kotlin daemon')
  expect(buildDaemon(`${java} worker.org.gradle.process.internal.worker.GradleWorkerMain 'Gradle Worker'`)).toBe(
    'Gradle worker',
  )
  expect(buildDaemon('/usr/local/bin/sccache')).toBe('sccache')
  // A dev server whose environment carries the agent's Gradle options is still a server.
  expect(buildDaemon('node vite.js GRADLE_OPTS=-Dorg.gradle.daemon.idletimeout=600000 RAMU_OWNER=s1')).toBeNull()
})
