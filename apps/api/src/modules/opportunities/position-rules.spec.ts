import { dossierPositionsSchema } from '@confluent/shared'
import { ownerPositions, type OwnerSideInput } from './positions.service'

const at = new Date('2026-11-10T09:00:00.000Z')
const who = (name: string | null, organizations: string[] = []) => ({ name, organizations })
const mark = (nameVisible: boolean) => ({ nameVisible, createdAt: at })
const pledge = (amountEur: number, showName: boolean, showAmount: boolean) => ({
  amountEur,
  showName,
  showAmount,
})

// ROADMAP E07.07: what the owner reads of the positions, in one view — everything counted, a line by
// name only for what shows the name, never a link the investor did not make.
describe('ownerPositions', () => {
  it('counts every position, the total of every pledge, and names nobody by default', () => {
    const view = ownerPositions([
      {
        identity: who('Claire Martin'),
        interest: mark(false),
        pledge: pledge(25_000, false, false),
      },
      { identity: who('Bob Durand'), interest: mark(false), pledge: null },
      { identity: who('Zoé Petit'), interest: null, pledge: pledge(5_000, false, false) },
    ])
    expect(view).toEqual({
      interests: { count: 2 },
      pledges: { count: 2, totalEur: 30_000 },
      named: [],
      anonymousAmounts: [],
    })
  })

  it('joins a mark and a pledge only when both show the name, and keeps a nameless pledge apart', () => {
    const investors: OwnerSideInput[] = [
      // Both show the name: one line.
      {
        identity: who('Claire Martin', ['Angels']),
        interest: mark(true),
        pledge: pledge(25_000, true, true),
      },
      // The mark shows the name, the pledge only its amount: the amount stays anonymous.
      { identity: who('Bob Durand'), interest: mark(true), pledge: pledge(100_000, false, true) },
      // The pledge shows the name, the mark does not: the mark stays uncounted by name.
      { identity: who('Alice Bernard'), interest: mark(false), pledge: pledge(8_000, true, false) },
      // Nothing shown.
      { identity: who('Eve Noir'), interest: mark(false), pledge: pledge(1_000, false, false) },
    ]
    const view = ownerPositions(investors)
    expect(dossierPositionsSchema.safeParse(JSON.parse(JSON.stringify(view))).success).toBe(true)
    expect(view).toEqual({
      interests: { count: 4 },
      pledges: { count: 4, totalEur: 134_000 },
      named: [
        { identity: who('Alice Bernard'), interest: null, pledge: { amountEur: null } },
        { identity: who('Bob Durand'), interest: { markedAt: at }, pledge: null },
        {
          identity: who('Claire Martin', ['Angels']),
          interest: { markedAt: at },
          pledge: { amountEur: 25_000 },
        },
      ],
      anonymousAmounts: [100_000],
    })
    // Never the hidden amount of a named pledge, nor anything of Eve.
    const raw = JSON.stringify(view)
    for (const hidden of ['8000', 'Eve', '"1000']) expect(raw).not.toContain(hidden)
  })

  it('lists the anonymous amounts the largest first, whatever the order of the pledges', () => {
    const view = ownerPositions(
      [3_000, 70_000, 12_000].map((amount, i) => ({
        identity: who(`Investisseur ${i}`),
        interest: null,
        pledge: pledge(amount, false, true),
      })),
    )
    expect(view.anonymousAmounts).toEqual([70_000, 12_000, 3_000])
    expect(view.named).toEqual([])
  })
})
