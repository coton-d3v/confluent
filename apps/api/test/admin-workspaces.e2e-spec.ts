import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import {
  STORAGE_TOKEN,
  type StorageAdapter,
} from './../src/modules/documents/storage/storage.adapter'
import { createFakePrisma } from '../src/testing/fake-prisma'

// Smallest real images of each accepted format (content is what is checked, not the name).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

describe('/v1/admin/workspaces (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let storage: StorageAdapter
  const jwt: Record<string, string> = {}

  beforeEach(async () => {
    fake = createFakePrisma()
    const roles = { 'admin-1': 'admin', 'u-1': 'entrepreneur', 'f-1': 'financeur' }
    for (const [id, role] of Object.entries(roles)) {
      await fake.prisma.user.create({
        data: { id, email: `${id}@confluent.dev`, role, emailVerifiedAt: new Date() },
      })
    }
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fake.prisma)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({ sendMagicLink: jest.fn(), sendShareInvite: jest.fn() })
      .compile()
    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
    storage = app.get(STORAGE_TOKEN)
    for (const [id, role] of Object.entries(roles)) {
      jwt[role] = await new JwtService().signAsync(
        { sub: id, email: `${id}@confluent.dev`, role },
        { secret: process.env.JWT_SECRET },
      )
    }
  })

  afterEach(async () => {
    await app.close()
  })

  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    role: string | null = 'admin',
  ) => {
    const req = request(app.getHttpServer())[method](`/v1/admin/workspaces${path}`)
    return role ? req.set('Authorization', `Bearer ${jwt[role]}`) : req
  }
  const uploadLogo = (id: string, file: Buffer, role = 'admin') =>
    call('post', `/${id}/logo`, role).attach('file', file, 'logo.png')
  const createCci = () =>
    call('post', '')
      .send({ name: 'CCI Touraine', programName: 'MoneyPlace' })
      .expect(201)
      .then((res) => res.body as { id: string; slug: string })
  const audits = (action: string) =>
    [...fake.table('auditLog').values()].filter((row) => row.actionType === action)

  it('creates a workspace with normalised settings and a slug derived from its name', async () => {
    const res = await call('post', '')
      .send({
        name: '  Réseau Entreprendre Val de Loire ',
        programName: '',
        color: '#1D4ED8',
        presentation: 'Programme d’accompagnement.\r\nComités mensuels.',
        contactEmail: ' Contact@Reseau.FR ',
        emailDomain: '@Reseau-Entreprendre.FR',
      })
      .expect(201)
    expect(res.body).toMatchObject({
      slug: 'reseau-entreprendre-val-de-loire',
      name: 'Réseau Entreprendre Val de Loire',
      programName: null,
      color: '#1d4ed8',
      presentation: 'Programme d’accompagnement.\nComités mensuels.',
      contactEmail: 'contact@reseau.fr',
      emailDomain: 'reseau-entreprendre.fr',
      logo: null,
    })
    expect(audits('workspace_created')).toEqual([
      expect.objectContaining({
        actorId: 'admin-1',
        metadata: expect.objectContaining({ workspaceId: res.body.id }),
      }),
    ])

    const list = await call('get', '').expect(200)
    expect(list.body.map((w: { slug: string }) => w.slug)).toEqual([
      'reseau-entreprendre-val-de-loire',
    ])
    await call('get', `/${res.body.id}`).expect(200)
  })

  it('refuses a slug already used, and never suffixes it', async () => {
    await call('post', '').send({ name: 'Club deal', slug: 'club-deal' }).expect(201)
    const taken = await call('post', '').send({ name: 'Club Deal' }).expect(409)
    expect(taken.body.error.message).toContain('« club-deal » est déjà utilisé')
    await call('post', '').send({ name: 'Club Deal', slug: 'club-deal-2' }).expect(201)
    const unusable = await call('post', '').send({ name: '!!!' }).expect(400)
    expect(unusable.body.error.message).toContain('indiquez le slug')
  })

  it('validates every setting and explains the error in French', async () => {
    const res = await call('post', '')
      .send({
        name: 'Incubateur',
        slug: 'Mon Incubateur',
        color: 'bleu',
        presentation: '<script>alert(1)</script>',
        contactEmail: 'pas-une-adresse',
        emailDomain: 'contact@incubateur.fr',
      })
      .expect(400)
    const messages = Object.fromEntries(
      (res.body.error.details as Array<{ path: string[]; message: string }>).map((d) => [
        d.path.join('.'),
        d.message,
      ]),
    )
    expect(messages).toEqual({
      slug: expect.stringContaining('lettres minuscules'),
      color: expect.stringContaining('#RRGGBB'),
      presentation: expect.stringContaining('balises HTML'),
      contactEmail: expect.stringContaining('adresse email valide'),
      emailDomain: expect.stringContaining('sans « @ »'),
    })
    await call('post', '').send({ name: '' }).expect(400)
    await call('post', '')
      .send({ name: 'x', presentation: 'a'.repeat(5001) })
      .expect(400)
    await call('post', '').send({ name: 'x', unknown: true }).expect(400)
    expect(fake.table('workspace').size).toBe(0)
  })

  it('updates only the settings sent, clears with null or an empty string, and keeps the slug', async () => {
    const ws = await createCci()
    const res = await call('patch', `/${ws.id}`)
      .send({ name: 'CCI Touraine — Tours', programName: null, color: '#0f766e', emailDomain: '' })
      .expect(200)
    expect(res.body).toMatchObject({
      slug: ws.slug,
      name: 'CCI Touraine — Tours',
      programName: null,
      color: '#0f766e',
      emailDomain: null,
    })
    expect(audits('workspace_updated')[0].metadata).toEqual({
      workspaceId: ws.id,
      changes: ['name', 'programName', 'color'],
    })

    const slug = await call('patch', `/${ws.id}`).send({ slug: 'autre' }).expect(400)
    expect(JSON.stringify(slug.body.error.details)).toContain('slug')
    await call('patch', `/${ws.id}`).send({}).expect(400)
    await call('patch', '/00000000-0000-4000-8000-000000000000').send({ name: 'x' }).expect(404)
    await call('get', '/00000000-0000-4000-8000-000000000000').expect(404)
    await call('get', '/pas-un-uuid').expect(400)
  })

  it('stores the logo in the private bucket, replaces it and removes it', async () => {
    const ws = await createCci()
    const first = await uploadLogo(ws.id, PNG).expect(201)
    expect(first.body.logo).toEqual({
      availability: 'available',
      url: expect.stringMatching(
        new RegExp(`^memory://workspaces/${ws.id}/logo/[0-9a-f-]+\\.png$`),
      ),
    })
    const firstKey = (first.body.logo.url as string).replace('memory://', '')
    expect(await storage.exists(firstKey)).toBe(true)

    const second = await uploadLogo(ws.id, JPEG).expect(201)
    const secondKey = (second.body.logo.url as string).replace('memory://', '')
    expect(secondKey).toMatch(/\.jpg$/)
    expect(await storage.exists(firstKey)).toBe(false)
    expect(await storage.exists(secondKey)).toBe(true)

    // A lost image is reported, not served as a broken URL.
    await storage.delete(secondKey)
    const lost = await call('get', `/${ws.id}`).expect(200)
    expect(lost.body.logo).toEqual({ availability: 'missing', url: null })

    await uploadLogo(ws.id, PNG).expect(201)
    const removed = await call('delete', `/${ws.id}/logo`).expect(200)
    expect(removed.body.logo).toBeNull()
    expect(fake.table('workspace').get(ws.id)?.logoKey).toBeNull()
    expect(
      audits('workspace_updated').map((a) => (a.metadata as { changes: string[] }).changes),
    ).toEqual([['logo'], ['logo'], ['logo'], ['logo_removed']])
  })

  it('refuses images it does not display safely and oversized files', async () => {
    const ws = await createCci()
    const svg = await uploadLogo(ws.id, SVG).expect(415)
    expect(svg.body.error.message).toContain('PNG, JPEG ou WebP')
    await call('post', `/${ws.id}/logo`).field('note', 'x').expect(400)
    // Over the limit: refused while streaming, or from the announced size before reading the body.
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)])
    await uploadLogo(ws.id, big).expect(413)
    const huge = await uploadLogo(
      ws.id,
      Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]),
    ).expect(413)
    expect(huge.body.error.message).toContain('1 Mo')
    await uploadLogo('00000000-0000-4000-8000-000000000000', PNG).expect(404)
    expect(fake.table('workspace').get(ws.id)?.logoKey).toBeNull()
  })

  it.each(['entrepreneur', 'financeur'])(
    'refuses every workspace operation to a %s account',
    async (role) => {
      const ws = await createCci()
      const refusals = [
        () => call('get', '', role),
        () => call('post', '', role).send({ name: 'Pirate' }),
        () => call('get', `/${ws.id}`, role),
        () => call('patch', `/${ws.id}`, role).send({ name: 'Pirate' }),
        () => uploadLogo(ws.id, PNG, role),
        () => call('delete', `/${ws.id}/logo`, role),
      ]
      for (const send of refusals) {
        const res = await send()
        expect(res.status).toBe(403)
        expect(res.body.error.message).toContain('aux administrateurs de Confluent')
      }
      expect(fake.table('workspace').size).toBe(1)
      expect(fake.table('workspace').get(ws.id)).toMatchObject({
        name: 'CCI Touraine',
        logoKey: null,
      })
    },
  )

  it('requires a signed-in account', async () => {
    await call('get', '', null).expect(401)
    await call('post', '', null).send({ name: 'Anonyme' }).expect(401)
  })
})
