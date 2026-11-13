import { expect, test, type Page, type Route } from '@playwright/test'

// ROADMAP E10.10, review R77: a deletion decision the server refuses because the request changed
// (`409`, `404`) closes its confirmation — it can never be sent again from that stale context —, the
// queue is read again, and a new decision is possible only once that reading succeeded and the
// current request allows it. The API is answered by the browser itself (no sign-in: the smoke suite's
// rate budget is untouched), at 1280 and 375 px.

const REQUEST = {
  id: '0b4f6a8e-0000-4000-8000-0000000077aa',
  status: 'pending',
  subjectRef: 'compte-supprime-0b4f6a8e',
  account: {
    id: 'u-owner',
    email: 'porteur@mock.test',
    name: 'Paul Porteur',
    role: 'entrepreneur',
    createdAt: '2026-11-01T10:00:00.000Z',
  },
  requestedAt: '2026-11-12T10:00:00.000Z',
  decidedAt: null,
  declineNote: null,
  summary: null,
  confirmationEmail: null,
  impact: {
    companies: 1,
    requests: 1,
    documents: 0,
    closedCandidatures: 0,
    investorPositions: 0,
    memberships: 0,
    connectedApplications: 0,
    sharesReceived: 0,
    blockers: [] as Array<{ kind: string; subject: string | null; href: string | null }>,
  },
}
const BLOCKER = { kind: 'open_share', subject: 'Demande partagée', href: null }

type Scenario = { lists: Array<'ok' | 'blocked' | 'down'>; decisions: number }

async function mockApi(page: Page, scenario: Scenario) {
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route(
    (url) => url.pathname.startsWith('/v1/'),
    async (route) => {
      const url = new URL(route.request().url())
      const method = route.request().method()
      if (url.pathname === '/v1/auth/refresh') {
        return json(route, 200, {
          accessToken: 'mock-access-token',
          user: { id: 'u-admin', email: 'admin@mock.test', role: 'admin', firstName: 'Ada', lastName: 'Admin' },
        })
      }
      if (url.pathname === '/v1/notifications/unread-count') return json(route, 200, { unreadCount: 0 })
      if (url.pathname === '/v1/admin/deletion-requests' && method === 'GET') {
        const next = scenario.lists.shift() ?? 'ok'
        if (next === 'down') {
          return json(route, 503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } })
        }
        const blockers = next === 'blocked' ? [BLOCKER] : []
        return json(route, 200, [{ ...REQUEST, impact: { ...REQUEST.impact, blockers } }])
      }
      if (url.pathname.startsWith('/v1/admin/deletion-requests/') && method === 'POST') {
        scenario.decisions++
        return json(route, 409, {
          error: { code: 'CONFLICT', message: 'Ce compte ne peut pas encore être supprimé.', details: [BLOCKER] },
        })
      }
      return json(route, 200, [])
    },
  )
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 375, height: 740 },
]) {
  test.describe(`file des suppressions à ${viewport.width} px (R77)`, () => {
    test.use({ viewport })

    test('après un refus 409, la relecture en échec ne renvoie jamais la décision', async ({ page }) => {
      const scenario: Scenario = { lists: ['ok', 'down', 'blocked'], decisions: 0 }
      await mockApi(page, scenario)
      await page.goto('/admin/utilisateurs/suppressions')
      const row = page.getByRole('listitem').filter({ hasText: 'porteur@mock.test' })
      await row.getByRole('button', { name: 'Supprimer le compte' }).click()
      const dialog = page.getByRole('alertdialog')
      await dialog.getByRole('button', { name: 'Oui, supprimer le compte' }).click()

      // The stale confirmation is gone: nothing left to send the deletion again from.
      await expect(dialog).toHaveCount(0)
      const conflict = page.getByRole('alert').filter({ hasText: 'n’a pas été appliquée' })
      await expect(conflict).toBeVisible()
      // The reading failed: never said to be done, retried as a reading only.
      const failedRead = page.getByRole('alert').filter({ hasText: 'n’ont pas pu être chargées' })
      await expect(failedRead).toBeVisible()
      await expect(conflict).not.toContainText('relue')
      await expect(page.getByRole('button', { name: /supprimer le compte/i })).toHaveCount(0)
      await failedRead.getByRole('button', { name: 'Réessayer' }).click()

      // Read again with its blocker: no decision possible, and only now said to be read again.
      await expect(conflict).toContainText('La liste a été relue')
      await expect(row.getByRole('button', { name: 'Supprimer le compte' })).toBeDisabled()
      await expect(row).toContainText('Bloquée tant que')
      expect(scenario.decisions).toBe(1)
    })

    test('après un refus 409, la relecture réussie avec un bloquant empêche la décision', async ({ page }) => {
      const scenario: Scenario = { lists: ['ok', 'blocked'], decisions: 0 }
      await mockApi(page, scenario)
      await page.goto('/admin/utilisateurs/suppressions')
      const row = page.getByRole('listitem').filter({ hasText: 'porteur@mock.test' })
      await row.getByRole('button', { name: 'Supprimer le compte' }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Oui, supprimer le compte' }).click()
      await expect(page.getByRole('alertdialog')).toHaveCount(0)
      await expect(page.getByRole('alert').filter({ hasText: 'La liste a été relue' })).toBeVisible()
      await expect(row.getByRole('button', { name: 'Supprimer le compte' })).toBeDisabled()

      // The same for a refusal: its stale confirmation closes, nothing is sent twice.
      await row.getByRole('button', { name: 'Refuser' }).click()
      const dialog = page.getByRole('alertdialog')
      await dialog.getByLabel('Note à la personne').fill('Retirez d’abord le partage.')
      await dialog.getByRole('button', { name: 'Refuser la demande' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.getByRole('alert').filter({ hasText: 'La liste a été relue' })).toBeVisible()
      expect(scenario.decisions).toBe(2)
    })
  })
}
