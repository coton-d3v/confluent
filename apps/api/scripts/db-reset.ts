// `prisma migrate reset` drops every table: development only.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { refuseInProduction } from './lib/environment-guard'

refuseInProduction('Remise à zéro de la base (prisma migrate reset)')
const apiDir = path.resolve(__dirname, '..')
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'prisma',
    'migrate',
    'reset',
    '--schema=./prisma/schema.prisma',
    '--skip-seed',
    ...process.argv.slice(2),
  ],
  { cwd: apiDir, stdio: 'inherit', shell: true },
)
process.exit(result.status ?? 1)
