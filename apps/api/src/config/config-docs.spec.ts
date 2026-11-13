import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { configSchema } from './config.schema'

// ROADMAP E10.11: the operator's documentation cannot drift from the configuration. Every variable the
// API validates is described in docs/operations/configuration.md and present (set or commented) in
// apps/api/.env.example; every `VITE_*` the site reads is described too.
const root = resolve(__dirname, '../../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const documented = (doc: string, key: string) => doc.includes(`\`${key}\``)

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

describe('configuration documentation', () => {
  const doc = read('docs/operations/configuration.md')
  const apiKeys = Object.keys(configSchema.shape)

  it('reads the keys of the schema', () => {
    expect(apiKeys).toEqual(expect.arrayContaining(['DATABASE_URL', 'JWT_SECRET', 'NODE_ENV']))
  })

  it.each(apiKeys)('describes %s in docs/operations/configuration.md', (key) => {
    expect(documented(doc, key)).toBe(true)
  })

  it.each(apiKeys)('lists %s in apps/api/.env.example', (key) => {
    expect(read('apps/api/.env.example')).toMatch(new RegExp(`^(# )?${key}=`, 'm'))
  })

  it('describes every VITE_* variable the site reads', () => {
    const web = join(root, 'apps/web')
    const sources = [
      ...filesUnder(join(web, 'src')).filter((f) => /\.(ts|tsx)$/.test(f)),
      join(web, 'vite.config.ts'),
    ]
    const keys = new Set(
      sources.flatMap((f) => readFileSync(f, 'utf8').match(/\bVITE_[A-Z0-9_]+/g) ?? []),
    )
    expect(keys.size).toBeGreaterThan(0)
    expect([...keys].filter((key) => !documented(doc, key))).toEqual([])
  })
})
