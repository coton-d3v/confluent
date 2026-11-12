import type { ReactNode } from 'react'
import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
import { LegalLinks } from '@/components/confluent/LegalLinks'

// A signed-out page (E08.04, E09.01), readable at 375 px, never indexed by search engines (E09.06
// decides when a structure may allow it).
export function PublicShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <title>{`${title} · Confluent`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <main className="flex min-h-screen flex-col items-center gap-6 bg-background px-4 py-10 sm:px-6">
        <ConfluentWordmark className="h-7 w-auto text-foreground" />
        <div className="flex w-full max-w-xl flex-col gap-6">{children}</div>
        <LegalLinks className="justify-center" />
      </main>
    </>
  )
}
