import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FINANCING_AMOUNT_MAX_EUR,
  FUNDING_PLAN_LIMITS,
  FUNDING_PLAN_LINE_STATES,
  createFundingPlanLineSchema,
  deleteFundingPlanLineQuerySchema,
  fundingPlanBar,
  fundingPlanLineStateOf,
  fundingPlanSideOf,
  fundingPlanTotals,
  updateFundingPlanLineSchema,
} from '@confluent/shared'

const line = (state: string, amountEur: number) => ({ state, amountEur })
const CATEGORY = '7d3c1b0e-0000-4000-8000-000000001201'

// ROADMAP E06.03: the totals and the segmented bar of a plan, computed once in @confluent/shared for
// the API (and through it the site), and the contracts of a line.
describe('financing plan rules', () => {
  describe('totals', () => {
    it('adds each state apart against the objective: remaining = objective − obtained, uncovered = what no source covers', () => {
      expect(
        fundingPlanTotals(200_000, [
          line('obtained', 50_000),
          line('obtained', 30_000),
          line('requested', 40_000),
          line('planned', 20_000),
          line('refused', 100_000),
        ]),
      ).toEqual({
        objectiveEur: 200_000,
        obtainedEur: 80_000,
        requestedEur: 40_000,
        plannedEur: 20_000,
        refusedEur: 100_000,
        remainingEur: 120_000,
        uncoveredEur: 60_000,
        beyondObjectiveEur: 0,
        obtainedPercent: 40,
      })
    })

    it('never counts a refused or unknown state as obtained or in progress (closed by default)', () => {
      const totals = fundingPlanTotals(1000, [line('refused', 900), line('promised', 500)])
      expect(totals).toMatchObject({
        obtainedEur: 0,
        requestedEur: 0,
        plannedEur: 500,
        refusedEur: 900,
        remainingEur: 1000,
        uncoveredEur: 500,
      })
      expect(fundingPlanLineStateOf('promised')).toBe('planned')
      expect(fundingPlanLineStateOf(null)).toBe('planned')
      expect(fundingPlanSideOf('structure')).toBe('workspace')
      expect(fundingPlanSideOf('owner')).toBe('owner')
    })

    it('has no objective, remaining nor percentage while the amount sought is not stated', () => {
      for (const objective of [null, 0, -5]) {
        expect(fundingPlanTotals(objective, [line('obtained', 10)])).toEqual({
          objectiveEur: null,
          obtainedEur: 10,
          requestedEur: 0,
          plannedEur: 0,
          refusedEur: 0,
          remainingEur: null,
          uncoveredEur: null,
          beyondObjectiveEur: 0,
          obtainedPercent: null,
        })
      }
      expect(fundingPlanTotals(null, [])).toMatchObject({ obtainedEur: 0, remainingEur: null })
    })

    it('stops remaining and uncovered at zero, and tells what is obtained beyond the objective', () => {
      expect(fundingPlanTotals(100, [line('obtained', 130), line('requested', 50)])).toMatchObject({
        remainingEur: 0,
        uncoveredEur: 0,
        beyondObjectiveEur: 30,
        obtainedPercent: 130,
      })
      // Sources identified beyond the objective, nothing obtained beyond it.
      expect(fundingPlanTotals(100, [line('obtained', 60), line('planned', 90)])).toMatchObject({
        remainingEur: 40,
        uncoveredEur: 0,
        beyondObjectiveEur: 0,
      })
    })

    it('rounds the percentage down: 100 % only once the objective is reached', () => {
      expect(fundingPlanTotals(200_000, [line('obtained', 199_999)]).obtainedPercent).toBe(99)
      expect(fundingPlanTotals(200_000, [line('obtained', 200_000)]).obtainedPercent).toBe(100)
      expect(fundingPlanTotals(3, [line('obtained', 1)]).obtainedPercent).toBe(33)
      expect(
        fundingPlanTotals(FINANCING_AMOUNT_MAX_EUR, [line('obtained', 1)]).obtainedPercent,
      ).toBe(0)
    })

    it('stays exact in whole euros at the largest plan the limits allow', () => {
      const lines = Array.from({ length: FUNDING_PLAN_LIMITS.linesPerPlan }, () =>
        line('obtained', FINANCING_AMOUNT_MAX_EUR),
      )
      const totals = fundingPlanTotals(FINANCING_AMOUNT_MAX_EUR, lines)
      expect(totals.obtainedEur).toBe(50_000_000_000)
      expect(Number.isSafeInteger(totals.obtainedEur)).toBe(true)
      expect(totals.beyondObjectiveEur).toBe(49_000_000_000)
      expect(totals.obtainedPercent).toBe(5000)
    })
  })

  describe('segmented bar', () => {
    it('splits the objective into obtained, in progress, envisaged and without source, in that order', () => {
      const bar = fundingPlanBar(
        fundingPlanTotals(200_000, [
          line('planned', 20_000),
          line('obtained', 80_000),
          line('requested', 40_000),
          line('refused', 10_000),
        ]),
      )
      expect(bar).toEqual({
        segments: [
          { kind: 'obtained', amountEur: 80_000, share: 0.4 },
          { kind: 'requested', amountEur: 40_000, share: 0.2 },
          { kind: 'planned', amountEur: 20_000, share: 0.1 },
          { kind: 'uncovered', amountEur: 60_000, share: 0.3 },
        ],
        objectiveAt: null,
      })
      expect(bar.segments.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1)
    })

    it('draws sources beyond the objective on their own scale and marks the objective', () => {
      const bar = fundingPlanBar(
        fundingPlanTotals(100, [line('obtained', 150), line('planned', 50)]),
      )
      expect(bar).toEqual({
        segments: [
          { kind: 'obtained', amountEur: 150, share: 0.75 },
          { kind: 'planned', amountEur: 50, share: 0.25 },
        ],
        objectiveAt: 0.5,
      })
    })

    it('without objective, scales on the sources identified; empty without objective nor source', () => {
      expect(fundingPlanBar(fundingPlanTotals(null, [line('requested', 10)]))).toEqual({
        segments: [{ kind: 'requested', amountEur: 10, share: 1 }],
        objectiveAt: null,
      })
      expect(fundingPlanBar(fundingPlanTotals(null, [line('refused', 10)]))).toEqual({
        segments: [],
        objectiveAt: null,
      })
      expect(fundingPlanBar(fundingPlanTotals(500, []))).toEqual({
        segments: [{ kind: 'uncovered', amountEur: 500, share: 1 }],
        objectiveAt: null,
      })
    })
  })

  describe('contracts', () => {
    it('keeps the states equal to the CHECK constraint of the migration', () => {
      const sql = readFileSync(
        join(__dirname, '../../../prisma/migrations/20261119000000_funding_plans/migration.sql'),
        'utf8',
      )
      const states = /"state" IN \(([^)]+)\)/.exec(sql)![1]
      expect(states.split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([
        ...FUNDING_PLAN_LINE_STATES,
      ])
      expect(sql).toContain(`"amount_eur" BETWEEN 1 AND ${FINANCING_AMOUNT_MAX_EUR}`)
      expect(sql).toContain(`char_length("label") BETWEEN 1 AND ${FUNDING_PLAN_LIMITS.label}`)
    })

    it('accepts a line in whole euros with a known state, its detail on one trimmed line', () => {
      const ok = createFundingPlanLineSchema.parse({
        categoryId: CATEGORY,
        amountEur: 1000,
        state: 'requested',
        label: '  BNP \n Tours ',
      })
      expect(ok.label).toBe('BNP Tours')
      expect(
        createFundingPlanLineSchema.parse({
          categoryId: CATEGORY,
          amountEur: 1,
          state: 'obtained',
          label: '   ',
        }).label,
      ).toBeNull()
      for (const bad of [
        { categoryId: CATEGORY, amountEur: 0, state: 'planned' },
        { categoryId: CATEGORY, amountEur: 1.5, state: 'planned' },
        { categoryId: CATEGORY, amountEur: FINANCING_AMOUNT_MAX_EUR + 1, state: 'planned' },
        { categoryId: CATEGORY, amountEur: 10, state: 'promised' },
        { categoryId: 'bpifrance', amountEur: 10, state: 'planned' },
        { categoryId: CATEGORY, amountEur: 10, state: 'planned', label: 'x'.repeat(121) },
        { categoryId: CATEGORY, amountEur: 10, state: 'planned', version: 1 },
      ]) {
        expect(createFundingPlanLineSchema.safeParse(bad).success).toBe(false)
      }
    })

    it('needs the version seen and something to change on an update; null clears the detail', () => {
      expect(updateFundingPlanLineSchema.parse({ version: 2, label: null })).toEqual({
        version: 2,
        label: null,
      })
      for (const bad of [
        { version: 2 },
        { amountEur: 10 },
        { version: 0, amountEur: 10 },
        { version: 2, amountEur: 10, updatedBy: 'owner' },
      ]) {
        expect(updateFundingPlanLineSchema.safeParse(bad).success).toBe(false)
      }
      expect(deleteFundingPlanLineQuerySchema.parse({ version: '3' })).toEqual({ version: 3 })
      expect(deleteFundingPlanLineQuerySchema.safeParse({}).success).toBe(false)
    })
  })
})
