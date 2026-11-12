import type { ReactNode } from 'react'
import { ROBOTS_CLOSED, type RobotsDirective } from '@confluent/shared'
import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
import { LegalLinks } from '@/components/confluent/LegalLinks'
import { useRobots } from '@/lib/robots'

// A signed-out page (E08.04, E09.01), readable at 375 px. E09.06: never indexed by search engines,
// unless a workspace's public page its managers allowed to be indexed says so (`robots`).
export function PublicShell({
  title,
  robots = ROBOTS_CLOSED,
  children,
}: {
  title: string
  robots?: RobotsDirective
  children: ReactNode
}) {
  useRobots(robots)
  return (
    <>
      <title>{`${title} · Confluent`}</title>
      <main className="flex min-h-screen flex-col items-center gap-6 bg-background px-4 py-10 sm:px-6">
        <ConfluentWordmark className="h-7 w-auto text-foreground" />
        <div className="flex w-full max-w-xl flex-col gap-6">{children}</div>
        <LegalLinks className="justify-center" />
      </main>
    </>
  )
}
