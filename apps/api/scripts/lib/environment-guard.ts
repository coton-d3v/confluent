// Destructive or demo-only operations must never run against production by accident (ROADMAP
// E02.12). Production containers run with NODE_ENV=production; an operator who really means it can
// set CONFLUENT_ALLOW_DESTRUCTIVE=yes for a single command.
export function refuseInProduction(action: string): void {
  if (process.env.NODE_ENV !== 'production') return
  if (process.env.CONFLUENT_ALLOW_DESTRUCTIVE === 'yes') {
    console.warn(`⚠ ${action} : exécution forcée en production (CONFLUENT_ALLOW_DESTRUCTIVE=yes).`)
    return
  }
  console.error(
    `✗ ${action} : refusé en production (NODE_ENV=production). ` +
      'Utilisez les migrations versionnées (`db:migrate:deploy`) ; pour forcer une opération ' +
      'ponctuelle, relancez avec CONFLUENT_ALLOW_DESTRUCTIVE=yes.',
  )
  process.exit(1)
}

// Exit status of a command refused outside development (see refuseOutsideDevelopment).
export const REFUSED_OUTSIDE_DEVELOPMENT = 4

// Acting as another account (ROADMAP E10.06) is for development and tests only: closed unless
// NODE_ENV says so explicitly — unset, production or any other value refuses — and no override,
// since the production image ships these scripts.
export function refuseOutsideDevelopment(action: string): void {
  const env = process.env.NODE_ENV
  if (env === 'development' || env === 'test') return
  console.error(
    `✗ ${action} : réservé au développement et aux tests (NODE_ENV=${env ?? 'non défini'}).`,
  )
  process.exit(REFUSED_OUTSIDE_DEVELOPMENT)
}
