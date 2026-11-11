import {
  FINANCING_STATUSES,
  poolPublicationBlocker,
  poolPublicationState,
  publishToPoolSchema,
} from '@confluent/shared'
import type { PoolPublication } from '@prisma/client'
import { poolPublicationView } from './pool-publication'

// ROADMAP E07.02: THE rule of the pool, as @confluent/shared describes it once for the API, the site
// and E07.03 — closed by default.
describe('pool publication rules', () => {
  const sent = { submittedAt: new Date(), financingStatus: 'preparing' }
  const published = { publicationStatus: 'published' }

  it('lists a publication only while withdrawn by nobody, its candidature sent, its request published and its follow-up open', () => {
    const active = { withdrawnAt: null }
    expect(poolPublicationState(active, published, sent)).toEqual({
      state: 'listed',
      pausedBecause: null,
    })
    expect(
      poolPublicationState(active, published, { ...sent, financingStatus: 'in_committee' }),
    ).toMatchObject({ state: 'listed' })
    for (const status of ['draft', 'archived', 'publiee', null]) {
      expect(poolPublicationState(active, { publicationStatus: status }, sent)).toEqual({
        state: 'paused',
        pausedBecause: 'request_not_published',
      })
    }
    // Every closed status, and any value nobody knows.
    for (const status of [...FINANCING_STATUSES, 'financé', null]) {
      const listed = ['preparing', 'in_committee'].includes(status as string)
      expect(poolPublicationState(active, published, { ...sent, financingStatus: status })).toEqual(
        listed
          ? { state: 'listed', pausedBecause: null }
          : { state: 'paused', pausedBecause: 'financing_closed' },
      )
    }
    expect(poolPublicationState({ withdrawnAt: new Date() }, published, sent)).toEqual({
      state: 'withdrawn',
      pausedBecause: null,
    })
  })

  it('names what stands in the way of publishing, in order', () => {
    expect(poolPublicationBlocker(published, sent)).toBeNull()
    expect(
      poolPublicationBlocker({ publicationStatus: 'archived' }, { ...sent, submittedAt: null }),
    ).toBe('candidature_not_sent')
    expect(poolPublicationBlocker({ publicationStatus: 'archived' }, sent)).toBe('request_archived')
    expect(poolPublicationBlocker({ publicationStatus: 'draft' }, sent)).toBe(
      'request_not_published',
    )
    expect(poolPublicationBlocker(published, { ...sent, financingStatus: 'refused' })).toBe(
      'financing_closed',
    )
  })

  it('requires a chosen level and the consent stated', () => {
    expect(publishToPoolSchema.safeParse({ accessLevel: 'partiel', consent: true }).success).toBe(
      true,
    )
    for (const body of [
      { accessLevel: 'partiel' },
      { accessLevel: 'partiel', consent: false },
      { accessLevel: 'partiel', consent: 'true' },
      { consent: true },
      { accessLevel: 'tout', consent: true },
      { accessLevel: 'partiel', consent: true, workspaceId: 'x' },
    ]) {
      expect(publishToPoolSchema.safeParse(body).success).toBe(false)
    }
  })

  it('reads an unexpected stored level as public and an unexpected reason as none', () => {
    const row = {
      id: 'p',
      candidatureId: 'c',
      workspaceId: 'w',
      accessLevel: 'tout',
      consentedAt: new Date(),
      consentedById: null,
      withdrawnAt: new Date(),
      withdrawnById: null,
      withdrawalReason: 'oubli',
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies PoolPublication
    expect(poolPublicationView(row, published, sent)).toMatchObject({
      accessLevel: 'public',
      state: 'withdrawn',
      withdrawnBecause: null,
    })
    expect(poolPublicationView(null, published, sent)).toBeNull()
  })
})
