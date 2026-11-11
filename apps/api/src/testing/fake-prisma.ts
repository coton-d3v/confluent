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
  questionnaire: ['id', 'slug', 'usage'],
  user: ['id', 'email'],
  oAuthToken: ['id', 'tokenHash'],
  dossier: ['id', 'slug'],
  workspace: ['id', 'slug'],
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

// Tables whose `updatedAt` matters to a test (an answer's date is its provenance's, E04.04), set on
// every write like Prisma's `@updatedAt`.
const UPDATED_AT = new Set([
  'dossierAnswer',
  'workspace',
  'workspaceMembership',
  'company',
  'libraryDocument',
  'dossierDocument',
  'candidature',
  'candidatureAnswer',
  'fundingSourceCategory',
])
const stamp = (name: string) => (UPDATED_AT.has(name) ? { updatedAt: new Date() } : {})

// Like Prisma, an `undefined` value in `data` leaves the column unchanged.
const defined = (data: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))

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
          sorted(name, filtered(name, where), orderBy)
            .filter((r) => relationsMatch(name, r, where))
            .map((r) => withInclude(name, r, include)),
        ),
    ),
    count: jest.fn(({ where }: { where?: Where } = {}) =>
      Promise.resolve([...table(name).values()].filter((r) => matches(r, where)).length),
    ),
    create: jest.fn(
      ({ data, include }: { data: Record<string, unknown>; include?: Record<string, unknown> }) => {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          ...stamp(name),
          ...defaults(),
          ...data,
        } as Row
        table(name).set(row.id, row)
        return Promise.resolve(withInclude(name, row, include)!)
      },
    ),
    // `skipDuplicates`: rows colliding on a unique column are skipped, as ON CONFLICT DO NOTHING.
    createMany: jest.fn(
      ({
        data,
        skipDuplicates,
      }: {
        data: Array<Record<string, unknown>>
        skipDuplicates?: boolean
      }) => {
        let count = 0
        for (const d of data) {
          const row = {
            id: randomUUID(),
            createdAt: new Date(),
            ...stamp(name),
            ...defaults(),
            ...d,
          } as Row
          const clash = (UNIQUE_KEYS[name] ?? ['id']).some(
            (k) => row[k] !== undefined && [...table(name).values()].some((r) => r[k] === row[k]),
          )
          if (skipDuplicates && clash) continue
          table(name).set(row.id, row)
          count++
        }
        return Promise.resolve({ count })
      },
    ),
    delete: jest.fn(({ where }: { where: Where }) => {
      const row = [...table(name).values()].find((r) => matches(r, where))
      if (!row) return Promise.reject(new Error(`${name} not found`))
      table(name).delete(row.id)
      return Promise.resolve({ ...row })
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
    update: jest.fn(
      ({
        where,
        data,
        include,
      }: {
        where: Where
        data: Record<string, unknown>
        include?: Record<string, unknown>
      }) => {
        const row = [...table(name).values()].find((r) => matches(r, where))
        if (!row) return Promise.reject(new Error(`${name} not found`))
        Object.assign(row, defined(data), stamp(name))
        return Promise.resolve(withInclude(name, row, include)!)
      },
    ),
    updateMany: jest.fn(({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      let count = 0
      for (const row of table(name).values()) {
        if (matches(row, where)) {
          Object.assign(row, defined(data))
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
        if (row) return Promise.resolve({ ...Object.assign(row, defined(update), stamp(name)) })
        const created = {
          id: randomUUID(),
          createdAt: new Date(),
          ...stamp(name),
          ...defaults(),
          ...create,
        } as Row
        table(name).set(created.id, created)
        return Promise.resolve({ ...created })
      },
    ),
  })

  const get = (name: string, id: unknown) => table(name).get(id as string)
  // `{ shareLinks: { some: … } }` on dossiers: the dossiers shared with a recipient.
  const relationsMatch = (name: string, row: Row, where?: Where) => {
    const some = (where?.shareLinks as { some?: Where } | undefined)?.some
    if (name !== 'dossier' || !some) return true
    return filtered('shareLink', { ...some, dossierId: row.id }).length > 0
  }
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

  // Dossier with its company and owner (E05.04).
  includes.dossier = (row, include) => ({
    ...row,
    ...(include.company ? { company: get('company', row.companyId) } : {}),
    ...(include.user ? { user: get('user', row.userId) } : {}),
    ...(include.shareLinks
      ? {
          shareLinks: filtered('shareLink', {
            ...((include.shareLinks as { where?: Where }).where ?? {}),
            dossierId: row.id,
          }),
        }
      : {}),
  })

  // Company with its dossiers, newest first (E05.04); with its profile's version fields and its
  // answers, as read by the classification (E05.05).
  includes.company = (row, include) => ({
    ...row,
    ...(include.owner ? { owner: get('user', row.ownerId) } : {}),
    ...(include.preparedInWorkspace
      ? {
          preparedInWorkspace: row.preparedInWorkspaceId
            ? (get('workspace', row.preparedInWorkspaceId) ?? null)
            : null,
        }
      : {}),
    ...(include.transfers
      ? {
          transfers: sorted('companyTransfer', filtered('companyTransfer', { companyId: row.id }), {
            createdAt: 'desc',
          }).slice(0, (include.transfers as { take?: number }).take ?? undefined),
        }
      : {}),
    ...(include.answers ? { answers: filtered('dossierAnswer', { companyId: row.id }) } : {}),
    ...(include.profileVersion
      ? {
          profileVersion: {
            ...get('questionnaireVersion', row.profileVersionId),
            fields: filtered('questionnaireField', { versionId: row.profileVersionId }),
          },
        }
      : {}),
    ...(include.dossiers
      ? {
          dossiers: sorted('dossier', filtered('dossier', { companyId: row.id }), {
            createdAt: 'desc',
          }),
        }
      : {}),
  })

  // Library document with the read level of the field it answers (E03.11) and its versions
  // (E05.06), in the order asked for.
  includes.libraryDocument = (row, include) => ({
    ...row,
    ...(include.field
      ? { field: row.fieldId ? get('questionnaireField', row.fieldId) : null }
      : {}),
    ...(include.versions
      ? {
          versions: sorted(
            'document',
            filtered('document', { libraryDocumentId: row.id }),
            (include.versions as { orderBy?: unknown }).orderBy,
          ).map((v) => ({ ...v })),
        }
      : {}),
  })

  // Document version with its library document and that document's field.
  includes.document = (row, include) => {
    if (!include.libraryDocument) return row
    const document = get('libraryDocument', row.libraryDocumentId)
    return {
      ...row,
      libraryDocument: document && {
        ...document,
        field: document.fieldId ? (get('questionnaireField', document.fieldId) ?? null) : null,
      },
    }
  }

  // Membership with its people and workspace (E05.02).
  includes.workspaceMembership = (row, include) => ({
    ...row,
    ...(include.user ? { user: get('user', row.userId) } : {}),
    ...(include.shareLinks
      ? {
          shareLinks: filtered('shareLink', {
            ...((include.shareLinks as { where?: Where }).where ?? {}),
            dossierId: row.id,
          }),
        }
      : {}),
    ...(include.invitedBy
      ? { invitedBy: row.invitedById ? (get('user', row.invitedById) ?? null) : null }
      : {}),
    ...(include.workspace ? { workspace: get('workspace', row.workspaceId) } : {}),
  })

  // E05.08: a company's new owner reaches its dossiers through their (company_id, user_id) foreign
  // key, ON UPDATE CASCADE.
  function withOwnerCascade<M extends ReturnType<typeof model>>(m: M): M {
    const update = m.update
    m.update = jest.fn(async (args: Parameters<typeof update>[0]) => {
      const row = await update(args)
      if (args.data.ownerId !== undefined) {
        for (const d of table('dossier').values()) {
          if (d.companyId === row.id) d.userId = row.ownerId
        }
      }
      return row
    }) as unknown as M['update']
    return m
  }

  // Transfer with its company (and that company's own includes), workspace and people (E05.08).
  includes.companyTransfer = (row, include) => {
    const companyInclude = include.company as { include?: Record<string, unknown> } | true
    const company = get('company', row.companyId)
    return {
      ...row,
      ...(include.company
        ? {
            company:
              company && typeof companyInclude === 'object' && companyInclude.include
                ? includes.company({ ...company }, companyInclude.include)
                : company && { ...company },
          }
        : {}),
      ...(include.workspace ? { workspace: get('workspace', row.workspaceId) } : {}),
      ...(include.fromUser
        ? { fromUser: row.fromUserId ? (get('user', row.fromUserId) ?? null) : null }
        : {}),
      ...(include.toUser ? { toUser: get('user', row.toUserId) } : {}),
    }
  }

  const self: { prisma?: unknown } = {}
  const prisma = {
    onModuleInit: () => Promise.resolve(),
    // Row locks (`SELECT … FOR UPDATE`) have no effect in memory: concurrency is tested on PostgreSQL.
    $queryRaw: jest.fn(() => Promise.resolve([])),
    // Table locks (`LOCK TABLE …`) likewise.
    $executeRaw: jest.fn(() => Promise.resolve(0)),
    onModuleDestroy: () => Promise.resolve(),
    $transaction: jest.fn((arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg)
        : (arg as (tx: unknown) => Promise<unknown>)(self.prisma),
    ),
    user: model('user', () => ({ isActive: true, locale: 'fr', firstName: null, lastName: null })),
    auditLog: model('auditLog'),
    refreshSession: model('refreshSession', () => ({ revokedAt: null })),
    oAuthClient: model('oAuthClient', () => ({ fetchedAt: null, clientSecret: null })),
    oAuthAuthorizationRequest: model('oAuthAuthorizationRequest', () => ({ decidedAt: null })),
    oAuthGrant: model('oAuthGrant', () => ({
      revokedAt: null,
      lastUsedAt: null,
      workspaceIds: [],
    })),
    oAuthToken: model('oAuthToken', () => ({ usedAt: null, revokedAt: null, scopes: [] })),
    company: withOwnerCascade(model('company', () => ({ preparedInWorkspaceId: null }))),
    companyTransfer: model('companyTransfer', () => ({
      status: 'pending',
      decidedAt: null,
      fromUserId: null,
    })),
    dossier: model('dossier', () => ({
      submittedAt: null,
      sector: null,
      maturityStage: null,
      ancrageCvl: null,
      tagTechnologique: null,
      axe1Projet: null,
      axe2Financier: null,
      axe3Origine: null,
      deeptechScore: null,
      preCreation: null,
      classificationSources: null,
      summary: null,
      objective: null,
      description: null,
      amountEur: null,
      financingTypes: [],
      publicationStatus: 'draft',
      publishedAt: null,
      archivedAt: null,
      updatedAt: new Date(),
    })),
    shareLink: model('shareLink'),
    questionnaire: model('questionnaire', () => ({
      archivedAt: null,
      workspaceId: null,
      updatedAt: new Date(),
    })),
    questionnaireVersion: model('questionnaireVersion', () => ({
      status: 'draft',
      publishedAt: null,
      updatedAt: new Date(),
    })),
    questionnaireSection: model('questionnaireSection'),
    questionnaireField: model('questionnaireField', () => ({
      helpText: null,
      constraints: {},
      choices: [],
      required: false,
      minAccessLevel: 'complet',
    })),
    dossierAnswer: model('dossierAnswer'),
    dossierAnswerRevision: model('dossierAnswerRevision', () => ({ replacedAt: new Date() })),
    candidature: model('candidature', () => ({
      submittedAt: null,
      financingStatus: 'preparing',
      financingStatusChangedAt: new Date(),
    })),
    candidatureStatusChange: model('candidatureStatusChange', () => ({ changedAt: new Date() })),
    candidatureAnswer: model('candidatureAnswer'),
    candidatureAnswerRevision: model('candidatureAnswerRevision', () => ({
      replacedAt: new Date(),
    })),
    classificationRule: model('classificationRule', () => ({
      choiceKey: '',
      value: '',
      position: 0,
      updatedAt: new Date(),
    })),
    libraryDocument: model('libraryDocument', () => ({ fieldId: null, type: 'other' })),
    document: model('document', () => ({ restoredFromId: null })),
    dossierDocument: model('dossierDocument', () => ({ pinnedVersionId: null })),
    workspace: model('workspace', () => ({ logoKey: null })),
    fundingSourceCategory: model('fundingSourceCategory', () => ({ active: true })),
    workspaceMembership: model('workspaceMembership', () => ({
      organization: null,
      investorType: null,
      canManageWorkspace: false,
      invitedById: null,
      deactivatedAt: null,
    })),
  }
  self.prisma = prisma
  return { prisma, tables, table }
}

type FakePrisma = ReturnType<typeof createFakePrisma>['prisma']

// The dossier selects every document of its company's library, following their latest version, as
// the E05.07 migration leaves an existing dossier.
export async function selectWholeLibrary(
  prisma: FakePrisma,
  dossier: { id: string; companyId: string },
): Promise<void> {
  const documents = await prisma.libraryDocument.findMany({
    where: { companyId: dossier.companyId },
  })
  for (const document of documents) {
    if (!document) continue
    const key = { dossierId: dossier.id, libraryDocumentId: document.id }
    if (!(await prisma.dossierDocument.findFirst({ where: key }))) {
      await prisma.dossierDocument.create({ data: { ...key, companyId: dossier.companyId } })
    }
  }
}

// A stored version of a library document (E05.06), its document created on first use, as a deposit
// leaves them.
export async function seedDocument(
  prisma: FakePrisma,
  data: {
    companyId: string
    filename: string
    fieldId?: string | null
    type?: string
    id?: string
    version?: number
    storageKey?: string
    mimetype?: string
    size?: number
  },
): Promise<Row> {
  const { companyId, filename, fieldId = null, type, ...version } = data
  const document =
    (await prisma.libraryDocument.findFirst({ where: { companyId, fieldId, filename } })) ??
    (await prisma.libraryDocument.create({
      data: { companyId, fieldId, filename, ...(type ? { type } : {}) },
    }))
  return prisma.document.create({
    data: {
      version: 1,
      storageKey: `companies/${companyId}/${randomUUID()}`,
      mimetype: 'application/pdf',
      size: 10,
      ...version,
      libraryDocumentId: document.id,
      companyId,
      filename,
    },
  })
}
