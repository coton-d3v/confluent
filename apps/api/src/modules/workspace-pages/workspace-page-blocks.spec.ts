import {
  DEFAULT_PUBLIC_PAGE_BLOCKS,
  PUBLIC_PAGE_BLOCKS,
  PUBLIC_WORKSPACE_FIELDS,
  publicPageBlocksSchema,
  publicWorkspacePageSchema,
  readPublicPageBlocks,
  toPublicWorkspacePage,
  updateWorkspacePageSchema,
  type PublicPageBlock,
  type PublicPageContent,
} from '@confluent/shared'

// Everything the blocks may show, each value marked with the block it belongs to.
const CONTENT: PublicPageContent = {
  workspace: {
    slug: 'cci-touraine',
    name: 'CCI Touraine',
    programName: 'MoneyPlace',
    color: '#1d4ed8',
    presentation: 'BLOC-PRESENTATION',
    criteria: 'BLOC-CRITERES',
    contact: 'BLOC-CONTACT',
    logoVersion: '0123456789abcdef',
  },
  committees: [
    {
      id: '6f1c2a8e-0000-4000-8000-00000000c0c0',
      name: 'BLOC-COMITES juin',
      date: '2099-06-10',
      time: '14:00',
      timeZone: 'Europe/Paris',
      startsAt: '2099-06-10T12:00:00.000Z',
    },
  ],
  receivesCandidatures: true,
  cards: [
    {
      pseudonym: 'BLOC-CARTES Héron',
      sector: null,
      region: null,
      amountEur: null,
      fundingPlan: { obtainedEur: 0, requestedEur: 0, remainingEur: null },
      committee: { state: 'awaiting' },
    },
  ],
}

// What each block alone shows of the content (the header's identity is always there).
const MARKERS: Record<PublicPageBlock, RegExp> = {
  presentation: /BLOC-PRESENTATION/,
  criteria: /BLOC-CRITERES/,
  contact: /BLOC-CONTACT/,
  committees: /BLOC-COMITES/,
  cards: /BLOC-CARTES/,
  apply: /"receivesCandidatures":true/,
  participate: /"receivesParticipationRequests":true/,
}

const blocksIssue = (blocks: unknown) => {
  const parsed = publicPageBlocksSchema.safeParse(blocks)
  return parsed.success ? null : parsed.error.issues.map((i) => [i.path, i.message])
}

