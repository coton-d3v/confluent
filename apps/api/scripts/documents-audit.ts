// CLI — list the documents whose file is no longer in the storage (ROADMAP E02.04), e.g. files
// uploaded while documents were only kept in the API memory. Read-only: nothing is deleted.
//
// Usage: pnpm --filter @confluent/api documents:audit
// Contract:
//   stdout  = one tab-separated line per lost file: dossier, owner email, file name, version,
//             upload date, whether it is the current version
//   stderr  = summary
//   exit 0  = every file is present
//   exit 1  = at least one file is lost (owners are asked to upload it again from their dossier)
//   exit 2  = configuration invalid or storage unreachable (nothing could be concluded)

import { PrismaClient } from '@prisma/client'
import { config as loadEnv } from 'dotenv'
import { validateConfig } from '../src/config/config.schema'
import { createStorageAdapter } from '../src/modules/documents/storage/storage.provider'

const PAGE = 200

async function main(): Promise<number> {
  loadEnv({ path: '.env.local', quiet: true })
  loadEnv({ path: '.env', quiet: true })
  let config
  try {
    config = validateConfig(process.env)
  } catch (err) {
    console.error((err as Error).message)
    return 2
  }
  if (config.STORAGE_DRIVER !== 's3') {
    console.error('STORAGE_DRIVER is not s3: there is no persistent storage to audit.')
    return 2
  }
  const storage = createStorageAdapter(config)
  try {
    await storage.check()
  } catch (err) {
    console.error(`Storage unreachable: ${(err as Error).name} ${(err as Error).message}`)
    return 2
  }

  const prisma = new PrismaClient()
  let checked = 0
  let lost = 0
  let lostCurrent = 0
  try {
    let cursor: string | undefined
    for (;;) {
      const rows = await prisma.document.findMany({
        take: PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        include: { dossier: { select: { name: true, user: { select: { email: true } } } } },
      })
      if (rows.length === 0) break
      cursor = rows[rows.length - 1].id
      for (const doc of rows) {
        checked++
        if (await storage.exists(doc.storageKey)) continue
        const newer = await prisma.document.count({
          where: { dossierId: doc.dossierId, filename: doc.filename, version: { gt: doc.version } },
        })
        lost++
        if (newer === 0) lostCurrent++
        console.log(
          [
            doc.dossier.name,
            doc.dossier.user.email,
            doc.filename,
            `v${doc.version}`,
            doc.createdAt.toISOString().slice(0, 10),
            newer === 0 ? 'version courante' : 'ancienne version',
          ].join('\t'),
        )
      }
    }
  } catch (err) {
    console.error(`Audit interrupted: ${(err as Error).name} ${(err as Error).message}`)
    return 2
  } finally {
    await prisma.$disconnect()
  }
  console.error(
    `${checked} document(s) vérifié(s) : ${lost} fichier(s) perdu(s), dont ${lostCurrent} version(s) ` +
      'courante(s) à redéposer par les porteurs de projet (signalées dans leur dossier).',
  )
  return lost > 0 ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err)
    process.exit(2)
  },
)
