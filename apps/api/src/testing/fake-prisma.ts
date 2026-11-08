import { randomUUID } from 'node:crypto'

// In-memory stand-in for the Prisma calls used by the OAuth / MCP flows, so HTTP tests run real
// sequences (register → authorize → consent → token → refresh → revoke) without a database.
// Supports: findUnique/findFirst/findMany (+ a few hand-wired `include`s), create, update,
// updateMany, upsert, count; `where` with equality, `null`, `{ gt }`, `{ not }`, `{ in }`.
type Row = Record<string, unknown> & { id: string }
type Where = Record<string, unknown>

function matches(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k]
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      const c = cond as { gt?: Date; not?: unknown; in?: unknown[] }
      if ('gt' in c) return v instanceof Date && v.getTime() > c.gt!.getTime()
      if ('not' in c) return v !== c.not
      if ('in' in c) return c.in!.includes(v)
      return true
    }
    return v === cond
  })
}

const UNIQUE_KEYS: Record<string, string[]> = {
  questionnaire: ['id', 'slug'],
  user: ['id', 'email'],
  oAuthToken: ['id', 'tokenHash'],
  dossier: ['id', 'slug'],
}

// Table backing a to-one relation, for relation ordering.
const RELATIONS: Record<string, Record<string, string>> = {
  questionnaireField: { section: 'questionnaireSection' },
}

// Prisma compound unique input, e.g. { dossierId_fieldId: { dossierId, fieldId } } → plain filter.
function flattenWhere(where: Where = {}): Where {
  const out: Where = {}
  for (const [k, v] of Object.entries(where)) {
    if (k.includes('_') && v && typeof v === 'object' && !(v instanceof Date)) Object.assign(out, v)
    else out[k] = v
  }
  return out
}

