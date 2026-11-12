import type { PositionsService } from '../modules/opportunities/positions.service'

// For tests of the financing plan that involve no pledge (E06.04): no side reads any pledge.
export const NO_PLEDGES = {
  pledgesFor: () => Promise.resolve([]),
} as unknown as PositionsService
