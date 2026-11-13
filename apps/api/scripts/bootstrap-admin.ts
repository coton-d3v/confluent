import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { emailArgument } from './lib/email-argument'

const email = emailArgument(process.argv)
if (!email) {
  console.error('Usage: pnpm --filter @confluent/api bootstrap:admin <email>')
  process.exit(1)
}

const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: 'admin', isActive: true },
    create: { email, role: 'admin', isActive: true, emailVerifiedAt: null },
  })
  console.log(`Admin user ready: ${user.email} (id: ${user.id})`)
  console.log(`→ Go to /auth and request a magic link with this email.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
