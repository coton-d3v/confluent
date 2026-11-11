import { Link, useLocation, useMatches } from 'react-router-dom'

type RouteHandle = { hideBreadcrumb?: boolean } | undefined

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Mes dossiers',
  'tableau-de-bord': 'Tableau de bord',
  applications: 'Applications IA',
  dossiers: 'Dossiers',
  nouveau: 'Nouveau',
  admin: 'Admin',
  formulaires: 'Formulaires',
  classification: 'Classification',
  utilisateurs: 'Utilisateurs',
  workspaces: 'Workspaces',
  membres: 'Membres',
}

function toLabel(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment]
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function Breadcrumbs() {
  const { pathname } = useLocation()
  const matches = useMatches()
  const suppressed = matches.some(
    (m) => (m.handle as RouteHandle)?.hideBreadcrumb === true,
  )
  if (suppressed) return null

  const segments = pathname.split('/').filter(Boolean)

  if (segments.length < 2) return null

  return (
    <nav aria-label="Fil d'Ariane" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1
          const path = '/' + segments.slice(0, index + 1).join('/')
          const label = toLabel(segment)

          return (
            <li key={path} className="flex items-center gap-1.5">
              {index > 0 && (
                <span aria-hidden="true" className="text-muted-foreground/60">
                  /
                </span>
              )}
              {isLast ? (
                <span
                  aria-current="page"
                  className="text-foreground font-medium"
                >
                  {label}
                </span>
              ) : (
                <Link
                  to={path}
                  className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  {label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
