import { SUPPORTED_SCOPES, grantableScopes } from './oauth.constants'

// What an account may grant an application, whatever the client asks (E04.06, E05.10, E06.09).
describe('grantableScopes', () => {
  const all = SUPPORTED_SCOPES

  it('gives an entrepreneur everything but the form permissions and following received candidatures', () => {
    expect(grantableScopes(all, { role: 'entrepreneur' })).toEqual([
      'dossiers:read',
      'dossiers:write',
      'dossiers:submit',
      'dossiers:present',
      'candidatures:decide',
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
    ])
    expect(
      grantableScopes(
        all,
        { role: 'admin' },
        { managesWorkspace: true, reviewsCandidatures: true },
      ),
    ).toEqual(all)
  })

  it('never gives presenting, following, deciding or designing to an account that may do none', () => {
    for (const role of ['financeur', 'unknown']) {
      expect(grantableScopes(all, { role })).toEqual([
        'dossiers:read',
        'dossiers:write',
        'dossiers:submit',
      ])
    }
  })
})
