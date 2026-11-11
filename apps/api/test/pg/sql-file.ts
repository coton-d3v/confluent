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

// The revert of E06.03 (financing plans), as the tests of earlier migrations that drop the tables
// its lines reference (candidatures, funding source categories) run it before their own: it
// accepts that plans are lost (SET LOCAL, test transactions only).
export function fundingPlansDown(): string[] {
  return [
    "SET LOCAL confluent.accept_funding_plans_loss = 'on'",
    ...sqlStatements(join(CHECKS, '20261119000000_funding_plans.down.sql')),
  ]
}

export function fundingPlansUp(): string[] {
  return sqlStatements(join(MIGRATIONS, '20261119000000_funding_plans/migration.sql'))
}

// The revert of E06.05 (schemes and eligibilities), as the tests of earlier migrations that drop
// what its tables reference (E06.03's unique index on candidatures, candidatures, workspaces) run it
// before their own: it accepts that schemes and eligibilities are lost (SET LOCAL, test transactions
// only).
export function eligibilitiesDown(): string[] {
  return [
    "SET LOCAL confluent.accept_eligibilities_loss = 'on'",
    ...sqlStatements(join(CHECKS, '20261120000000_eligibilities.down.sql')),
  ]
}

export function eligibilitiesUp(): string[] {
  return sqlStatements(join(MIGRATIONS, '20261120000000_eligibilities/migration.sql'))
}

// The revert of E06.06 (support paths), as the tests of earlier migrations that drop what its tables
// reference (E06.03's unique index on candidatures, candidatures, workspaces) run it before their
// own: it accepts that paths and validations are lost (SET LOCAL, test transactions only).
export function supportPathsDown(): string[] {
  return [
    "SET LOCAL confluent.accept_support_paths_loss = 'on'",
    ...sqlStatements(join(CHECKS, '20261121000000_support_paths.down.sql')),
  ]
}

export function supportPathsUp(): string[] {
  return sqlStatements(join(MIGRATIONS, '20261121000000_support_paths/migration.sql'))
}

// The revert of E06.08 (internal notes), as the tests of earlier migrations that drop what its table
// references (E06.03's unique index on candidatures, candidatures) run it before their own: it
// accepts that notes are lost (SET LOCAL, test transactions only).
export function candidatureNotesDown(): string[] {
  return [
    "SET LOCAL confluent.accept_candidature_notes_loss = 'on'",
    ...sqlStatements(join(CHECKS, '20261122000000_candidature_notes.down.sql')),
  ]
}

export function candidatureNotesUp(): string[] {
  return sqlStatements(join(MIGRATIONS, '20261122000000_candidature_notes/migration.sql'))
}

// The revert of E07.01 (share links): it accepts that the journal of level changes is lost
// (SET LOCAL, test transactions only).
export function shareLinksDown(): string[] {
  return [
    "SET LOCAL confluent.accept_share_level_journal_loss = 'on'",
    ...sqlStatements(join(CHECKS, '20261123000000_share_links.down.sql')),
  ]
}

export function shareLinksUp(): string[] {
  return sqlStatements(join(MIGRATIONS, '20261123000000_share_links/migration.sql'))
}
