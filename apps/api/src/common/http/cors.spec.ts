import { Controller, Get, Header, HttpCode, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types'
import { corsOptions } from './cors'

@Controller()
class BusyController {
  @Get('busy')
  @HttpCode(503)
  @Header('Retry-After', '2')
  busy() {
    return {}
  }
}

describe('corsOptions', () => {
  let app: INestApplication<App>
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [BusyController] }).compile()
    app = moduleRef.createNestApplication()
    app.enableCors(corsOptions('http://web.test'))
    await app.init()
  })
  afterAll(() => app.close())

  it('lets the web app read Retry-After, for its own origin only', async () => {
    const res = await request(app.getHttpServer()).get('/busy').set('Origin', 'http://web.test')
    expect(res.status).toBe(503)
    expect(res.headers['access-control-allow-origin']).toBe('http://web.test')
    expect(res.headers['access-control-expose-headers']).toBe('Retry-After')
  })
})
