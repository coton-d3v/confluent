import { PLEDGE_INTENTIONS, pledgeInputSchema, pledgeIntentionOf } from '@confluent/shared'
import type { InvestorPledge } from '@prisma/client'
import { pledgeView } from './opportunities.service'

// ROADMAP E07.06: the pledge's contract (@confluent/shared `pledge.schema.ts`), as the API reads it.
describe('pledge rules', () => {
  const body = {
    intention: 'likely',
    amountEur: 25_000,
    showName: false,
    showAmount: true,
    version: null,
  }

  it('reads an unknown intention as the least firm one (closed by default)', () => {
    expect(PLEDGE_INTENTIONS.map((i) => pledgeIntentionOf(i))).toEqual([...PLEDGE_INTENTIONS])
    for (const raw of [null, undefined, '', 'firm', 'STRONG']) {
      expect(pledgeIntentionOf(raw)).toBe('exploring')
    }
    const row = {
      intention: 'firm',
      amountEur: 1,
      comment: null,
      showName: false,
      showAmount: false,
      version: 1,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as unknown as InvestorPledge
    expect(pledgeView(row).intention).toBe('exploring')
  })

  it('keeps the comment as plain paragraphs, blank meaning none', () => {
    const parse = (comment: unknown) => pledgeInputSchema.parse({ ...body, comment }).comment
    expect(parse('  Si  le lead\r\n\r\n\r\nest confirmé.  ')).toBe('Si le lead\n\nest confirmé.')
    expect(parse(' \n\t ')).toBeNull()
    expect(parse(null)).toBeNull()
    expect(pledgeInputSchema.parse(body).comment).toBeUndefined()
    expect(pledgeInputSchema.safeParse({ ...body, comment: '<script>' }).success).toBe(false)
  })

  it('asks for both visibilities and the version read, with no default', () => {
    for (const missing of ['showName', 'showAmount', 'version', 'intention', 'amountEur']) {
      const partial: Record<string, unknown> = { ...body }
      delete partial[missing]
      expect([missing, pledgeInputSchema.safeParse(partial).success]).toEqual([missing, false])
    }
  })
})
