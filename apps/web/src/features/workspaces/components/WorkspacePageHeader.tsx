import { useEffect, useRef } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import type { Workspace } from '@confluent/shared'
import { useCurrentUser } from '@/features/current-user/context'
import { cn } from '@/lib/utils'

// Header of a workspace's management pages: trail, name, address and the Réglages / Membres /
// Formulaires (E05.09) / Sources de financement (E06.02) / Dispositifs (E06.05) / Parcours
// d'accompagnement (E06.06) / Page publique (E09.01) tabs, scrolled within their bar on a narrow
// screen rather than widening the page.
// An administrator comes from the administration; a manager from « Mes workspaces ».
export function WorkspacePageHeader({ workspace }: { workspace: Workspace }) {
  const me = useCurrentUser()
  const base = `/admin/workspaces/${workspace.id}`
  const tabs = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  // The current tab stays in sight when the bar scrolls (narrow screen).
  useEffect(() => {
    const bar = tabs.current
    const current = bar?.querySelector<HTMLElement>('[aria-current="page"]')
    if (bar && current) bar.scrollLeft = current.offsetLeft - bar.offsetLeft - 16
  }, [pathname])
  return (
    <>
      <nav aria-label="Fil d’Ariane" className="wrap-anywhere text-xs text-muted-foreground">
        {me.role === 'admin' ? (
          <>
            <Link to="/admin" className="hover:underline">
              Admin
            </Link>
            {' / '}
            <Link to="/admin/workspaces" className="hover:underline">
              Workspaces
            </Link>
          </>
        ) : (
          <Link to="/workspaces" className="hover:underline">
            Mes workspaces
          </Link>
        )}
        {' / '}
        <span className="text-foreground">{workspace.name}</span>
      </nav>
      <h1 className="mt-4 wrap-anywhere font-heading text-2xl font-semibold text-foreground md:text-[28px]">
        {workspace.name}
      </h1>
      <p className="mt-1 break-all font-mono text-sm text-muted-foreground">/w/{workspace.slug}</p>
      <nav
        ref={tabs}
        aria-label="Sections du workspace"
        className="mt-4 flex gap-1 overflow-x-auto border-b border-border"
      >
        <Tab to={base} end>
          Réglages
        </Tab>
        <Tab to={`${base}/membres`}>Membres</Tab>
        <Tab to={`${base}/formulaires`}>Formulaires</Tab>
        <Tab to={`${base}/sources`}>Sources de financement</Tab>
        <Tab to={`${base}/dispositifs`}>Dispositifs</Tab>
        <Tab to={`${base}/parcours`}>Parcours d’accompagnement</Tab>
        <Tab to={`${base}/page-publique`}>Page publique</Tab>
      </nav>
    </>
  )
}

function Tab({ to, end, children }: { to: string; end?: boolean; children: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring)]',
          isActive
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground',
        )
      }
    >
      {children}
    </NavLink>
  )
}

// Shown instead of a workspace page the account may not (or no longer) manage.
export function WorkspaceNotManaged() {
  const me = useCurrentUser()
  return (
    <div className="flex flex-col items-start gap-2 pt-8">
      <p className="text-sm text-foreground">
        Vous ne gérez pas ce workspace : seuls ses gestionnaires et les administrateurs de Confluent
        y ont accès.
      </p>
      <Link
        to={me.role === 'admin' ? '/admin/workspaces' : '/workspaces'}
        className="text-sm text-foreground underline underline-offset-4"
      >
        {me.role === 'admin' ? 'Retour aux workspaces' : 'Voir mes workspaces'}
      </Link>
    </div>
  )
}
