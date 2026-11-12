import type { NextFunction, Request, Response } from 'express'
import {
  DEFAULT_PUBLIC_PAGE_BLOCKS,
  ROBOTS_CLOSED,
  ROBOTS_OPEN,
  publicPageRobots,
  publicWorkspacePageSchema,
  toPublicWorkspacePage,
  updateWorkspacePageSchema,
  workspacePageSettingsSchema,
  type PublicPageContent,
} from '@confluent/shared'
import { noIndex } from '../../common/http/no-index'

const CONTENT: PublicPageContent = {
  workspace: {
    slug: 'cci-touraine',
    name: 'CCI Touraine',
    programName: null,
    color: null,
    presentation: 'La CCI accompagne les entreprises.',
    criteria: null,
    contact: null,
    logoVersion: null,
  },
  committees: [],
  receivesCandidatures: false,
  cards: [],
}

// ROADMAP E09.06: what a page tells search engines — closed unless its managers allowed indexing.
describe('public page indexing', () => {
  it('opens a page to search engines only when it says `indexable: true`', () => {
    expect([ROBOTS_CLOSED, ROBOTS_OPEN]).toEqual(['noindex, nofollow', 'index, follow'])
    expect(publicPageRobots({ indexable: true })).toBe(ROBOTS_OPEN)
    // Still loading, missing, refused, or answered by an API that does not know the field: closed.
    for (const page of [
      undefined,
      null,
      {},
      { indexable: false },
      { indexable: 'true' },
      { indexable: 1 },
      { indexable: [true] },
      { indexable: { value: true } },
      'indexable',
      true,
    ]) {
      expect([page, publicPageRobots(page)]).toEqual([page, ROBOTS_CLOSED])
    }
  })

  it('carries the managers’ choice in the projection, read closed (no by default)', () => {
    const open = toPublicWorkspacePage(CONTENT, DEFAULT_PUBLIC_PAGE_BLOCKS, true)
    expect(publicWorkspacePageSchema.parse(open)).toEqual(open)
    expect([open.indexable, publicPageRobots(open)]).toEqual([true, ROBOTS_OPEN])
    for (const choice of [undefined, false, null, 'true', 1]) {
      const page = toPublicWorkspacePage(CONTENT, DEFAULT_PUBLIC_PAGE_BLOCKS, choice)
      expect([choice, page.indexable, publicPageRobots(page)]).toEqual([
        choice,
        false,
        ROBOTS_CLOSED,
      ])
    }
    // The choice changes nothing else of the page.
    expect({ ...open, indexable: false }).toEqual(
      toPublicWorkspacePage(CONTENT, DEFAULT_PUBLIC_PAGE_BLOCKS),
    )
  })

  it('lets the managers send the choice or leave it out (kept as it is), a boolean only', () => {
    const base = { published: true, criteria: null, contact: null, version: 1 }
    expect(updateWorkspacePageSchema.parse({ ...base, indexable: true }).indexable).toBe(true)
    expect(updateWorkspacePageSchema.parse(base).indexable).toBeUndefined()
    for (const indexable of ['true', 1, null, 'oui']) {
      expect(updateWorkspacePageSchema.safeParse({ ...base, indexable }).success).toBe(false)
    }
    // The settings always say it.
    expect(workspacePageSettingsSchema.shape.indexable.safeParse(undefined).success).toBe(false)
  })

  it('marks every answer of the API `noindex, nofollow`, before anything runs', () => {
    const headers = new Map<string, string>()
    const res = { setHeader: (k: string, v: string) => headers.set(k, v) } as unknown as Response
    const next = jest.fn() as NextFunction
    noIndex({} as Request, res, next)
    expect([...headers]).toEqual([['X-Robots-Tag', 'noindex, nofollow']])
    expect(next).toHaveBeenCalledTimes(1)
  })
})
