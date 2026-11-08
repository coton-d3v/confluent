import type { ReactNode } from 'react'
import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
import { LegalLinks } from '@/components/confluent/LegalLinks'

// Centered, logged-out style layout shared by the share-link screens.
export function ShareShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <title>{`${title} · Confluent`}</title>
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-12">
        <ConfluentWordmark className="h-7 w-auto text-foreground" />
        <div className="flex w-full max-w-sm flex-col gap-4 text-center">{children}</div>
        <LegalLinks className="justify-center" />
      </main>
    </>
  )
}
