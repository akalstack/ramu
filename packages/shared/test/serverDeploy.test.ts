import { describe, expect, it } from 'vitest'
import { exposedPort, serverDockerfile } from '../src/serverDeploy'

const pkg = (value: unknown) => JSON.stringify(value)

describe('serverDockerfile', () => {
  it('runs a Node server with its start script on port 3000, building first with the lockfile’s manager', () => {
    const dockerfile = serverDockerfile({
      files: ['package.json', 'pnpm-lock.yaml'],
      manifests: { 'package.json': pkg({ scripts: { build: 'next build', start: 'next start' } }) },
    })!
    expect(dockerfile.port).toBe(3000)
    expect(dockerfile.content).toContain('RUN corepack enable && pnpm install --frozen-lockfile')
    expect(dockerfile.content).toContain('RUN pnpm run build')
    expect(dockerfile.content).toContain('CMD ["pnpm","run","start"]')
    // Development dependencies are installed for the build; production is set only for running.
    expect(dockerfile.content.indexOf('NODE_ENV=production')).toBeGreaterThan(dockerfile.content.indexOf('run build'))
  })

  it('serves a static build with Caddy, falling back to index.html only for a Vite app', () => {
    const vite = serverDockerfile({
      files: ['package.json', 'package-lock.json'],
      manifests: { 'package.json': pkg({ scripts: { build: 'vite build' }, devDependencies: { vite: '^7' } }) },
    })!
    expect(vite.port).toBe(8080)
    expect(vite.content).toContain('RUN npm ci')
    expect(vite.content).toContain('COPY --from=build /app/dist /srv')
    expect(vite.content).toContain('/index.html')
    const astro = serverDockerfile({
      files: ['package.json'],
      manifests: {
        'package.json': pkg({ scripts: { build: 'astro build' }, dependencies: { astro: '^5', vite: '^7' } }),
      },
    })!
    expect(astro.content).not.toContain('/index.html')
  })

  it('serves Django through gunicorn with the project manage.py names', () => {
    const dockerfile = serverDockerfile({
      files: ['manage.py', 'requirements.txt', 'shop'],
      manifests: {
        'requirements.txt': 'django\n',
        'manage.py': "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'shop.settings')",
      },
    })!
    expect(dockerfile.port).toBe(8000)
    expect(dockerfile.content).toContain('CMD ["gunicorn","shop.wsgi","--bind","0.0.0.0:8000"]')
  })

  it('serves FastAPI with uvicorn, and builds a Go module into a small image', () => {
    expect(
      serverDockerfile({
        files: ['pyproject.toml', 'main.py'],
        manifests: { 'pyproject.toml': 'dependencies = ["fastapi"]' },
      })?.content,
    ).toContain('"uvicorn","main:app"')
    expect(serverDockerfile({ files: ['go.mod'], manifests: {} })?.content).toContain('distroless')
  })

  it('returns null when it cannot tell how the app starts', () => {
    expect(
      serverDockerfile({ files: ['package.json'], manifests: { 'package.json': pkg({ scripts: {} }) } }),
    ).toBeNull()
    expect(serverDockerfile({ files: ['Gemfile'], manifests: { Gemfile: "gem 'rails'" } })).toBeNull()
    expect(serverDockerfile({ files: ['requirements.txt'], manifests: { 'requirements.txt': 'requests' } })).toBeNull()
  })

  it('reads the port an existing Dockerfile exposes', () => {
    expect(exposedPort('FROM node\nEXPOSE 4321\nCMD ["node"]')).toBe(4321)
    expect(exposedPort('FROM node\n')).toBeNull()
  })
})
