import { constraintsProblem, fieldConstraintsSchema } from '@confluent/shared'

// The limits an admin sets on a field (E03.05) must leave at least one valid answer.
describe('constraintsProblem', () => {
  it.each([
    [{ min: 0.1, max: 0.9, integer: true }, 'Aucun nombre entier ne respecte ces limites.'],
    [{ min: 1.5, max: 1.9, integer: true }, 'Aucun nombre entier ne respecte ces limites.'],
    [{ min: 0.1, max: 1, integer: true }, null],
    [{ min: 0.1, max: 0.9 }, null],
    [{ min: -2.5, max: -2.1, integer: true }, 'Aucun nombre entier ne respecte ces limites.'],
    [{ min: -2.5, max: -2, integer: true }, null],
    [{ min: 3, max: 3, integer: true }, null],
  ])('number limits %j → %p (code review R38)', (constraints, expected) => {
    expect(constraintsProblem('number', constraints)).toBe(expected)
  })

  it('refuses date bounds that are not calendar days (code review R19)', () => {
    for (const bound of ['2026-99-99', '2026-02-30', '2026-1-01']) {
      expect(fieldConstraintsSchema.safeParse({ min: bound }).success).toBe(false)
      expect(constraintsProblem('date', { min: bound })).not.toBeNull()
    }
    expect(constraintsProblem('date', { min: '2024-02-29', max: '2026-12-31' })).toBeNull()
  })
})
