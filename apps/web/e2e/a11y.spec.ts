import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { FIXTURES } from './env'
import { signIn } from './session'

// ROADMAP E10.07: accessibility of the critical pages, in a real browser — an axe audit (WCAG 2.0 and
// 2.1, levels A and AA) that fails on any serious or critical violation, and the keyboard, focus,
// reflow (320 px) and phone checks a script can make. Not a screen-reader session: that stays a
// human recipe.

// A request named with an unbroken 64-letter word: it must wrap, not widen the page.
const LONG_NAME = 'Smoke A11y Anticonstitutionnellementextraordinairementinterminablementlongue'

let pageErrors: string[] = []
test.beforeEach(({ page }) => {
  pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
})
test.afterEach(() => {
  expect(pageErrors, 'erreurs JavaScript non rattrapées').toEqual([])
})

// The serious and critical WCAG 2.0/2.1 A/AA violations of the page as it is shown, in words.
async function expectAccessible(page: Page, where: string) {
  await expect(page.getByText(/^Chargement/)).toHaveCount(0)
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blocking = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}) : ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
  expect(blocking, `violations WCAG sur ${where}`).toEqual([])
}

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

// The entrepreneur's request with a very long name, created once (the tests can run again).
async function openLongRequest(page: Page) {
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText(/^Chargement/)).toHaveCount(0)
  const card = page.getByRole('link', { name: new RegExp(`^${LONG_NAME}`) })
  if ((await card.count()) === 0) {
    await page.goto('/dashboard/dossiers/nouveau')
    await page.getByLabel(/Comment s.appelle votre entreprise/).fill(LONG_NAME)
    await page.getByRole('button', { name: 'Commencer' }).click()
    await page.waitForURL(/questionnaire/)
    await page.goto('/dashboard')
  }
  // The card leads to the request, or to its company's page (profile submitted), then the request.
  await page.getByRole('link', { name: new RegExp(`^${LONG_NAME}`) }).first().click()
  const requests = page.getByRole('region', { name: 'Demandes de financement' })
  const content = page.getByRole('tab', { name: 'Contenu' })
  await expect(requests.or(content)).toBeVisible()
  if (await requests.isVisible()) {
    await requests.getByRole('link', { name: new RegExp(`^${LONG_NAME}`) }).click()
  }
  // The company's link opens « Demande »: select « Contenu » so that it is the panel then audited.
  await content.click()
  await expect(content).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel', { name: 'Contenu' })).toBeVisible()
}

