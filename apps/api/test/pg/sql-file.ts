import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MIGRATIONS = join(__dirname, '../../prisma/migrations')
export const CHECKS = join(__dirname, '../../prisma/checks')

// The statements of a migration or check file, one per `;` outside comments, quotes and `$$` bodies
// (a `DO $$ … $$` block is one statement), so that they can be run one at a time like psql does.
export function sqlStatements(path: string): string[] {
  const sql = readFileSync(path, 'utf8')
  const statements: string[] = []
  let current = ''
  let quote: "'" | '"' | '$$' | null = null
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (quote === null && ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      current += '\n'
      continue
    }
    if (ch === '$' && sql[i + 1] === '$' && (quote === null || quote === '$$')) {
      quote = quote ? null : '$$'
      current += '$$'
      i++
      continue
    }
    if ((ch === "'" || ch === '"') && (quote === null || quote === ch)) quote = quote ? null : ch
    if (ch === ';' && quote === null) {
      if (current.trim()) statements.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) statements.push(current.trim())
  return statements
}

// The revert of E05.08 (company transfers), as the tests of earlier migrations run it before their
// own: it accepts that prepared companies stay with their conseiller (SET LOCAL, test transactions
// only).
export function companyTransfersDown(): string[] {
  return [
    "SET LOCAL confluent.accept_held_companies = 'on'",
    ...sqlStatements(join(CHECKS, '20261114000000_company_transfers.down.sql')),
  ]
}

// The reverts of E05.08 then E05.07 (financing requests), as the tests of earlier migrations run them
// before their own: they accept that shares then show the whole library again (SET LOCAL, test
// transactions only).
export function financingRequestsDown(): string[] {
  return [
    ...companyTransfersDown(),
    "SET LOCAL confluent.accept_wider_shares = 'on'",
    ...sqlStatements(join(CHECKS, '20261113000000_financing_requests.down.sql')),
  ]
}

// The revert of E06.01 (statuses), as the tests of earlier migrations that touch candidatures run it
// before their own: it accepts that archived requests and financing statuses are lost (SET LOCAL,
// test transactions only).
export function statusesDown(): string[] {
  return [
    "SET LOCAL confluent.accept_statuses_loss = 'on'",
    ...sqlStatements(join(CHECKS, '20261117000000_statuses.down.sql')),
  ]
}

export function statusesUp(): string[] {
  return sqlStatements(join(MIGRATIONS, '20261117000000_statuses/migration.sql'))
}
