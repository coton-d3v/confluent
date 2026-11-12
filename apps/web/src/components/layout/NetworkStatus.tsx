import { useEffect, useState } from 'react'
import { WifiIcon, WifiOffIcon } from 'lucide-react'

type Status = 'online' | 'offline' | 'back'

const BACK_ONLINE_MS = 5_000

// ROADMAP E10.06: a non-blocking notice while the browser is offline, then briefly when the
// connection is back. It covers nothing a click needs (no pointer events) and is announced politely
// (a live region present from the start, so that screen readers announce what appears in it).
export function NetworkStatus() {
  const [status, setStatus] = useState<Status>(() =>
    typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online',
  )

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const offline = () => {
      clearTimeout(timer)
      setStatus('offline')
    }
    const online = () => {
      clearTimeout(timer)
      setStatus((current) => (current === 'offline' ? 'back' : current))
      timer = setTimeout(() => setStatus('online'), BACK_ONLINE_MS)
    }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
    }
  }, [])

  return (
    // A live region without the `status` role: the pages' own status messages stay the only ones.
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center px-4"
    >
      {status === 'offline' && (
        <p className="flex max-w-xl items-center gap-2 rounded-md border border-border bg-foreground px-4 py-2 text-sm text-background shadow-md">
          <WifiOffIcon aria-hidden="true" className="size-4 shrink-0" />
          Vous êtes hors ligne : ce qui demande le serveur (chargement, enregistrement) échouera
          jusqu’au retour de la connexion.
        </p>
      )}
      {status === 'back' && (
        <p className="flex max-w-xl items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm text-foreground shadow-md">
          <WifiIcon aria-hidden="true" className="size-4 shrink-0" />
          Connexion rétablie.
        </p>
      )}
    </div>
  )
}
