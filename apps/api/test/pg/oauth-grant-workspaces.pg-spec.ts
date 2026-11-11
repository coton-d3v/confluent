import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Prisma } from '@prisma/client'
import { testDatabase } from './database'
import { CHECKS, MIGRATIONS, sqlStatements } from './sql-file'

const UP = sqlStatements(join(MIGRATIONS, '20261116000000_oauth_grant_workspaces/migration.sql'))
const DOWN = sqlStatements(join(CHECKS, '20261116000000_oauth_grant_workspaces.down.sql'))
// The revert run as the setup of a test: the connections it would widen are revoked (SET LOCAL,
// test transactions only, rolled back). Withdrawn before a revert that must be checked.
const REVOKE_WIDER = "SET LOCAL confluent.revoke_wider_grants = 'on'"
const REFUSE_WIDER = "SET LOCAL confluent.revoke_wider_grants = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

// The column and its constraint, comparable.
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'oauth_grants') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid = 'oauth_grants'::regclass) k)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E05.10 on PostgreSQL: the workspaces an authorization reaches. Authorizations given before
// the migration reach none (backfill), the column holds identifiers only, and the migration
// survives an interrupted deployment and can be undone — never giving a connection the companies
// prepared in a workspace it was not allowed to reach (code review R58).
describe('oauth_grants.workspace_ids (PostgreSQL)', () => {
  const prisma = testDatabase()
  const userId = randomUUID()
  const clientId = `pg-client-${randomUUID().slice(0, 8)}`

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `pg-${userId}@test.dev`, role: 'financeur' },
    })
    await prisma.oAuthClient.create({
      data: { id: clientId, source: 'dcr', name: 'Test', redirectUris: [], metadata: {} },
    })
  })

  afterAll(async () => {
    await prisma.oAuthClient.deleteMany({ where: { id: clientId } })
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.$disconnect()
  })

  const rolledBack = (fn: (tx: Tx) => Promise<void>) =>
    expect(
      prisma.$transaction(
        async (tx) => {
          await fn(tx)
          throw new RolledBack()
        },
        { timeout: 120_000 },
      ),
    ).rejects.toThrow(RolledBack)

  const insertGrant = (tx: Tx, extra = '') =>
    tx.$executeRawUnsafe(
      `INSERT INTO oauth_grants (id, user_id, client_id, scopes, resource, expires_at${extra ? ', workspace_ids' : ''})
       VALUES ('${randomUUID()}', '${userId}', '${clientId}', ARRAY['dossiers:read'], 'http://localhost:3000/mcp', now() + interval '1 day'${extra ? `, ${extra}` : ''})`,
    )

  it('gives every authorization given before the migration no workspace', async () => {
    await rolledBack(async (tx) => {
      await run(tx, [REVOKE_WIDER, ...DOWN])
      await insertGrant(tx)
      await run(tx, UP)
      expect(
        await rows(tx, `SELECT workspace_ids FROM oauth_grants WHERE client_id = '${clientId}'`),
      ).toEqual([{ workspace_ids: [] }])
    })
  })

  it('holds workspace identifiers only, never a missing one', async () => {
    await rolledBack(async (tx) => {
      await insertGrant(tx, `ARRAY['w-1', 'w-2']`)
      await tx.$executeRawUnsafe('SAVEPOINT bad')
      await expect(insertGrant(tx, `ARRAY['w-1', NULL]`)).rejects.toThrow(
        /oauth_grants_workspace_ids_check/,
      )
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT bad')
      // Not null either (code 23502).
      await expect(insertGrant(tx, 'NULL')).rejects.toThrow(/23502/)
    })
  })

  // Under E05.09, `list_dossiers` / `get_dossier` give a connection every company its account
  // prepares as a conseiller (E05.08), whatever workspace it was allowed to reach.
  it('refuses to undo the migration while a connection would reach a prepared company it was not allowed to, or revokes it on request', async () => {
    await rolledBack(async (tx) => {
      const account = async (name: string, role: 'entrepreneur' | 'financeur' = 'entrepreneur') =>
        (
          await tx.user.create({
            data: { email: `${name}-${randomUUID().slice(0, 8)}@pg-test.dev`, role },
          })
        ).id
      const [marie, paul, sophie] = [
        await account('marie', 'financeur'),
        await account('paul', 'financeur'),
        await account('sophie'),
      ]
      const ws = await tx.workspace.create({
        data: { slug: `pg-${randomUUID().slice(0, 12)}`, name: 'CCI test' },
      })
      await tx.workspaceMembership.createMany({
        data: [marie, paul].map((userId) => ({ workspaceId: ws.id, userId, role: 'conseiller' })),
      })
      const form = await tx.questionnaire.create({
        data: { name: 'Profil', slug: `profil-${randomUUID()}` },
      })
      const version = await tx.questionnaireVersion.create({
        data: {
          questionnaireId: form.id,
          version: 1,
          status: 'published',
          publishedAt: new Date(),
        },
      })
      // Marie prepares a company for Sophie in the workspace.
      await tx.company.create({
        data: {
          ownerId: marie,
          name: 'Agrotech',
          profileVersionId: version.id,
          preparedInWorkspaceId: ws.id,
        },
      })
      const grant = async (userId: string, workspaceIds: string[]) => {
        const row = await tx.oAuthGrant.create({
          data: {
            userId,
            clientId,
            scopes: ['dossiers:read'],
            resource: 'http://localhost:3000/mcp',
            expiresAt: new Date(Date.now() + 86_400_000),
            workspaceIds,
          },
        })
        return row.id
      }
      // Widened: Marie's without the workspace (her prepared company), Paul's without it (he may
      // prepare one there). Not widened: Marie's that may reach it, Sophie's (no workspace).
      const widened = [await grant(marie, []), await grant(paul, [])]
      const kept = [await grant(marie, [ws.id]), await grant(sophie, [])]
      await tx.oAuthToken.createMany({
        data: ['access', 'refresh'].map((kind) => ({
          grantId: widened[0],
          kind,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 3_600_000),
        })),
      })
      // Other tests' connections set aside (rolled back with the rest).
      await tx.oAuthGrant.updateMany({
        where: { id: { notIn: [...widened, ...kept] }, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      await tx.$executeRawUnsafe('SAVEPOINT connected')

      await expect(run(tx, [REFUSE_WIDER, ...DOWN])).rejects.toThrow(/would reach/)
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT connected')

      // On request: revoked with their tokens, journaled, before the column goes.
      await run(tx, [REVOKE_WIDER, ...DOWN])
      const revoked = await rows(
        tx,
        `SELECT id, revoked_at IS NOT NULL AS revoked FROM oauth_grants
         WHERE id IN (${[...widened, ...kept].map((id) => `'${id}'`).join(', ')}) ORDER BY id`,
      )
      expect(revoked).toEqual(
        [...widened, ...kept].sort().map((id) => ({ id, revoked: widened.includes(id) })),
      )
      expect(
        await rows(
          tx,
          `SELECT count(*)::int AS n FROM oauth_tokens WHERE grant_id = '${widened[0]}' AND revoked_at IS NULL`,
        ),
      ).toEqual([{ n: 0 }])
      expect(
        await rows(
          tx,
          `SELECT actor_id AS actor, metadata->>'grantId' AS grant, metadata->>'reason' AS reason
           FROM audit_log WHERE action_type = 'oauth_grant_revoked' AND metadata->>'grantId' IN (${[
             ...widened,
             ...kept,
           ]
             .map((id) => `'${id}'`)
             .join(', ')}) ORDER BY metadata->>'grantId'`,
        ),
      ).toEqual(
        [
          { actor: marie, grant: widened[0], reason: 'migration_revert' },
          { actor: paul, grant: widened[1], reason: 'migration_revert' },
        ].sort((a, b) => a.grant.localeCompare(b.grant)),
      )
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT connected')

      // Revoked beforehand (by their owners or the operator): nothing would be widened.
      await tx.oAuthGrant.updateMany({
        where: { id: { in: widened } },
        data: { revokedAt: new Date() },
      })
      await run(tx, [REFUSE_WIDER, ...DOWN])
    })
  })

  it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
    await rolledBack(async (tx) => {
      const expected = await fingerprint(tx)
      for (let n = 0; n < UP.length; n++) {
        await tx.$executeRawUnsafe('SAVEPOINT prefix')
        await run(tx, [REVOKE_WIDER, ...DOWN])
        await insertGrant(tx)
        await run(tx, UP.slice(0, n))
        await run(tx, UP)
        expect(await fingerprint(tx)).toBe(expected)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT prefix')
      }
    })
  })
})
