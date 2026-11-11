import { SUPPORTED_SCOPES, grantableScopes } from './oauth.constants'

// What an account may grant an application, whatever the client asks (E04.06, E05.10).
describe('grantableScopes', () => {
  const all = SUPPORTED_SCOPES

  it('gives an entrepreneur everything but the form permissions', () => {
    expect(grantableScopes(all, { role: 'entrepreneur' })).toEqual([
      'dossiers:read',
      'dossiers:write',
      'dossiers:submit',
      'dossiers:present',
    ])
  })

  it('gives the form permissions to an administrator, or to whoever manages a workspace', () => {
    expect(grantableScopes(all, { role: 'admin' })).toEqual(all)
    expect(grantableScopes(all, { role: 'financeur' }, { managesWorkspace: true })).toEqual([
      'dossiers:read',
      'dossiers:write',
      'dossiers:submit',
      'forms:write',
      'forms:publish',
    ])
  })

  it('never gives presenting requests or designing forms to an account that may do neither', () => {
    for (const role of ['financeur', 'unknown']) {
      expect(grantableScopes(all, { role })).toEqual([
        'dossiers:read',
        'dossiers:write',
        'dossiers:submit',
      ])
    }
  })
})
