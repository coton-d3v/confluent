import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

async function buildController(overrides: {
  requestMagicLink?: jest.Mock
  verifyMagicLink?: jest.Mock
  refreshSession?: jest.Mock
  revokeSession?: jest.Mock
}) {
  const configValues: Record<string, string> = { NODE_ENV: 'test' }
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      {
        provide: AuthService,
        useValue: {
          requestMagicLink: overrides.requestMagicLink ?? jest.fn().mockResolvedValue(undefined),
          verifyMagicLink: overrides.verifyMagicLink,
          refreshSession: overrides.refreshSession,
          revokeSession: overrides.revokeSession ?? jest.fn().mockResolvedValue(undefined),
        },
      },
      { provide: ConfigService, useValue: { get: (k: string) => configValues[k] } },
    ],
  }).compile()
  return moduleRef.get(AuthController)
}

describe('AuthController', () => {
  it('delegates magic-link requests and returns the fixed shape', async () => {
    const spy = jest.fn().mockResolvedValue(undefined)
    const controller = await buildController({ requestMagicLink: spy })

    const body = { email: 'sophie@biosensio.fr' } as unknown as Parameters<
      AuthController['requestMagicLink']
    >[0]
    const result = await controller.requestMagicLink(body)
    expect(spy).toHaveBeenCalledWith('sophie@biosensio.fr')
    expect(result).toEqual({ message: 'Magic link sent.' })
  })

  it('sets the refresh cookie and returns accessToken + user on verify', async () => {
    const verify = jest.fn().mockResolvedValue({
      accessToken: 'access.token',
      refreshToken: 'refresh.token',
      user: { id: 'u1', email: 'sophie@biosensio.fr', role: 'entrepreneur' },
    })
    const controller = await buildController({ verifyMagicLink: verify })
    const res = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as import('express').Response

    const result = await controller.verifyMagicLink(
      { token: '00000000-0000-0000-0000-000000000000' } as unknown as Parameters<
        AuthController['verifyMagicLink']
      >[0],
      res,
    )
    expect(verify).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000000')
    expect(res.cookie).toHaveBeenCalledWith(
      'confluent_refresh',
      'refresh.token',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/' }),
    )
    expect(result).toEqual({
      accessToken: 'access.token',
      user: { id: 'u1', email: 'sophie@biosensio.fr', role: 'entrepreneur' },
    })
  })

  it('revokes the server-side session and clears the refresh cookie on logout', async () => {
    const revokeSession = jest.fn().mockResolvedValue(undefined)
    const controller = await buildController({ revokeSession })
    const req = {
      cookies: { confluent_refresh: 'refresh.token' },
    } as unknown as import('express').Request
    const res = {
      clearCookie: jest.fn(),
      cookie: jest.fn(),
    } as unknown as import('express').Response
    const result = await controller.logout(req, res)
    expect(revokeSession).toHaveBeenCalledWith('refresh.token')
    expect(res.clearCookie).toHaveBeenCalledWith('confluent_refresh', { path: '/' })
    expect(result).toEqual({ message: 'Logged out.' })
  })
})
