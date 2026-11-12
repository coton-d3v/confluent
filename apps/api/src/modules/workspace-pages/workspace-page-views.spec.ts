import { Prisma, type Workspace } from '@prisma/client'
import { PUBLIC_WORKSPACE_FIELDS, publicWorkspaceSchema } from '@confluent/shared'
import { WORKSPACE_COLUMN_AUDIENCE, logoVersionOf, toPublicWorkspace } from './workspace-page-views'

// A workspace row whose internal columns hold values found nowhere else.
const ROW: Workspace = {
  id: '6f1c2a8e-0000-4000-8000-00000000c1c1',
  slug: 'cci-touraine',
  name: 'CCI Touraine',
  programName: 'MoneyPlace',
  color: '#1d4ed8',
  presentation: 'La CCI accompagne les entreprises.',
  contactEmail: 'membres-prive@cci-touraine.fr',
  emailDomain: 'domaine-interne.fr',
  logoKey: 'workspaces/6f1c2a8e-0000-4000-8000-00000000c1c1/logo/0000-cle-privee.png',
  createdAt: new Date('2031-01-02T03:04:05.678Z'),
  updatedAt: new Date('2032-02-03T04:05:06.789Z'),
  publicPagePublished: true,
  publicCriteria: 'Entreprises innovantes.',
  publicContact: 'Écrivez à vitrine@cci-touraine.fr.',
  publicPageVersion: 987654,
  publicPageBlocks: ['contact', 'presentation'],
}

const scalarColumns = () =>
  Prisma.dmmf.datamodel.models
    .find((m) => m.name === 'Workspace')!
    .fields.filter((f) => f.kind === 'scalar')
    .map((f) => f.name)
    .sort()

// ROADMAP E09.01: what the public reads of a workspace, and the classification of every column it is
// built from.
describe('public workspace view', () => {
  it('classifies every column of the workspaces, and only those (closed by default)', () => {
    // A column added to the model without being classified fails here (and does not compile).
    expect(Object.keys(WORKSPACE_COLUMN_AUDIENCE).sort()).toEqual(scalarColumns())
    for (const column of ['id', 'contactEmail', 'emailDomain', 'logoKey'] as const) {
      expect([column, WORKSPACE_COLUMN_AUDIENCE[column]]).toEqual([column, 'internal'])
    }
  })

  it('never lets an internal column reach the public, and carries every public one', () => {
    const view = toPublicWorkspace(ROW)
    const json = JSON.stringify(view)
    const columns = Object.entries(WORKSPACE_COLUMN_AUDIENCE) as Array<
      [keyof Workspace, 'public' | 'internal']
    >
    for (const [column, audience] of columns) {
      const value = ROW[column]
      const text = value instanceof Date ? value.toISOString() : String(value)
      expect([column, audience, json.includes(text)]).toEqual([
        column,
        audience,
        audience === 'public',
      ])
    }
    expect(Object.keys(view)).toEqual([...PUBLIC_WORKSPACE_FIELDS])
    // The logo is named by a version that tells nothing of its key.
    expect(view.logoVersion).toBe(logoVersionOf(ROW.logoKey!))
    expect(json).not.toMatch(/workspaces\/|cle-privee|6f1c2a8e/)
    const sent = JSON.parse(json) as unknown
    expect(publicWorkspaceSchema.parse(sent)).toEqual(sent)
  })

  it('gives no logo version without a logo, and a new one with each image', () => {
    expect(toPublicWorkspace({ ...ROW, logoKey: null }).logoVersion).toBeNull()
    expect(logoVersionOf(`${ROW.logoKey}x`)).not.toBe(logoVersionOf(ROW.logoKey!))
    expect(logoVersionOf(ROW.logoKey!)).toMatch(/^[0-9a-f]{16}$/)
  })
})
