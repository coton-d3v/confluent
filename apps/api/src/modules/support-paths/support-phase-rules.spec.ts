import {
  SUPPORT_PHASES,
  SUPPORT_PHASE_LABELS,
  portfolioQuerySchema,
  supportProgress,
} from '@confluent/shared'

const A = '7d3c1b0e-0000-4000-8000-0000000014a1'
const B = '7d3c1b0e-0000-4000-8000-0000000014a2'
const C = '7d3c1b0e-0000-4000-8000-0000000014a3'
const ON = new Date('2026-11-11T10:00:00Z')

const step = (id: string, label: string, validated: boolean, active = true) => ({
  id,
  label,
  active,
  validatedAt: validated ? ON : null,
})

// ROADMAP E06.07: THE phase rule of a candidature, computed in @confluent/shared from its workspace's
// support path (active steps, in their order) and its validations — for the API, which returns it to
// both sides and builds the portfolio with it, and through it for the site.
describe('support phase rule', () => {
  it('is in preparation while an active step is left, the current step being the first one left in the path’s order', () => {
    expect(
      supportProgress([
        step(A, 'Diagnostic', true),
        step(B, 'Business plan', false),
        step(C, 'Pitch', false),
      ]),
    ).toEqual({
      phase: 'in_progress',
      validatedSteps: 1,
      totalSteps: 3,
      currentStep: { id: B, label: 'Business plan' },
    })
    // Nothing validated yet: the first step.
    expect(
      supportProgress([step(A, 'Diagnostic', false), step(B, 'Pitch', false)]).currentStep,
    ).toEqual({ id: A, label: 'Diagnostic' })
  })

  it('keeps the first step left as current when a later one was validated first (the order is indicative)', () => {
    expect(
      supportProgress([
        step(A, 'Diagnostic', false),
        step(B, 'Business plan', true),
        step(C, 'Pitch', true),
      ]),
    ).toEqual({
      phase: 'in_progress',
      validatedSteps: 2,
      totalSteps: 3,
      currentStep: { id: A, label: 'Diagnostic' },
    })
  })

  it('is ready to raise once every active step is validated', () => {
    expect(supportProgress([step(A, 'Diagnostic', true), step(B, 'Pitch', true)])).toEqual({
      phase: 'ready',
      validatedSteps: 2,
      totalSteps: 2,
      currentStep: null,
    })
  })

  it('ignores deactivated steps, validated or not', () => {
    // A deactivated step left to validate does not hold the candidature back…
    expect(
      supportProgress([
        step(A, 'Diagnostic', true),
        step(B, 'Ancienne étape', false, false),
        step(C, 'Pitch', true),
      ]),
    ).toEqual({ phase: 'ready', validatedSteps: 2, totalSteps: 2, currentStep: null })
    // …and a deactivated step validated earlier counts for nothing.
    expect(
      supportProgress([step(A, 'Ancienne étape', true, false), step(B, 'Pitch', false)]),
    ).toEqual({
      phase: 'in_progress',
      validatedSteps: 0,
      totalSteps: 1,
      currentStep: { id: B, label: 'Pitch' },
    })
  })

  it('never claims readiness without an active step: an empty path, or only deactivated steps, is « sans parcours »', () => {
    const none = { phase: 'no_path', validatedSteps: 0, totalSteps: 0, currentStep: null }
    expect(supportProgress([])).toEqual(none)
    expect(
      supportProgress([step(A, 'Diagnostic', true, false), step(B, 'Pitch', false, false)]),
    ).toEqual(none)
  })

  it('reads a validation date as written by the API (Date) or received by the site (ISO string)', () => {
    expect(
      supportProgress([{ id: A, label: 'Pitch', active: true, validatedAt: ON.toISOString() }])
        .phase,
    ).toBe('ready')
  })

  it('names each phase in French', () => {
    expect(SUPPORT_PHASES.map((p) => SUPPORT_PHASE_LABELS[p])).toEqual([
      'En préparation',
      'Prête à lever',
      'Sans parcours',
    ])
  })

  describe('portfolio query', () => {
    const parse = (q: Record<string, string>) => portfolioQuerySchema.safeParse(q)

    it('accepts the list’s filters, a phase, a current step and a page', () => {
      expect(
        parse({
          phase: 'ready',
          step: A,
          page: '2',
          financingStatus: 'in_committee',
          scheme: B,
          verified: 'true',
        }).data,
      ).toEqual({
        phase: 'ready',
        step: A,
        page: 2,
        financingStatus: 'in_committee',
        scheme: B,
        verified: true,
      })
      expect(parse({}).data).toEqual({})
    })

    it.each([
      [{ phase: 'prete' }],
      [{ step: 'diagnostic' }],
      [{ page: '0' }],
      [{ page: '1.5' }],
      [{ page: 'deux' }],
      [{ page: '10001' }],
      [{ sort: 'name' }],
    ])('refuses %j', (q) => {
      expect(parse(q).success).toBe(false)
    })
  })
})
