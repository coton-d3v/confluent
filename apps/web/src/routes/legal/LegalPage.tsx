import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
import { LegalLinks } from '@/components/confluent/LegalLinks'
import { LEGAL_INFO } from '@/features/legal/legal-info'

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <title>{`${title} · Confluent`}</title>
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 bg-background px-6 py-10 lg:max-w-3xl">
        <Link to="/" aria-label="Retour à l'accueil de Confluent" className="w-fit">
          <ConfluentWordmark className="h-6 w-auto text-foreground" />
        </Link>
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-2xl font-semibold text-foreground md:text-3xl">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Dernière mise à jour : {LEGAL_INFO.lastUpdated}
          </p>
        </header>
        <div className="flex flex-col gap-8 text-sm leading-relaxed text-foreground">{children}</div>
        <LegalLinks className="mt-auto border-t border-border pt-6" />
      </main>
    </>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-lg font-medium text-foreground">{title}</h2>
      {children}
    </section>
  )
}
