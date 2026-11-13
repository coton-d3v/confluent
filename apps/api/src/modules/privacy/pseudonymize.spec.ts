import { pseudonymousAddress, replaceWholeValue, subjectRefOf } from './pseudonymize'

// ROADMAP E10.10: a deleted account's address is replaced where it is a whole value, never inside a
// text or another address (R64).
describe('replaceWholeValue', () => {
  it('replaces whole values, without case nor surrounding spaces, at any depth', () => {
    const metadata = {
      recipientEmail: ' Alice@Corp.fr ',
      list: ['alice@corp.fr', 'bob@corp.fr'],
      nested: { email: 'ALICE@CORP.FR', count: 2, flag: true, none: null },
      text: 'écrit à alice@corp.fr',
      other: 'x.alice@corp.fr',
    }
    expect(replaceWholeValue(metadata, 'alice@corp.fr', 'compte-supprime-1')).toEqual({
      recipientEmail: 'compte-supprime-1',
      list: ['compte-supprime-1', 'bob@corp.fr'],
      nested: { email: 'compte-supprime-1', count: 2, flag: true, none: null },
      text: 'écrit à alice@corp.fr',
      other: 'x.alice@corp.fr',
    })
  })

  it('returns the very same object when nothing changes', () => {
    const metadata = { a: 'bob@corp.fr', b: ['x'], c: { d: 1 } }
    expect(replaceWholeValue(metadata, 'alice@corp.fr', 'r')).toBe(metadata)
  })

  it('names a deleted account by its request, in a reserved domain', () => {
    const ref = subjectRefOf('0b4f6a8e-1234-4000-8000-000000000001')
    expect(ref).toBe('compte-supprime-0b4f6a8e')
    expect(pseudonymousAddress(ref)).toBe('compte-supprime-0b4f6a8e@confluent.invalid')
  })
})
