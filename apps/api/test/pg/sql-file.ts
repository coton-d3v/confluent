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
