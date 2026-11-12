import { expect, test, type Page } from '@playwright/test'
import { FIXTURES, SMOKE } from './env'
import { signIn } from './session'

// ROADMAP E10.01: the critical public and sign-in routes, in a real browser, on the built web app
// and the compiled API with its migrated database. Not a full recipe: one pass through each route.

const ROBOTS_CLOSED = 'noindex, nofollow'

// Uncaught errors of the page fail the test that met them.
let pageErrors: string[] = []
test.beforeEach(({ page }) => {
  pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
})
test.afterEach(() => {
  expect(pageErrors, 'erreurs JavaScript non rattrapées').toEqual([])
})

const robots = (page: Page) =>
  page.locator('meta[name="robots"]').evaluateAll((metas) =>
    metas.map((meta) => (meta as HTMLMetaElement).content),
  )

test('l’API compilée répond, avec ses métadonnées OAuth', async ({ request }) => {
  const health = await request.get(`${SMOKE.api}/`)
  expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({ status: 'ok', service: 'confluent-api' })

  const oauth = await request.get(`${SMOKE.api}/.well-known/oauth-authorization-server`)
  expect(oauth.status()).toBe(200)
  expect(await oauth.json()).toHaveProperty('issuer')
})

test('page publique d’une structure, sans compte, fermée aux moteurs de recherche', async ({
  page,
}) => {
  await page.goto(`/w/${FIXTURES.slug}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(FIXTURES.structure)
  await expect(page.getByText('Entreprises de moins de cinq ans.')).toBeVisible()
  expect(await robots(page)).toEqual([ROBOTS_CLOSED])

  await page.goto('/w/structure-inconnue-smoke')
  await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible()
})

test('demande d’accès sans compte depuis la page publique', async ({ page }) => {
  await page.goto(`/w/${FIXTURES.slug}/candidater`)
  await page.getByLabel('Nom et prénom').fill('Camille Smoke')
  await page.getByLabel('Entreprise ou projet').fill('Projet Smoke')
  await page.getByLabel('Adresse email').fill(`camille+${Date.now()}@smoke.test`)
  await page.getByLabel('Message').fill('Demande envoyée par les tests de fumée de la CI.')
  await page.getByRole('button', { name: 'Envoyer ma demande' }).click()
  await expect(page.getByRole('heading', { name: 'Demande envoyée' })).toBeVisible()
})

test('connexion par lien reçu par email, session conservée, lien à usage unique', async ({
  browser,
  page,
}) => {
  const link = await signIn(page, FIXTURES.entrepreneur)
  await page.waitForURL(/\/dashboard/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/\/dashboard/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // The same link, opened again in another browser.
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await otherPage.goto(link)
  await expect(otherPage.getByRole('heading', { name: 'Lien invalide ou expiré' })).toBeVisible()
  await other.close()
})

test('connexion administrateur : tableau de bord du pipeline', async ({ page }) => {
  await signIn(page, FIXTURES.admin)
  await page.waitForURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible()
  await expect(page.getByText('Dossiers total')).toBeVisible()
})

test('lien de connexion invalide ou sans jeton', async ({ page }) => {
  await page.goto('/auth/verify?token=jeton-invalide-smoke')
  await expect(page.getByRole('heading', { name: 'Lien invalide ou expiré' })).toBeVisible()
  await page.goto('/auth/verify')
  await expect(page.getByRole('heading', { name: 'Lien invalide ou expiré' })).toBeVisible()
})

// ROADMAP E10.06: error screens, network recovery, no impersonation.
test('adresse inconnue : page 404, connecté ou non', async ({ page }) => {
  await page.goto('/page-inconnue-smoke')
  await expect(page.getByRole('heading', { level: 1, name: 'Page introuvable' })).toBeVisible()
  await expect(page.getByText('Erreur 404')).toBeVisible()
  await page.goto('/dashboard/inconnue-smoke/encore')
  await expect(page.getByRole('heading', { level: 1, name: 'Page introuvable' })).toBeVisible()
  await page.getByRole('link', { name: 'Retour à l’accueil' }).click()
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
})

test('page en erreur : écran d’erreur en français, sans détail technique', async ({ page }) => {
  // A page the API answers with something it cannot render.
  await page.route(`**/v1/public/workspaces/${FIXTURES.slug}`, (route) =>
    route.fulfill({ status: 200, json: {} }),
  )
  await page.goto(`/w/${FIXTURES.slug}`)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Cette page n’a pas pu s’afficher' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Recharger la page' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Retour à l’accueil' })).toBeVisible()
  await expect(page.getByText('Détails techniques')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('TypeError')
  await page.unroute(`**/v1/public/workspaces/${FIXTURES.slug}`)
  await page.getByRole('button', { name: 'Recharger la page' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(FIXTURES.structure)
})

test('aucune usurpation d’identité par l’adresse : ?as=admin reste sans session', async ({
  page,
}) => {
  await page.goto('/admin?as=admin')
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  await expect(page).toHaveURL(/\/auth$/)
  await page.goto('/dashboard?as=entrepreneur')
  await expect(page).toHaveURL(/\/auth$/)
})

test('serveur injoignable au démarrage : pas de déconnexion, reprise au clic', async ({ page }) => {
  await page.route('**/v1/auth/refresh', (route) => route.abort('internetdisconnected'))
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Confluent ne répond pas' })).toBeVisible()
  await expect(page).toHaveURL(/\/dashboard$/)
  // The server answers again: without a session, the sign-in page.
  await page.unroute('**/v1/auth/refresh')
  await page.getByRole('button', { name: 'Réessayer' }).click()
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
})

test('hors ligne : bandeau non bloquant, puis connexion rétablie', async ({ context, page }) => {
  await page.goto('/auth')
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  await context.setOffline(true)
  await expect(page.getByText('Vous êtes hors ligne')).toBeVisible()
  // Nothing on the page is covered: the form can still be filled in.
  await page.getByLabel('Adresse email').fill('hors-ligne@smoke.test')
  await context.setOffline(false)
  await expect(page.getByText('Connexion rétablie.')).toBeVisible()
  await expect(page.getByText('Vous êtes hors ligne')).toHaveCount(0)
})

test('en-têtes du serveur web : noindex partout sauf l’adresse d’une page publique', async ({
  request,
}) => {
  test.skip(!SMOKE.nginx, 'le serveur web n’est pas le nginx.conf du dépôt')
  const home = await request.get('/dashboard')
  expect(home.headers()['x-robots-tag']).toBe(ROBOTS_CLOSED)
  expect(await home.text()).toContain(`<meta name="robots" content="${ROBOTS_CLOSED}" />`)

  const publicPage = await request.get(`/w/${FIXTURES.slug}`)
  expect(publicPage.status()).toBe(200)
  expect(publicPage.headers()['x-robots-tag']).toBeUndefined()
  expect(await publicPage.text()).not.toContain('name="robots"')

  const form = await request.get(`/w/${FIXTURES.slug}/candidater`)
  expect(form.headers()['x-robots-tag']).toBe(ROBOTS_CLOSED)

  // E10.06: the pages are revalidated at each load, so that none names a former version's assets.
  expect(home.headers()['cache-control']).toBe('no-cache')
  expect(publicPage.headers()['cache-control']).toBe('no-cache')
  const unknown = await request.get('/page-inconnue-smoke')
  expect(unknown.headers()['cache-control']).toBe('no-cache')

  // E10.08: the hash-named scripts are kept a year, compressed for the browsers that accept it.
  const script = /src="(\/assets\/index-[^"]+\.js)"/.exec(await home.text())?.[1]
  expect(script).toBeTruthy()
  const asset = await request.get(script!, { headers: { 'Accept-Encoding': 'gzip' } })
  expect(asset.status()).toBe(200)
  expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
  expect(asset.headers()['content-encoding']).toBe('gzip')
  expect(asset.headers()['x-robots-tag']).toBe(ROBOTS_CLOSED)
})
