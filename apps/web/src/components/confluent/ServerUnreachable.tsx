import { CloudOffIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

// ROADMAP E10.06: the session could not be restored because the server did not answer. Not the
// sign-in page: nothing says this browser is signed out. Tried again on « Réessayer » and when the
// browser comes back online.
export function ServerUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <title>Connexion impossible · Confluent</title>
      <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center gap-6 bg-background px-6 py-12 text-center">
        <CloudOffIcon aria-hidden="true" className="size-12 text-muted-foreground" />
        <h1 className="font-heading text-2xl font-medium text-foreground">
          Confluent ne répond pas
        </h1>
        <p className="text-sm text-muted-foreground">
          Votre session n’a pas pu être vérifiée : le serveur est injoignable. Vérifiez votre
          connexion internet, puis réessayez. La page réessaie d’elle-même au retour de la
          connexion.
        </p>
        <Button type="button" size="lg" className="w-full" onClick={onRetry}>
          Réessayer
        </Button>
      </main>
    </>
  )
}
