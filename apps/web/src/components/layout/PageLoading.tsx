import { Outlet, useNavigation } from 'react-router-dom'

// ROADMAP E10.08: pages load on demand (router.tsx). What shows meanwhile, said to screen readers too.

// The first load of a page, before anything else can show.
export function PageLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <p role="status" className="text-sm text-muted-foreground">
        Chargement de la page…
      </p>
    </div>
  )
}

// Around every page: while the next page's chunk loads, the page left stays (focus where it was) and
// a bar at the top of the window says a page is coming. The live region is always there, so that its
// text is announced when it appears — a polite live region, not a `status`: the pages' own status
// messages stay the only ones.
export function RootLayout() {
  const loading = useNavigation().state === 'loading'
  return (
    <>
      <div aria-live="polite" className="sr-only" data-testid="page-loading-announce">
        {loading ? 'Chargement de la page…' : ''}
      </div>
      {loading && (
        <div
          aria-hidden="true"
          data-testid="page-loading-bar"
          className="fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-primary/20"
        >
          <div className="h-full w-1/3 bg-primary motion-safe:animate-page-loading" />
        </div>
      )}
      <Outlet />
    </>
  )
}
