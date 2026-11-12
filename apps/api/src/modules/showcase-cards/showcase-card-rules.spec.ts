import {
  COMMITTEE_APPLICATION_STATUSES,
  FINANCING_STATUSES,
  SHOWCASE_REGIONS,
  pseudonymRevealsName,
  setShowcaseCardSchema,
  showcaseCardState,
  showcaseCommitteeOf,
} from '@confluent/shared'

// ROADMAP E09.02: THE rules of the public cards, as @confluent/shared describes them once for the API
// and the site — closed by default.
describe('showcase card rules', () => {
  const sent = { submittedAt: new Date(), financingStatus: 'preparing' }
  const published = { publicationStatus: 'published' }
  const page = { publicPagePublished: true }
  const active = { withdrawnAt: null, pseudonym: 'Projet Héron' }

  it('shows a card only while consented under a pseudonym, the page published, the candidature sent, the request published and its follow-up open', () => {
    expect(showcaseCardState(active, published, sent, page)).toEqual({
      state: 'shown',
      pausedBecause: null,
    })
    expect(showcaseCardState(active, published, sent, { publicPagePublished: false })).toEqual({
      state: 'paused',
      pausedBecause: 'page_not_published',
    })
    for (const status of ['draft', 'archived', 'publiee', null]) {
      expect(showcaseCardState(active, { publicationStatus: status }, sent, page)).toEqual({
        state: 'paused',
        pausedBecause: 'request_not_published',
      })
    }
    for (const status of [...FINANCING_STATUSES, 'financé', null]) {
      const shown = ['preparing', 'in_committee'].includes(status as string)
      expect([
        status,
        showcaseCardState(active, published, { ...sent, financingStatus: status }, page),
      ]).toEqual([
        status,
        shown
          ? { state: 'shown', pausedBecause: null }
          : { state: 'paused', pausedBecause: 'financing_closed' },
      ])
    }
    expect(
      showcaseCardState(active, published, { ...sent, submittedAt: null }, page),
    ).toMatchObject({ state: 'paused' })
    // Withdrawn, or without a pseudonym: nothing to show, whatever else holds.
    for (const card of [
      { withdrawnAt: new Date(), pseudonym: 'Projet Héron' },
      { withdrawnAt: null, pseudonym: '' },
      { withdrawnAt: null, pseudonym: '   ' },
      { withdrawnAt: null, pseudonym: null },
    ]) {
      expect(showcaseCardState(card, published, sent, page)).toEqual({
        state: 'withdrawn',
        pausedBecause: null,
      })
    }
  })

  it('names the soonest planned session that retained the request, and nothing for any other entry', () => {
    const now = Date.parse('2099-01-01T00:00:00Z')
    const session = (id: string, startsAt: string, status = 'planned') => ({ id, startsAt, status })
    const june = session('june', '2099-06-10T12:00:00Z')
    const march = session('march', '2099-03-10T12:00:00Z')
    expect(
      showcaseCommitteeOf(
        [
          { status: 'accepted', committee: june },
          { status: 'accepted', committee: march },
        ],
        now,
      ),
    ).toBe(march)
    // A pending application or proposal, a refusal, a withdrawal or an unknown status: none, as for
    // no entry at all — a refusal is never told apart.
    for (const status of [...COMMITTEE_APPLICATION_STATUSES.filter((s) => s !== 'accepted'), 'x']) {
      expect([status, showcaseCommitteeOf([{ status, committee: june }], now)]).toEqual([
        status,
        null,
      ])
    }
    expect(showcaseCommitteeOf([], now)).toBeNull()
    // Retained, but held, cancelled, unknown or already started: none.
    for (const committee of [
      session('held', '2099-06-10T12:00:00Z', 'held'),
      session('cancelled', '2099-06-10T12:00:00Z', 'cancelled'),
      session('unknown', '2099-06-10T12:00:00Z', 'reporté'),
      session('started', '2098-12-31T23:00:00Z'),
    ]) {
      expect([committee.id, showcaseCommitteeOf([{ status: 'accepted', committee }], now)]).toEqual(
        [committee.id, null],
      )
    }
  })

  it('takes a pseudonym of one plain line, bounded in characters, without address, link or markup', () => {
    const consent = (pseudonym: unknown, region: unknown = null) =>
      setShowcaseCardSchema.safeParse({ pseudonym, region, consent: true, version: null })
    expect(consent('  Projet   Héron\n').data?.pseudonym).toBe('Projet Héron')
    expect(consent('A\u0000B').data?.pseudonym).toBe('A B')
    for (const ok of ['Héron', '🦩🦩', 'x'.repeat(60), 'Projet n° 42 — eau']) {
      expect([ok, consent(ok).success]).toEqual([ok, true])
    }
    for (const bad of [
      undefined,
      '',
      '   ',
      'H',
      '🦩',
      'x'.repeat(61),
      '🦩'.repeat(61),
      'Projet <b>gras</b>',
      'contact@biosensio.fr',
      'https://biosensio.fr',
      'www.biosensio.fr',
      42,
    ]) {
      expect([bad, consent(bad).success]).toEqual([bad, false])
    }
    for (const region of SHOWCASE_REGIONS) expect(consent('Héron', region).success).toBe(true)
    for (const region of ['Touraine', 'indre-et-loire', '']) {
      expect([region, consent('Héron', region).success]).toEqual([region, false])
    }
    // The consent itself and the version read are required; nothing else is accepted.
    for (const body of [
      { pseudonym: 'Héron', consent: true, version: null },
      { pseudonym: 'Héron', region: null, version: null },
      { pseudonym: 'Héron', region: null, consent: false, version: null },
      { pseudonym: 'Héron', region: null, consent: true },
      { pseudonym: 'Héron', region: null, consent: true, version: 0 },
      { pseudonym: 'Héron', region: null, consent: true, version: null, sector: 'Eau' },
    ]) {
      expect(setShowcaseCardSchema.safeParse(body).success).toBe(false)
    }
  })

  it('refuses a pseudonym equal to a real name, compared as a whole', () => {
    const names = ['Biosensio SAS', 'Capteurs d’eau', null]
    for (const p of ['biosensio sas', 'BIOSENSIO-SAS', 'Biosensio  S.A.S', 'Capteurs d eau']) {
      expect([p, pseudonymRevealsName(p, names)]).toEqual([p, true])
    }
    // Whole values only (R64): a pseudonym containing a name, or contained in one, is the owner's
    // choice.
    for (const p of ['Biosensio', 'Projet Biosensio SAS', 'Capteurs']) {
      expect([p, pseudonymRevealsName(p, names)]).toEqual([p, false])
    }
  })
})
