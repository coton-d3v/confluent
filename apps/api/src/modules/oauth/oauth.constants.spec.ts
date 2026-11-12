import { SUPPORTED_SCOPES, expandScopes, grantableScopes } from './oauth.constants'

const OPPORTUNITIES = ['opportunities:read', 'opportunities:write']
const SHARING = ['sharing:read', 'sharing:write']

// What an account may grant an application, whatever the client asks (E04.06, E05.10, E06.09,
// E07.10).
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
    ])
  })

  it('gives the form permissions to an administrator, or to whoever manages a workspace', () => {
    expect(grantableScopes(all, { role: 'admin' })).toEqual(
      all.filter((s) => s !== 'candidatures:support'),
    )
    expect(grantableScopes(all, { role: 'financeur' }, { managesWorkspace: true })).toEqual([
      'dossiers:read',
      'dossiers:write',
      'dossiers:submit',
      'forms:write',
      'forms:publish',
      ...OPPORTUNITIES,
    ])
  })

  it('gives following and deciding on received candidatures to whoever reviews them in a workspace', () => {
    expect(
      grantableScopes(
        all,
        { role: 'financeur' },
        { managesWorkspace: false, reviewsCandidatures: true },
      ),
    ).toEqual([
      'dossiers:read',
      'dossiers:write',
      'dossiers:submit',
      'candidatures:support',
      'candidatures:decide',
      ...OPPORTUNITIES,
    ])
    expect(
      grantableScopes(
        all,
        { role: 'admin' },
        { managesWorkspace: true, reviewsCandidatures: true },
      ),
    ).toEqual(all)
  })

  it('never gives presenting, sharing, following, deciding or designing to an account that may do none', () => {
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