export function createFakePrisma() {
  const tables: Record<string, Map<string, Row>> = {}
  const table = (name: string) => (tables[name] ??= new Map())
  const includes: Record<string, (row: Row, include: Record<string, unknown>) => Row> = {}

  const withInclude = (name: string, row: Row | undefined, include?: Record<string, unknown>) =>
    row ? (include && includes[name] ? includes[name]({ ...row }, include) : { ...row }) : null

  const model = (name: string, defaults: () => Record<string, unknown> = () => ({})) => ({
    findUnique: jest.fn(
      ({ where, include }: { where: Where; include?: Record<string, unknown> }) => {
        const keys = UNIQUE_KEYS[name] ?? ['id']
        const key = keys.find((k) => where[k] !== undefined)
        const row = key
          ? [...table(name).values()].find((r) => r[key] === where[key])
          : [...table(name).values()].find((r) => matches(r, flattenWhere(where)))
        return Promise.resolve(withInclude(name, row, include))
      },
    ),
    findFirst: jest.fn(
      ({
        where,
        include,
        orderBy,
      }: {
        where?: Where
        include?: Record<string, unknown>
        orderBy?: unknown
      }) =>
        Promise.resolve(
          withInclude(name, sorted(name, filtered(name, where), orderBy)[0], include),
        ),
    ),
    findMany: jest.fn(
      ({
        where,
        include,
        orderBy,
      }: { where?: Where; include?: Record<string, unknown>; orderBy?: unknown } = {}) =>
        Promise.resolve(
          sorted(name, filtered(name, where), orderBy).map((r) => withInclude(name, r, include)),
        ),
    ),
    count: jest.fn(({ where }: { where?: Where } = {}) =>
      Promise.resolve([...table(name).values()].filter((r) => matches(r, where)).length),
    ),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      const row = { id: randomUUID(), createdAt: new Date(), ...defaults(), ...data } as Row
      table(name).set(row.id, row)
      return Promise.resolve({ ...row })
    }),
    createMany: jest.fn(({ data }: { data: Array<Record<string, unknown>> }) => {
      for (const d of data) {
        const row = { id: randomUUID(), createdAt: new Date(), ...defaults(), ...d } as Row
        table(name).set(row.id, row)
      }
      return Promise.resolve({ count: data.length })
    }),
    deleteMany: jest.fn(({ where }: { where?: Where } = {}) => {
      let count = 0
      for (const [id, row] of table(name)) {
        if (matches(row, where)) {
          table(name).delete(id)
          count++
        }
      }
      return Promise.resolve({ count })
    }),
    update: jest.fn(({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const row = [...table(name).values()].find((r) => matches(r, where))
      if (!row) return Promise.reject(new Error(`${name} not found`))
      return Promise.resolve({ ...Object.assign(row, data) })
    }),
    updateMany: jest.fn(({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      let count = 0
      for (const row of table(name).values()) {
        if (matches(row, where)) {
          Object.assign(row, data)
          count++
        }
      }
      return Promise.resolve({ count })
    }),
    upsert: jest.fn(
      ({
        where,
        create,
        update,
      }: {
        where: Where
        create: Record<string, unknown>
        update: Record<string, unknown>
      }) => {
        const row = [...table(name).values()].find((r) => matches(r, flattenWhere(where)))
        if (row) return Promise.resolve({ ...Object.assign(row, update) })
        const created = { id: randomUUID(), createdAt: new Date(), ...defaults(), ...create } as Row
        table(name).set(created.id, created)
        return Promise.resolve({ ...created })
      },
    ),
  })

  const get = (name: string, id: unknown) => table(name).get(id as string)
  const filtered = (name: string, where?: Where) =>
    [...table(name).values()].filter((r) => matches(r, where))
  // orderBy on columns and on one level of to-one relation, e.g. { section: { orderIndex: 'asc' } }.
  const sorted = (name: string, rows: Row[], orderBy: unknown): Row[] => {
    const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<
      Record<string, unknown>
    >
    const valueOf = (row: Row, field: string, dir: unknown): [unknown, unknown] => {
      if (dir && typeof dir === 'object') {
        const [sub, subDir] = Object.entries(dir as Record<string, unknown>)[0]
        return [get(RELATIONS[name]?.[field] ?? field, row[`${field}Id`])?.[sub], subDir]
      }
      return [row[field], dir]
    }
    return [...rows].sort((a, b) => {
      for (const k of keys) {
        const [field, dir] = Object.entries(k)[0]
        const [av, d] = valueOf(a, field, dir)
        const [bv] = valueOf(b, field, dir)
        if (av !== bv) return ((av as number) < (bv as number) ? -1 : 1) * (d === 'desc' ? -1 : 1)
      }
      return 0
    })
  }

  // Relations used by the OAuth provider / consent controller / MCP tools.
  includes.oAuthAuthorizationRequest = (row) => ({
    ...row,
    client: get('oAuthClient', row.clientId),
  })
  includes.oAuthGrant = (row, include) => ({
    ...row,
    ...(include.client ? { client: get('oAuthClient', row.clientId) } : {}),
  })
  includes.oAuthToken = (row, include) => {
    const grant = get('oAuthGrant', row.grantId)
    const grantInclude = include.grant as { include?: { client?: unknown } } | true
    const withClient =
      grant && typeof grantInclude === 'object' && grantInclude.include?.client
        ? { ...grant, client: get('oAuthClient', grant.clientId) }
        : grant && { ...grant }
    return { ...row, grant: withClient }
  }

  const self: { prisma?: unknown } = {}
  const prisma = {
    onModuleInit: () => Promise.resolve(),
    onModuleDestroy: () => Promise.resolve(),
    $transaction: jest.fn((arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg)
        : (arg as (tx: unknown) => Promise<unknown>)(self.prisma),
    ),
    user: model('user', () => ({ isActive: true, locale: 'fr', firstName: null, lastName: null })),
    auditLog: model('auditLog'),
    oAuthClient: model('oAuthClient', () => ({ fetchedAt: null, clientSecret: null })),
    oAuthAuthorizationRequest: model('oAuthAuthorizationRequest', () => ({ decidedAt: null })),
    oAuthGrant: model('oAuthGrant', () => ({ revokedAt: null, lastUsedAt: null })),
    oAuthToken: model('oAuthToken', () => ({ usedAt: null, revokedAt: null, scopes: [] })),
    dossier: model('dossier', () => ({ submittedAt: null })),
    shareLink: model('shareLink'),
    questionnaire: model('questionnaire'),
    questionnaireVersion: model('questionnaireVersion', () => ({
      status: 'draft',
      publishedAt: null,
    })),
    questionnaireSection: model('questionnaireSection'),
    questionnaireField: model('questionnaireField', () => ({
      helpText: null,
      constraints: {},
      options: [],
      required: false,
      minAccessLevel: 'complet',
    })),
    dossierAnswer: model('dossierAnswer'),
    document: model('document'),
  }
  self.prisma = prisma
  return { prisma, tables, table }
}
