import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { ROBOTS_CLOSED, type UserRole } from '@confluent/shared'
import { Toaster } from '@/components/ui/sonner'
import { CurrentUserProvider } from '@/features/current-user/context'
import { setRobots } from '@/lib/robots'
import { router } from './router'
import './index.css'

export type _CrossWorkspaceTypeCheck = UserRole

// E09.06: closed to search engines before anything renders, whatever the HTML served (lib/robots.ts).
setRobots(ROBOTS_CLOSED)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CurrentUserProvider>
      <Toaster />
      <RouterProvider router={router} />
    </CurrentUserProvider>
  </StrictMode>,
)
