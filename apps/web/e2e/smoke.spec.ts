import { expect, test, type Page } from '@playwright/test'
import { FIXTURES, SMOKE } from './env'

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

type MailpitSearch = { messages: Array<{ ID: string }> }

// The link the API emailed to `email`, read from Mailpit. The mailbox is emptied before each request.
async function emailedLink(email: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const search = await fetch(
      `${SMOKE.mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    )
    const { messages } = (await search.json()) as MailpitSearch
    if (messages.length > 0) {
      const message = await fetch(`${SMOKE.mailpit}/api/v1/message/${messages[0].ID}`)
      const { Text } = (await message.json()) as { Text: string }
      const link = Text.match(/https?:\/\/\S+\/auth\/verify\?token=[\w-]+/)
      if (!link) throw new Error('Aucun lien de connexion dans l’email reçu.')
      return link[0]
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Aucun email reçu pour ${email}.`)
}

// Signs in through the sign-in page and the emailed link, which it returns.
async function signIn(page: Page, email: string): Promise<string> {
  await fetch(`${SMOKE.mailpit}/api/v1/messages`, { method: 'DELETE' })
  await page.goto('/auth')
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  await page.getByLabel('Adresse email').fill(email)
  await page.getByRole('button', { name: 'Recevoir mon lien de connexion' }).click()
  await expect(page.getByRole('status')).toContainText('Vérifiez votre boîte mail')
  const link = await emailedLink(email)
  await page.goto(link)
  return link
}

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
})
