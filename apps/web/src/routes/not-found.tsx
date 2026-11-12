import { buttonVariants } from '@/components/ui/button'

// ROADMAP E10.06: an address that matches no page, signed in or not.
export default function NotFoundRoute() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 bg-background px-6 py-12 text-center">
      <title>Page introuvable · Confluent</title>
      <p className="text-sm font-medium text-muted-foreground">Erreur 404</p>
      <h1 className="font-heading text-3xl font-medium text-foreground">Page introuvable</h1>
      <p className="text-muted-foreground">
        Aucune page ne correspond à cette adresse. Vérifiez le lien, ou repartez de l’accueil.
      </p>
      {/* A full load: the start page then signs in or opens the right home page. */}
      <a href="/" className={buttonVariants({ size: 'lg' })}>
        Retour à l’accueil
      </a>
    </main>
  )
}
