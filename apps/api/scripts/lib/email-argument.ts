// The one email address an operator command takes (`bootstrap:admin`, `api:token`). pnpm hands a
// `--` written before it over to the script: `pnpm bootstrap:admin -- admin@example.org` once made
// `--` an administrator's address (ROADMAP E10.11). It is skipped, and anything else than a single
// address is refused before the database is touched.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function emailArgument(argv: readonly string[]): string | null {
  const args = argv.slice(2).filter((arg) => arg !== '--')
  if (args.length !== 1) return null
  const email = args[0].trim().toLowerCase()
  return EMAIL.test(email) ? email : null
}
