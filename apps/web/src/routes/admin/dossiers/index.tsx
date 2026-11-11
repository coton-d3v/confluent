import { useEffect, useRef } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useCurrentUser } from '@/features/current-user/context'
import { listAdminDossiers } from '@/features/admin/dossiers.api'
import { useAsync } from '@/lib/useAsync'
import { formatRelativeDate } from '@/lib/relative-date'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const TAG_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  deeptech: { bg: '#E8E4F5', text: '#3d3479', label: 'Deeptech' },
  tech: { bg: '#DEEBF2', text: '#235974', label: 'Tech' },
  non_tech: { bg: '#E2EBD5', text: '#3d5328', label: 'Non-tech' },
}

function TagBadge({ tag }: { tag: string | null }) {
  if (!tag) return <span className="text-muted-foreground">—</span>
  const style = TAG_STYLES[tag]
  if (!style) return <span className="text-muted-foreground">{tag}</span>
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {style.label}
    </span>
  )
}

const PAGE_SIZE = 20

export default function AdminDossiersRoute() {
  const user = useCurrentUser()
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <AdminDossiersList />
}

function AdminDossiersList() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const { data, isLoading, error } = useAsync(
    () => listAdminDossiers(page, PAGE_SIZE),
    [page],
  )

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  function setPage(next: number) {
    setSearchParams(
      (prev) => {
        if (next <= 1) prev.delete('page')
        else prev.set('page', String(next))
        return prev
      },
      { replace: false },
    )
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = total === 0 ? 1 : Math.ceil(total / PAGE_SIZE)

  return (
    <>
      <title>Dossiers · Confluent</title>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
      >
        Dossiers
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tous les dossiers présents sur la plateforme.
      </p>

      {isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Chargement…</p>
      ) : error ? (
        <p className="mt-8 text-sm text-destructive">
          Impossible de charger les dossiers.
        </p>
      ) : items.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Aucun dossier pour le moment.
        </p>
      ) : (
        <>
          <ul
            role="list"
            aria-label="Liste des dossiers de la plateforme"
            className="mt-8 flex flex-col gap-3 md:hidden"
          >
            {items.map((d) => (
              <li key={d.id} className="flex">
                <Link
                  to={`/admin/dossiers/${d.slug}`}
                  className="group flex min-h-11 flex-1 flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20 focus-visible:border-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  <h2 className="min-w-0 break-words text-base font-medium text-foreground">
                    {d.name}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Entreprise : {d.companyName}
                  </p>
                  <p className="text-xs text-muted-foreground">{d.ownerEmail}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.sector ?? 'Non classifié'}
                  </p>
                  <TagBadge tag={d.tagTechnologique ?? null} />
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-8 hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Dossier</th>
                  <th scope="col" className="px-4 py-3 font-medium">Entreprise</th>
                  <th scope="col" className="px-4 py-3 font-medium">Entrepreneur</th>
                  <th scope="col" className="px-4 py-3 font-medium">Secteur</th>
                  <th scope="col" className="px-4 py-3 font-medium">Stade</th>
                  <th scope="col" className="px-4 py-3 font-medium">Tag</th>
                  <th scope="col" className="px-4 py-3 font-medium">Créé</th>
                  <th scope="col" className="px-4 py-3 font-medium">Accès actifs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((d) => (
                  <tr
                    key={d.id}
                    className="relative transition-colors hover:bg-muted/50 focus-within:bg-muted/50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/dossiers/${d.slug}`}
                        className={cn(
                          'rounded-sm font-medium text-foreground',
                          'after:absolute after:inset-0 after:content-[""]',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                        )}
                      >
                        {d.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{d.companyName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{d.ownerEmail}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {d.sector ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {d.maturityStage ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <TagBadge tag={d.tagTechnologique ?? null} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatRelativeDate(d.createdAt)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {d.activeShareLinksCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <nav
              aria-label="Pagination des dossiers"
              className="mt-6 flex items-center justify-between gap-3 text-sm text-muted-foreground"
            >
              <span>
                Page {page} sur {totalPages} · {total} dossier{total > 1 ? 's' : ''}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page - 1)}
                  disabled={page <= 1}
                >
                  Précédent
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page >= totalPages}
                >
                  Suivant
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
    </>
  )
}
