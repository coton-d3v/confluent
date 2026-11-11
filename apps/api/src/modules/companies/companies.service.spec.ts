import { HttpException } from '@nestjs/common'
import type { AuditService } from '../audit/audit.service'
import type { ClassificationService } from '../classification/classification.service'
import { DossiersService } from '../dossiers/dossiers.service'
import type { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import { CompaniesService } from './companies.service'
import { canOwnCompanies } from './company-access'

const SOPHIE = { id: 'u-sophie', email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const MARC = { id: 'u-marc', email: 'marc@agrotech.fr', role: 'entrepreneur' }
const FINANCEUR = { id: 'u-fin', email: 'fin@fonds.fr', role: 'financeur' }

function setup() {
  const fake = createFakePrisma()
  const p = fake.prisma
  const ensureBootstrap = jest.fn().mockResolvedValue({ id: 'qv-1', version: 1 })
  const companies = new CompaniesService(p as never)
  const dossiers = new DossiersService(
    p as never,
    {
      ensureBootstrap,
      getVersion: jest.fn().mockResolvedValue(null),
    } as unknown as QuestionnairesService,
    {} as ClassificationService,
    { record: jest.fn() } as unknown as AuditService,
    companies,
  )
  return { fake, p, companies, dossiers, ensureBootstrap }
}

async function statusOf(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(HttpException)
  return { status: (err as HttpException).getStatus(), body: (err as HttpException).getResponse() }
}

// ROADMAP E05.04: the company owns its financing dossiers; one rule says who may own one.
describe('companies', () => {
  it('lets entrepreneurs and administrators own a company, nobody else', () => {
    expect(canOwnCompanies({ role: 'entrepreneur' })).toBe(true)
    expect(canOwnCompanies({ role: 'admin' })).toBe(true)
    expect(canOwnCompanies({ role: 'financeur' })).toBe(false)
    // Closed by default: a role this code does not know owns nothing.
    expect(canOwnCompanies({ role: 'conseiller' })).toBe(false)
    expect(canOwnCompanies({ role: '' })).toBe(false)
  })

  it('creates each new dossier with its own company, named after it and owned by the same account', async () => {
    const { fake, dossiers } = setup()
    const first = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
    const second = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })

    const rows = [...fake.table('company').values()]
    expect(rows).toHaveLength(2)
    expect(first.companyId).not.toBe(second.companyId)
    for (const d of [first, second]) {
      const company = fake.table('company').get(d.companyId)!
      expect(company).toMatchObject({ ownerId: SOPHIE.id, name: 'Biosensio' })
      expect(d.userId).toBe(SOPHIE.id)
      expect(d.company).toEqual({ id: d.companyId, name: 'Biosensio', inPreparation: false })
    }
  })

  it('refuses a dossier, and so a company, to an account that cannot own one, writing nothing', async () => {
    const { fake, dossiers, ensureBootstrap } = setup()
    for (const owner of [FINANCEUR, { ...SOPHIE, role: 'inconnu' }]) {
      const { status, body } = await statusOf(dossiers.create({ owner, name: 'Fonds' }))
      expect(status).toBe(403)
      expect(body).toMatchObject({ code: 'COMPANY_OWNERS_ONLY' })
    }
    expect(fake.table('company').size).toBe(0)
    expect(fake.table('dossier').size).toBe(0)
    expect(ensureBootstrap).not.toHaveBeenCalled()
  })

  it('shows the owner their companies with their dossiers, and nothing of another account', async () => {
    const { companies, dossiers } = setup()
    const own = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
    const other = await dossiers.create({ owner: MARC, name: 'Agrotech' })

    const mine = await companies.listForOwner(SOPHIE)
    expect(mine.map((c) => c.name)).toEqual(['Biosensio'])
    expect(mine[0].dossiers).toEqual([
      {
        id: own.id,
        slug: own.slug,
        name: 'Biosensio',
        summary: null,
        amountEur: null,
        financingTypes: [],
        publicationStatus: 'draft',
        publishedAt: null,
        submittedAt: null,
        createdAt: own.createdAt,
      },
    ])
    // Explicit fields only: no owner identifier.
    expect(mine[0]).not.toHaveProperty('ownerId')
    expect(await companies.getForOwner(own.companyId, SOPHIE)).toEqual(mine[0])

    // Another account's company answers exactly like one that does not exist.
    const foreign = await statusOf(companies.getForOwner(other.companyId, SOPHIE))
    const missing = await statusOf(
      companies.getForOwner('00000000-0000-4000-8000-000000000000', SOPHIE),
    )
    expect(foreign).toEqual(missing)
    expect(foreign).toEqual({
      status: 404,
      body: { code: 'COMPANY_NOT_FOUND', message: 'Entreprise introuvable.' },
    })
    expect(await companies.listForOwner(FINANCEUR)).toEqual([])
  })

  it('removes the company with its last dossier, and keeps it while another one remains', async () => {
    const { fake, p, dossiers } = setup()
    const alone = await dossiers.create({ owner: SOPHIE, name: 'Seul' })
    await dossiers.delete(alone.id, SOPHIE.id)
    expect(fake.table('company').has(alone.companyId)).toBe(false)
    expect(fake.table('dossier').has(alone.id)).toBe(false)

    // A second dossier of the same company cannot be created through the API before E05.07.
    const kept = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
    const sibling = await p.dossier.create({
      data: { userId: SOPHIE.id, companyId: kept.companyId, name: 'Levée 2', slug: 'levee-2' },
    })
    await dossiers.delete(sibling.id, SOPHIE.id)
    expect(fake.table('company').has(kept.companyId)).toBe(true)
    expect(fake.table('dossier').has(kept.id)).toBe(true)
  })

  it('refuses to delete the dossier of another account, keeping its company', async () => {
    const { fake, dossiers } = setup()
    const other = await dossiers.create({ owner: MARC, name: 'Agrotech' })
    expect((await statusOf(dossiers.delete(other.id, SOPHIE.id))).status).toBe(404)
    expect(fake.table('company').has(other.companyId)).toBe(true)
    expect(fake.table('dossier').has(other.id)).toBe(true)
  })

  it('gives the company with the dossier to its owner only, never through a share', async () => {
    const { p, dossiers } = setup()
    await p.user.create({ data: { ...SOPHIE } })
    const own = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
    await p.shareLink.create({
      data: {
        dossierId: own.id,
        recipientEmail: FINANCEUR.email,
        status: 'active',
        accessLevel: 'complet',
      },
    })

    const [listed] = await dossiers.listForUser(SOPHIE)
    expect(listed).toMatchObject({ id: own.id, company: { id: own.companyId, name: 'Biosensio' } })
    const detail = await dossiers.getWithQuestionnaire(own.id, SOPHIE)
    expect(detail).toMatchObject({ company: { id: own.companyId, name: 'Biosensio' } })

    const [shared] = await dossiers.listForUser(FINANCEUR)
    expect(shared.id).toBe(own.id)
    expect(shared).not.toHaveProperty('company')
    expect(await dossiers.getWithQuestionnaire(own.id, FINANCEUR)).not.toHaveProperty('company')
  })
})