test('pages publiques et connexion : aucune violation WCAG grave', async ({ page }) => {
  for (const path of [
    `/w/${FIXTURES.slug}`,
    `/w/${FIXTURES.slug}/candidater`,
    '/auth',
    '/auth/verify?token=jeton-invalide-smoke',
    '/mentions-legales',
    '/page-inconnue-smoke',
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expectAccessible(page, path)
  }
})

test('espace porteur : aucune violation WCAG grave, titre de page, un seul h1', async ({ page }) => {
  await signIn(page, FIXTURES.entrepreneur)
  await page.waitForURL(/\/dashboard/)
  await openLongRequest(page)
  // A page title that names the request (WCAG 2.4.2), not an empty one.
  await expect(page).toHaveTitle(`${LONG_NAME} · Confluent`)
  await expectAccessible(page, 'la page du dossier (contenu)')
  await page.getByRole('tab', { name: 'Demande' }).click()
  await expectAccessible(page, 'la page du dossier (demande)')

  for (const path of ['/dashboard', '/dashboard/dossiers/nouveau', '/dashboard/applications', '/notifications']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expectAccessible(page, path)
  }
})

test('clavier : évitement, focus après navigation, dialogue, erreur de profil', async ({ page }) => {
  await signIn(page, FIXTURES.entrepreneur)
  await page.waitForURL(/\/dashboard/)
  // A page that focuses nothing on its own, loaded afresh.
  await page.goto('/dashboard/tableau-de-bord')
  await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible()

  // The first Tab reaches the skip link, which leads to the main content.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Aller au contenu principal' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('main')).toBeFocused()

  // A page reached from the menu starts at its heading, not at the link left behind.
  // E10.08: pages load on demand — while the page's script is on its way (slowed down here), the
  // page left stays with the focus where it was, and the wait is said (status region, bar).
  const menu = page.getByRole('navigation', { name: 'Navigation principale' })
  let releaseScripts = () => {}
  const scriptsHeld = new Promise<void>((resolve) => (releaseScripts = resolve))
  await page.route('**/assets/*.js', async (route) => {
    await scriptsHeld
    await route.continue().catch(() => {})
  })
  await menu.getByRole('link', { name: 'Applications IA' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('page-loading-announce')).toHaveText('Chargement de la page…')
  await expect(page.getByTestId('page-loading-announce')).toHaveAttribute('aria-live', 'polite')
  await expect(page.getByTestId('page-loading-bar')).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Applications IA' })).toBeFocused()
  await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible()
  releaseScripts()
  await expect(page.getByRole('heading', { level: 1, name: 'Applications IA' })).toBeFocused()
  await expect(page.getByTestId('page-loading-bar')).toHaveCount(0)
  await expect(page.getByTestId('page-loading-announce')).toHaveText('')
  await page.unroute('**/assets/*.js')
  await expect(menu.getByRole('link', { name: 'Applications IA' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  // The profile dialog keeps the focus inside, closes with Escape and gives it back.
  const opener = page.getByRole('button', { name: /Paul Smoke/ })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Mon profil' })
  await expect(dialog.getByLabel('Prénom')).toBeFocused()
  // Tab after Tab (the dialog's focus guards send the focus back inside between two presses).
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    await expect
      .poll(() => dialog.evaluate((d) => d.contains(document.activeElement)))
      .toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()

  // A profile that could not be saved: said in French, what was typed stays.
  await opener.click()
  await page.route('**/v1/auth/profile', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Service down' } } }),
  )
  await dialog.getByLabel('Prénom').fill('Paulette')
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(dialog.getByText('Vos informations n’ont pas été enregistrées')).toBeVisible()
  await expect(dialog.getByLabel('Prénom')).toHaveValue('Paulette')
  await expect(dialog.getByLabel('Prénom')).toHaveAttribute('aria-describedby', 'profile-error')
  await page.unroute('**/v1/auth/profile')
})

test('téléphone (320 px) : sans défilement horizontal, compte et informations légales accessibles', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 640 },
    hasTouch: true,
    isMobile: true,
    locale: 'fr-FR',
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await signIn(page, FIXTURES.entrepreneur)
  await page.waitForURL(/\/dashboard/)
  await openLongRequest(page)
  expect(await horizontalOverflow(page), 'défilement horizontal sur la page du dossier').toBe(0)
  await page.goto('/dashboard')
  await expect(page.getByText(/^Chargement/)).toHaveCount(0)
  expect(await horizontalOverflow(page), 'défilement horizontal sur « Mes dossiers »').toBe(0)
  await expectAccessible(page, '« Mes dossiers » sur téléphone')

  // No sidebar on a phone: the account menu holds the profile, the sign-out and the legal links.
  const account = page.getByRole('button', { name: 'Mon compte' })
  const box = await account.boundingBox()
  expect(box && box.width >= 44 && box.height >= 44, 'cible tactile de 44 px').toBe(true)
  await account.click()
  const menu = page.getByRole('dialog', { name: 'Mon compte' })
  await expect(menu.getByRole('button', { name: 'Modifier mon profil' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Mentions légales' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Confidentialité' })).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(account).toBeFocused()
  // The profile, from the menu: back to the menu's button when it closes.
  await account.click()
  await menu.getByRole('button', { name: 'Modifier mon profil' }).click()
  const profile = page.getByRole('dialog', { name: 'Mon profil' })
  await expect(profile.getByLabel('Prénom')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(profile).toHaveCount(0)
  await expect(account).toBeFocused()
  await account.click()
  await menu.getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  await context.close()
})

test('administration : aucune violation WCAG grave', async ({ page }) => {
  await signIn(page, FIXTURES.admin)
  await page.waitForURL(/\/admin$/)
  for (const path of ['/admin', '/admin/dossiers', '/admin/utilisateurs', '/admin/workspaces']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expectAccessible(page, path)
  }
})
