import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// ROADMAP E10.11: the operator commands that take an email address, as the documentation tells to
// call them. `pnpm bootstrap:admin -- admin@example.org` handed `--` to the script, which made `--`
// an administrator. No database here: an accepted argument fails on the unreachable database, a
// refused one never reaches it.
describe('Operator commands taking an email address', () => {
  const apiDir = resolve(__dirname, '..')
  const tsx = join(apiDir, 'node_modules', '.bin', 'tsx')
  let cwd: string
  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), 'qx-operator-'))
  })
  afterAll(() => rmSync(cwd, { recursive: true, force: true }))

  const run = (script: string, args: string[]) => {
    const { NODE_ENV: _ignored, ...inherited } = process.env
    return spawnSync(tsx, [join(apiDir, 'scripts', script), ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...inherited,
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://qx:qx@127.0.0.1:1/qx',
        JWT_SECRET: 'q'.repeat(32),
      },
    })
  }

  describe.each([
    ['bootstrap:admin', 'bootstrap-admin.ts'],
    ['api:token', 'issue-token.ts'],
  ])('%s', (_name, script) => {
    it.each([
      ['a lone `--`', ['--']],
      ['no address', []],
      ['something else than an address', ['admin']],
      ['two addresses', ['a@example.org', 'b@example.org']],
    ])('refuses %s before touching the database', (_label, args) => {
      const result = run(script, args)
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/Usage:/)
      expect(result.stderr).not.toMatch(/database|prisma/i)
    })

    it('takes the address written after `--`, as `pnpm <command> -- <email>` passes it', () => {
      const result = run(script, ['--', 'Admin@Example.org'])
      expect(result.status).toBe(1)
      expect(result.stderr).not.toMatch(/Usage:/)
      expect(result.stderr).toMatch(/database server|127\.0\.0\.1:1/i)
    })
  })
})
