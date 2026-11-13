import { SUPPORTED_SCOPES, clientOrigin, expandScopes, grantableScopes } from './oauth.constants'

const OPPORTUNITIES = ['opportunities:read', 'opportunities:write']
const SHARING = ['sharing:read', 'sharing:write']
const COMMITTEES = ['committees:read', 'committees:write']
const PUBLIC_PAGE = [
  'public-page:read',
  'public-page:write',
  'public-page:publish',
  'access-requests:decide',
]
const SHOWCASE = ['showcase:read', 'showcase:write']

// What an account may grant an application, whatever the client asks (E04.06, E05.10, E06.09,
// E07.10, E08.07, E09.07).
describe('grantableScopes', () => {
  const all = SUPPORTED_SCOPES

  it('gives an entrepreneur everything but the form permissions and following received candidatures', () => {
    expect(grantableScopes(all, { role: 'entrepreneur' })).toEqual([
      'dossiers:read',
      'dossiers:write',
      'dossiers:submit',
      'dossiers:present',
      'candidatures:decide',
      ...OPPORTUNITIES,
      ...SHARING,
      ...COMMITTEES,
      ...SHOWCASE,
    ])
  })

  it('gives the form permissions to an administrator, or to whoever manages a workspace', () => {
    // Deciding participation requests, a public page: managers only (an administrator member of
    // no workspace manages none).
    expect(grantableScopes(all, { role: 'admin' })).toEqual(
      all.filter(
        (s) =>
          s !== 'candidatures:support' &&
          s !== 'participation-requests:decide' &&
          !PUBLIC_PAGE.includes(s),
      ),
    )
    expect(
      grantableScopes(
        all,
        { role: 'financeur' },
        { managesWorkspace: true, memberOfWorkspace: true },
      ),
    ).toEqual([
      'dossiers:read',
      'dossiers:write',
      'dossiers:submit',
      'forms:write',
      'forms:publish',
      ...OPPORTUNITIES,
      'committees:read',
      'participation-requests:decide',
      ...PUBLIC_PAGE,
    ])
  })

  it('gives following and deciding on received candidatures to whoever reviews them in a workspace', () => {
    expect(
      grantableScopes(
        all,
        { role: 'financeur' },
        { managesWorkspace: false, reviewsCandidatures: true, memberOfWorkspace: true },
      ),
    ).toEqual([
      'dossiers:read',
      'dossiers:write',
      'dossiers:submit',
      'candidatures:support',
      'candidatures:decide',
      ...OPPORTUNITIES,
      ...COMMITTEES,
    ])
    expect(
      grantableScopes(
        all,
        { role: 'admin' },
        { managesWorkspace: true, reviewsCandidatures: true, memberOfWorkspace: true },
      ),
    ).toEqual(all)
  })

  // E08.07: reading committees needs something to read — one's candidatures' committees (whoever
  // may own companies) or a workspace's (a member: its conseillers, or a participant's sessions).
  it('gives reading committees to whoever may own companies or is a member of a workspace', () => {
    expect(
      grantableScopes(
        all,
        { role: 'financeur' },
        { managesWorkspace: false, memberOfWorkspace: true },
      ),
    ).toEqual([
      'dossiers:read',
      'dossiers:write',
      'dossiers:submit',
      ...OPPORTUNITIES,
      'committees:read',
    ])
  })

  // E09.07: a workspace's public page to its managers only; a request's cards to whoever may own one.
  it('gives the public page to managers only and the cards to whoever may own companies', () => {
    for (const context of [
      { managesWorkspace: false, reviewsCandidatures: true, memberOfWorkspace: true },
      { managesWorkspace: false, memberOfWorkspace: true },
    ]) {
      const granted = grantableScopes(all, { role: 'financeur' }, context)
      expect(granted.filter((s) => PUBLIC_PAGE.includes(s) || SHOWCASE.includes(s))).toEqual([])
    }
    expect(
      grantableScopes(all, { role: 'financeur' }, { managesWorkspace: true }).filter((s) =>
        SHOWCASE.includes(s),
      ),
    ).toEqual([])
    expect(
      grantableScopes(all, { role: 'entrepreneur' }).filter((s) => PUBLIC_PAGE.includes(s)),
    ).toEqual([])
  })

  it('never gives presenting, sharing, following, deciding, designing or committees to an account that may do none', () => {
    for (const role of ['financeur', 'unknown']) {
      expect(grantableScopes(all, { role })).toEqual([
        'dossiers:read',
        'dossiers:write',
        'dossiers:submit',
        ...OPPORTUNITIES,
      ])
    }
  })
})

// E07.10: writing implies reading within each pair, never across them nor towards the dossiers.
describe('expandScopes', () => {
  it('reads with each write permission of its own pair only', () => {
    expect([...expandScopes(['opportunities:write'])].sort()).toEqual([
      'opportunities:read',
      'opportunities:write',
    ])
    expect([...expandScopes(['sharing:write'])].sort()).toEqual(['sharing:read', 'sharing:write'])
    expect([...expandScopes(['committees:write'])].sort()).toEqual([
      'committees:read',
      'committees:write',
    ])
    // Deciding participation requests reads nothing by itself.
    expect([...expandScopes(['participation-requests:decide'])]).toEqual([
      'participation-requests:decide',
    ])
    // E09.07: changing a page or a card reads it; publishing a page and deciding an access request
    // read nothing by themselves, and nothing crosses between the managers' and the owner's side.
    expect([...expandScopes(['public-page:write'])].sort()).toEqual([
      'public-page:read',
      'public-page:write',
    ])
    expect([...expandScopes(['showcase:write'])].sort()).toEqual([
      'showcase:read',
      'showcase:write',
    ])
    expect([...expandScopes(['public-page:publish'])]).toEqual(['public-page:publish'])
    expect([...expandScopes(['access-requests:decide'])]).toEqual(['access-requests:decide'])
    expect([...expandScopes(['dossiers:write'])].sort()).toEqual([
      'dossiers:read',
      'dossiers:write',
    ])
    expect([...expandScopes(['opportunities:read', 'sharing:read'])].sort()).toEqual([
      'opportunities:read',
      'sharing:read',
    ])
  })
})

// ROADMAP E10.10 (U05): what the consent screen says of a client's identity.
describe('clientOrigin', () => {
  it('is verified only for a fetched metadata document at an HTTPS identifier, naming its host', () => {
    expect(clientOrigin({ id: 'https://claude.ai/oauth/client.json', source: 'cimd' })).toEqual({
      origin: 'verified',
      originHost: 'claude.ai',
    })
    expect(clientOrigin({ id: 'https://claude.ai/oauth/client.json', source: 'dcr' })).toEqual({
      origin: 'declared',
      originHost: null,
    })
    expect(clientOrigin({ id: 'http://claude.ai/client.json', source: 'cimd' })).toEqual({
      origin: 'declared',
      originHost: null,
    })
    expect(clientOrigin({ id: 'not an address', source: 'cimd' }).origin).toBe('declared')
    expect(clientOrigin({ id: 'https://x.dev/c', source: 'unknown' }).origin).toBe('declared')
  })
})
