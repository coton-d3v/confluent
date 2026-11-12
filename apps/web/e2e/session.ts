import { expect, type Page } from '@playwright/test'
import { SMOKE } from './env'

type MailpitSearch = { messages: Array<{ ID: string }> }

// The link the API emailed to `email`, read from Mailpit. The mailbox is emptied before each request.
export async function emailedLink(email: string): Promise<string> {
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
export async function signIn(page: Page, email: string): Promise<string> {
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
