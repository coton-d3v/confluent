import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ADMIN_DOSSIER_PAGE_MAX, ADMIN_DOSSIER_SEARCH_MAX_LENGTH } from '@confluent/shared'
import { useCurrentUser } from '@/features/current-user/context'
import { listAdminDossiers } from '@/features/admin/dossiers.api'
import { adminFailure } from '@/features/admin/failure'
import { useAsync } from '@/lib/useAsync'
import { formatRelativeDate } from '@/lib/relative-date'
import { LoadError } from '@/components/confluent/LoadError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

// ROADMAP E10.05: every request of the platform, searched by the server past any page — title,
// company, owner's email, slug or identifier —, the search and the page kept in the address. A slug or
// an identifier typed exactly opens its request directly.
function AdminDossiersList() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.min(ADMIN_DOSSIER_PAGE_MAX, Math.max(1, Math.floor(Number(searchParams.get('page'))) || 1))
  const q = (searchParams.get('q') ?? '').trim().slice(0, ADMIN_DOSSIER_SEARCH_MAX_LENGTH)
  const [draft, setDraft] = useState(q)
  // The field follows the address (back, forward, a link with `q`).
  const [shownQ, setShownQ] = useState(q)
  if (shownQ !== q) {
    setShownQ(q)
    setDraft(q)
  }
  // The search submitted here, whose exact slug or identifier opens its request once read; a search
  // read again later (back from the request, a new page) never moves the administrator elsewhere.
  const goTo = useRef<string | null>(null)
  const { data, isLoading, error, refetch } = useAsync(
    () => listAdminDossiers({ page, pageSize: PAGE_SIZE, q: q || undefined }),
    [page, q],
  )

  useEffect(() => {
    headingRef.current?.focus()
  }, [])


  useEffect(() => {
    if (!data || goTo.current === null || data.q !== goTo.current) return
    goTo.current = null
    if (data.exactMatch) navigate(`/admin/dossiers/${encodeURIComponent(data.exactMatch.slug)}`)
  }, [data, navigate])

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

  function submit(e: FormEvent) {
    e.preventDefault()
    const next = draft.trim().slice(0, ADMIN_DOSSIER_SEARCH_MAX_LENGTH)
    goTo.current = next || null
    // The same search submitted again is read again (it may have changed since).
    if (next === q && page === 1) refetch()
    setSearchParams(next ? { q: next } : {}, { replace: false })
  }

  function clear() {
    goTo.current = null
    setDraft('')
    setSearchParams({}, { replace: false })
  }

  // A reading still running belongs to the previous search or page: not shown as this one's.
  const current = data && (data.q ?? '') === q && data.page === page ? data : undefined
  const items = current?.items ?? []
  const total = current?.total ?? 0
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

      <form role="search" onSubmit={submit} className="mt-6 flex flex-col gap-2">
        <label htmlFor="admin-dossier-search" className="text-sm font-medium text-foreground">
          Rechercher un dossier
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="admin-dossier-search"
            type="search"
            value={draft}
            maxLength={ADMIN_DOSSIER_SEARCH_MAX_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby="admin-dossier-search-help"
            className="h-11 min-w-0 flex-1 basis-56"
            autoComplete="off"
          />
          <Button type="submit" className="h-11 px-4">
            Rechercher
          </Button>
          {q && (
            <Button type="button" variant="outline" className="h-11 px-4" onClick={clear}>
              Effacer
            </Button>
          )}
        </div>
        <p id="admin-dossier-search-help" className="text-xs text-muted-foreground">
          Titre de la demande ou nom de l’entreprise (une partie suffit), email exact du porteur,
          slug ou identifiant exact — un slug ou un identifiant exact ouvre directement le dossier.
        </p>
      </form>

      {error ? (
        <LoadError
          className="mt-8"
          message={adminFailure(
            error,
            q ? `La recherche « ${q} » n’a pas pu aboutir.` : 'Les dossiers n’ont pas pu être chargés.',
          )}
          onRetry={refetch}
          retrying={isLoading}
        />
      ) : !current ? (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          {q ? `Recherche de « ${q} »…` : 'Chargement…'}
        </p>
      ) : items.length === 0 ? (
        <div className="mt-8 flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-4 py-6 text-sm">
          {total > 0 ? (
            <>
              <p className="text-foreground">
                La page {page} n’existe pas : {total} dossier{total > 1 ? 's' : ''} sur {totalPages}{' '}
                page{totalPages > 1 ? 's' : ''}.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => setPage(totalPages)}>
                Aller à la dernière page
              </Button>
            </>
          ) : q ? (
            <>
              <p className="text-foreground">Aucun dossier ne correspond à « {q} ».</p>
              <p className="text-muted-foreground">
                Vérifiez l’orthographe, ou cherchez l’email complet du porteur, le slug ou
                l’identifiant exact du dossier.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={clear}>
                Voir tous les dossiers
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground">
              Aucun dossier pour le moment : les dossiers apparaissent ici dès qu’un entrepreneur ou un
              conseiller en crée un.
            </p>
          )}
        </div>
      ) : (
        <>
          {q && (
            <p className="mt-6 text-sm text-muted-foreground" role="status">
              {total} dossier{total > 1 ? 's' : ''} pour « {q} ».
            </p>
          )}
          <ul
            role="list"
            aria-label="Liste des dossiers de la plateforme"
            className="mt-4 flex flex-col gap-3 md:hidden"
          >
            {items.map((d) => (
              <li key={d.id} className="flex">
                <Link
                  to={`/admin/dossiers/${encodeURIComponent(d.slug)}`}
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

          <div className="mt-4 hidden overflow-hidden rounded-lg border border-border bg-card md:block">
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
                        to={`/admin/dossiers/${encodeURIComponent(d.slug)}`}
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
              className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
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
