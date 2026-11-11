import type { Prisma } from '@prisma/client'
import { DEFAULT_ELIGIBILITY_SCHEMES } from '@confluent/shared'

// The default eligibility schemes (ROADMAP E06.05), given to a workspace in the transaction that
// creates it — as the migration's backfill gave them to the workspaces existing before.
export async function createDefaultEligibilitySchemes(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await tx.eligibilityScheme.createMany({
    data: DEFAULT_ELIGIBILITY_SCHEMES.map((scheme, position) => ({
      workspaceId,
      key: scheme.key,
      label: scheme.label,
      description: scheme.description,
      position,
    })),
  })
}
