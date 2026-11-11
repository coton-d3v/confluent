import { interestIdentityLabel } from '@confluent/shared'
import { interestIdentity } from './opportunities.service'

// ROADMAP E07.05 (D05): who an investor showing their name is to the owner — never their address.
describe('interestIdentity', () => {
  it('joins the account’s first and last names, trimmed, and keeps the organizations given', () => {
    expect(interestIdentity({ firstName: ' Claire ', lastName: 'Martin' }, ['Angels'])).toEqual({
      name: 'Claire Martin',
      organizations: ['Angels'],
    })
    expect(interestIdentity({ firstName: null, lastName: 'Martin' }, [])).toEqual({
      name: 'Martin',
      organizations: [],
    })
  })

  it('has no name for an account without one, whatever else is known', () => {
    for (const account of [
      {},
      { firstName: null, lastName: null },
      { firstName: '  ', lastName: '' },
    ]) {
      expect(interestIdentity(account, []).name).toBeNull()
    }
  })

  it('reads as the name, else a neutral label, followed by the organizations', () => {
    expect(interestIdentityLabel({ name: 'Claire Martin', organizations: [] })).toBe(
      'Claire Martin',
    )
    expect(interestIdentityLabel({ name: null, organizations: ['Angels', 'Club'] })).toBe(
      'Investisseur (nom non renseigné) — Angels, Club',
    )
  })
})
