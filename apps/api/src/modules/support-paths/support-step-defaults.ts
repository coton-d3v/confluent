import type { Prisma } from '@prisma/client'
import { DEFAULT_SUPPORT_STEPS } from '@confluent/shared'

// The default support path (ROADMAP E06.06), given to a workspace in the transaction that creates
// it — as the migration's backfill gave it to the workspaces existing before.
export async function createDefaultSupportSteps(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await tx.supportStep.createMany({
    data: DEFAULT_SUPPORT_STEPS.map((step, position) => ({
      workspaceId,
      key: step.key,
      label: step.label,
      explanation: step.explanation,
      position,
    })),
  })
}
