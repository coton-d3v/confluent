import {
  CLOSED_FINANCING_STATUSES,
  FINANCING_STATUSES,
  FINANCING_STATUS_TRANSITIONS,
  PUBLICATION_ACTIONS,
  financingStatusOf,
  financingTransition,
  financingTransitionsFor,
  publicationStatusOf,
  publicationTransition,
} from '@confluent/shared'

// ROADMAP E06.01, decision D03 (to be confirmed): the two status machines, as @confluent/shared
// describes them once for the API and the site.
describe('D03 status rules', () => {
  it('reads unknown statuses as the least diffusing ones (closed by default)', () => {
    expect(publicationStatusOf('publiee')).toBe('draft')
    expect(publicationStatusOf(null)).toBe('draft')
    expect(financingStatusOf('financé')).toBe('preparing')
    expect(financingStatusOf(undefined)).toBe('preparing')
  })

  it('moves a publication along its four actions only', () => {
    const table = Object.fromEntries(
      PUBLICATION_ACTIONS.map((action) => [
        action,
        ['draft', 'published', 'archived'].map((s) => publicationTransition(s, action)),
      ]),
    )
    expect(table).toEqual({
      publish: ['allowed', 'unchanged', 'refused'],
      unpublish: ['unchanged', 'allowed', 'refused'],
      archive: ['allowed', 'allowed', 'unchanged'],
      unarchive: ['unchanged', 'refused', 'allowed'],
    })
  })

  it('gives the owner only abandoning and resuming their own abandonment', () => {
    expect(
      FINANCING_STATUSES.map((from) => [from, financingTransitionsFor(from, 'owner')]),
    ).toEqual([
      ['preparing', ['abandoned']],
      ['in_committee', ['abandoned']],
      ['funded', []],
      ['refused', []],
      ['abandoned', ['preparing']],
    ])
  })

  it('gives the workspace every transition, closed statuses reopening to preparation only', () => {
    expect(
      FINANCING_STATUSES.map((from) => [from, financingTransitionsFor(from, 'workspace')]),
    ).toEqual([
      ['preparing', ['in_committee', 'funded', 'refused', 'abandoned']],
      ['in_committee', ['preparing', 'funded', 'refused', 'abandoned']],
      ['funded', ['preparing']],
      ['refused', ['preparing']],
      ['abandoned', ['preparing']],
    ])
    for (const closed of CLOSED_FINANCING_STATUSES) {
      expect(
        FINANCING_STATUS_TRANSITIONS.filter((t) => t.from === closed).map((t) => t.to),
      ).toEqual(['preparing'])
    }
  })

  it('tells a transition nobody makes from one reserved to the other side', () => {
    expect(financingTransition('refused', 'funded', 'workspace')).toBe('impossible')
    expect(financingTransition('preparing', 'preparing', 'workspace')).toBe('impossible')
    expect(financingTransition('preparing', 'funded', 'owner')).toBe('forbidden')
    expect(financingTransition('preparing', 'abandoned', 'owner')).toBe('allowed')
    // Unknown actors are given nothing.
    expect(financingTransition('preparing', 'abandoned', 'investor' as never)).toBe('forbidden')
  })
})
