import { useEffect, useRef } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { TriangleAlertIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isStaleBundleError, mayReload, reloadOnce } from '@/lib/stale-bundle'
import NotFoundRoute from './not-found'

// ROADMAP E10.06: what a page that failed to render shows instead of a blank screen — what happened
// and the ways out, never the error itself (shown in development only). Inside the application's
// shell (`fullPage` false) the navigation stays usable; at the root it is the whole page.
export function RouteError({ fullPage = false }: { fullPage?: boolean }) {
  const error = useRouteError()
  const heading = useRef<HTMLHeadingElement>(null)
  // A script of a former version, gone after a deploy: reloading once loads the new one.
  const stale = isStaleBundleError(error)
  const reloading = stale && mayReload()
  useEffect(() => {
    if (reloading) reloadOnce()
  }, [reloading])
  useEffect(() => {
    heading.current?.focus()
  }, [])

  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundRoute />

  const title = reloading
    ? 'Mise à jour de Confluent…'
    : stale
      ? 'Une nouvelle version de Confluent est disponible'
      : 'Cette page n’a pas pu s’afficher'
  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        fullPage
          ? 'mx-auto min-h-screen max-w-md items-center justify-center bg-background px-6 py-12 text-center'
          : 'max-w-xl py-4',
      )}
    >
      <title>Erreur · Confluent</title>
      <TriangleAlertIcon aria-hidden="true" className="size-10 text-muted-foreground" />
      <h1
        ref={heading}
        tabIndex={-1}
        className="font-heading text-2xl font-medium text-foreground focus:outline-none"
      >
        {title}
      </h1>
      {!reloading && (
        <>
          <p className="text-sm text-muted-foreground">
            {stale
              ? 'Confluent a été mis à jour depuis l’ouverture de cette page : rechargez-la pour utiliser la nouvelle version.'
              : 'Une erreur inattendue l’en a empêchée. Rechargez la page ; si le problème persiste, repartez de l’accueil.'}
          </p>
          <div className={cn('flex flex-wrap gap-3', fullPage && 'justify-center')}>
            <Button type="button" size="lg" onClick={() => window.location.reload()}>
              Recharger la page
            </Button>
            <a href="/" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              Retour à l’accueil
            </a>
          </div>
          {import.meta.env.DEV && (
            <details className="w-full text-left text-xs text-muted-foreground">
              <summary>Détails techniques (développement uniquement)</summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">
                {error instanceof Error ? (error.stack ?? error.message) : JSON.stringify(error)}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  )
}
