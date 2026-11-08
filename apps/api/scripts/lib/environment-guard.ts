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
