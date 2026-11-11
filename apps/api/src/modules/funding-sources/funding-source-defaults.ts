import type { Prisma } from '@prisma/client'
import { DEFAULT_FUNDING_SOURCE_CATEGORIES } from '@confluent/shared'

// D04's default categories (ROADMAP E06.02), given to a workspace in the transaction that creates
// it — as the migration's backfill gave them to the workspaces existing before.
export async function createDefaultFundingSourceCategories(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await tx.fundingSourceCategory.createMany({
    data: DEFAULT_FUNDING_SOURCE_CATEGORIES.map((category, position) => ({
      workspaceId,
      key: category.key,
      label: category.label,
      family: category.family,
      position,
    })),
  })
}
