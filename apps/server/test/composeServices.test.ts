import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { composeServices } from '../src/workspace/deploy/composeServices'

it('keeps the image services beside the app, without their ports, and the volumes they use', () => {
  const compose = [
    'services:',
    '  app:',
    '    build: .',
    '    ports: ["3000:3000"]',
    '  db:',
    '    image: postgres:17',
    '    ports: ["5432:5432"]',
    '    container_name: shop-db',
    '    volumes: ["pgdata:/var/lib/postgresql/data"]',
    '    environment: { POSTGRES_PASSWORD: example }',
    '  cache:',
    '    image: redis:7',
    'volumes:',
    '  pgdata: {}',
    '  unused: {}',
  ].join('\n')
  const kept = composeServices(compose)!
  expect(kept.names).toEqual(['db', 'cache'])
  expect(parse(kept.yaml)).toEqual({
    services: {
      db: {
        image: 'postgres:17',
        volumes: ['pgdata:/var/lib/postgresql/data'],
        environment: { POSTGRES_PASSWORD: 'example' },
        restart: 'unless-stopped',
      },
      cache: { image: 'redis:7', restart: 'unless-stopped' },
    },
    volumes: { pgdata: {} },
  })
  expect(composeServices('services:\n  app:\n    build: .\n')).toBeNull()
  expect(composeServices(': not yaml [')).toBeNull()
})
