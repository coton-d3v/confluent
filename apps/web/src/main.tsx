import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { ROBOTS_CLOSED, type UserRole } from '@confluent/shared'
import { Toaster } from '@/components/ui/sonner'
import { NetworkStatus } from '@/components/layout/NetworkStatus'
import { CurrentUserProvider } from '@/features/current-user/context'
import { setRobots } from '@/lib/robots'
import { reloadOnce } from '@/lib/stale-bundle'
import { router } from './router'
import './index.css'

export type _CrossWorkspaceTypeCheck = UserRole

// E09.06: closed to search engines before anything renders, whatever the HTML served (lib/robots.ts).
setRobots(ROBOTS_CLOSED)

// E10.06: a script of a former version that cannot be loaded after a deploy — reload once; if that
// already happened, the error reaches the route's error screen.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnce()) event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CurrentUserProvider>
      <Toaster />
      <NetworkStatus />
      <RouterProvider router={router} />
    </CurrentUserProvider>
  </StrictMode>,
)