// ROADMAP E09.04: the blocks of a workspace's public page — a closed catalogue, each shown at most
// once in the managers' order — and THE projection of the page through them, shared by the public
// route, the managers' preview and the site's live preview.
describe('public page blocks', () => {
  it('starts from E09.01’s page: every block of the catalogue, in its order', () => {
    expect([...DEFAULT_PUBLIC_PAGE_BLOCKS]).toEqual([
      'presentation',
      'criteria',
      'committees',
      'cards',
      'apply',
      'participate',
      'contact',
    ])
    expect(new Set(PUBLIC_PAGE_BLOCKS).size).toBe(PUBLIC_PAGE_BLOCKS.length)
  })

  it('accepts the blocks shown in any order, each at most once, none at all included', () => {
    for (const blocks of [
      [...PUBLIC_PAGE_BLOCKS],
      [...PUBLIC_PAGE_BLOCKS].reverse(),
      ['contact', 'cards'],
      [],
    ]) {
      expect(publicPageBlocksSchema.parse(blocks)).toEqual(blocks)
    }
  })

  it('refuses an unknown block, a block twice, more blocks than the catalogue, or anything but a list of names', () => {
    expect(blocksIssue(['presentation', 'texte-libre'])).toEqual([[[1], 'Ce bloc n’existe pas.']])
    expect(blocksIssue(['Contact'])).toEqual([[[0], 'Ce bloc n’existe pas.']])
    expect(blocksIssue(['contact', 'cards', 'contact'])).toEqual([
      [[2], 'Chaque bloc figure au plus une fois.'],
    ])
    expect(blocksIssue([...PUBLIC_PAGE_BLOCKS, 'contact'])).toEqual(
      expect.arrayContaining([[[], `La page compte au plus ${PUBLIC_PAGE_BLOCKS.length} blocs.`]]),
    )
    for (const blocks of [null, 'contact', { 0: 'contact' }, [1], [null], [['contact']]]) {
      expect([blocks, blocksIssue(blocks)]).toEqual([blocks, expect.any(Array)])
    }
  })

  it('keeps the blocks as they are when the settings do not name them', () => {
    const page = { published: true, criteria: null, contact: null, version: 1 }
    expect(updateWorkspacePageSchema.parse(page)).toEqual(page)
    expect(updateWorkspacePageSchema.parse({ ...page, blocks: ['cards'] }).blocks).toEqual([
      'cards',
    ])
    expect(
      updateWorkspacePageSchema.safeParse({ ...page, blocks: ['cards', 'cards'] }).success,
    ).toBe(false)
  })

  it('reads the stored blocks closed: unknown values ignored, a block twice at its first place, anything but a list shows nothing', () => {
    expect(readPublicPageBlocks(['contact', 'texte-libre', 'cards', 'contact', 'Cards'])).toEqual([
      'contact',
      'cards',
    ])
    expect(readPublicPageBlocks([...PUBLIC_PAGE_BLOCKS])).toEqual([...PUBLIC_PAGE_BLOCKS])
    for (const stored of [null, undefined, 'contact', { contact: true }, 7]) {
      expect(readPublicPageBlocks(stored)).toEqual([])
    }
  })

  it('shows every block of the default page, in its order, with all its content', () => {
    const page = toPublicWorkspacePage(CONTENT, DEFAULT_PUBLIC_PAGE_BLOCKS)
    expect(publicWorkspacePageSchema.parse(page)).toEqual(page)
    expect(page).toEqual({
      workspace: CONTENT.workspace,
      blocks: [...DEFAULT_PUBLIC_PAGE_BLOCKS],
      committees: CONTENT.committees,
      receivesCandidatures: true,
      receivesParticipationRequests: true,
      cards: CONTENT.cards,
    })
  })

  it('shows the blocks in the managers’ order, and sends nothing of a block not shown', () => {
    const blocks: PublicPageBlock[] = ['contact', 'cards', 'presentation']
    const page = toPublicWorkspacePage(CONTENT, blocks)
    expect(page.blocks).toEqual(blocks)
    const json = JSON.stringify(page)
    for (const block of PUBLIC_PAGE_BLOCKS) {
      expect([block, MARKERS[block].test(json)]).toEqual([block, blocks.includes(block)])
    }
    expect(page).toMatchObject({
      workspace: { criteria: null, presentation: 'BLOC-PRESENTATION' },
      committees: [],
      receivesCandidatures: false,
      receivesParticipationRequests: false,
    })
  })

  it('shows each block alone with its content only, and none with an empty choice', () => {
    for (const block of PUBLIC_PAGE_BLOCKS) {
      const page = toPublicWorkspacePage(CONTENT, [block])
      const json = JSON.stringify(page)
      expect([block, page.blocks]).toEqual([block, [block]])
      for (const other of PUBLIC_PAGE_BLOCKS) {
        expect([block, other, MARKERS[other].test(json)]).toEqual([block, other, other === block])
      }
      // The header's identity, always.
      expect(page.workspace).toMatchObject({ slug: 'cci-touraine', name: 'CCI Touraine' })
    }
    const none = toPublicWorkspacePage(CONTENT, [])
    expect(none.blocks).toEqual([])
    expect(JSON.stringify(none)).not.toMatch(/BLOC-|true/)
  })

  it('calls to take part without listing the sessions when only that block is shown', () => {
    const page = toPublicWorkspacePage(CONTENT, ['participate'])
    expect(page).toMatchObject({ committees: [], receivesParticipationRequests: true })
    expect(JSON.stringify(page)).not.toContain(CONTENT.committees[0].id)
  })

  it('lists only the blocks shown that have something to show', () => {
    const empty: PublicPageContent = {
      workspace: { ...CONTENT.workspace, presentation: null, criteria: null, contact: null },
      committees: [],
      receivesCandidatures: false,
      cards: [],
    }
    expect(toPublicWorkspacePage(empty, DEFAULT_PUBLIC_PAGE_BLOCKS).blocks).toEqual([])
    expect(
      toPublicWorkspacePage(
        { ...empty, workspace: { ...empty.workspace, contact: 'Écrivez-nous.' } },
        DEFAULT_PUBLIC_PAGE_BLOCKS,
      ).blocks,
    ).toEqual(['contact'])
  })

  it('ignores unknown blocks, and copies the workspace field by field', () => {
    const page = toPublicWorkspacePage(
      {
        ...CONTENT,
        // A field the content should never hold: the projection does not carry it.
        workspace: { ...CONTENT.workspace, contactEmail: 'membres-prive@cci.fr' } as never,
      },
      ['texte-libre', 'contact', 'contact'],
    )
    expect(page.blocks).toEqual(['contact'])
    expect(Object.keys(page.workspace)).toEqual([...PUBLIC_WORKSPACE_FIELDS])
    expect(JSON.stringify(page)).not.toContain('membres-prive')
    // The content is left as it was.
    expect(CONTENT.workspace.presentation).toBe('BLOC-PRESENTATION')
  })
})
