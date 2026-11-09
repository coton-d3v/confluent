import { useEffect, useState } from 'react'
import { CloudOffIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

// A share that could not be read for now (network, overload, server failure) — not a refused link
// (code review R03). « Réessayer » waits for the delay the server asked for, if any.
export function ShareUnavailablePage({ retry, retryAfter }: { retry: () => void; retryAfter?: number }) {
  const [wait, setWait] = useState(retryAfter ?? 0)
  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  return (
    <>
      <title>Dossier momentanément indisponible — Confluent</title>
      <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center gap-6 bg-background px-6 py-12 text-center">
        <CloudOffIcon aria-hidden="true" className="size-12 text-muted-foreground" />
        <h1 className="font-heading text-2xl font-medium text-foreground sm:text-[28px]">
          Dossier momentanément indisponible
        </h1>
        <p className="text-sm text-muted-foreground">
          Le dossier n’a pas pu être chargé. Votre lien reste valable : réessayez dans quelques
          instants.
        </p>
        <Button type="button" size="lg" className="w-full" disabled={wait > 0} onClick={retry}>
          {wait > 0 ? `Réessayer dans ${wait} s` : 'Réessayer'}
        </Button>
      </main>
    </>
  )
}
