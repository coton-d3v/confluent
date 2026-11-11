import { useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { canOwnCompanies } from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { DossierCard } from '@/components/confluent/DossierCard'
import { EmptyState } from '@/components/confluent/EmptyState'
import { EmptyDossiersIllustration } from '@/components/confluent/illustrations/EmptyDossiersIllustration'
import { useDossiers } from '@/features/dossiers/hooks'
import { useCurrentUser } from '@/features/current-user/context'
import { listCompanies } from '@/features/companies/api'
import { useAsync } from '@/lib/useAsync'

export default function DashboardRoute() {
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { data: dossiers, isLoading, error } = useDossiers()
  const currentUser = useCurrentUser()

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  function goToNew() {
    navigate('/dashboard/dossiers/nouveau')
  }

  const list = dossiers ?? []
  // Creating a dossier creates its company: offered to whoever may own one (E05.04).
  const canCreate = canOwnCompanies(currentUser)
  // E05.07: each company and its requests; another request is created on the company's page.
  const companies = useAsync(
    () => (canCreate ? listCompanies() : Promise.resolve([])),
    [canCreate],
  ).data
  const companyNames = new Map((companies ?? []).map((c) => [c.id, c.name]))

  return (
    <>
      <title>Dashboard · Confluent</title>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
        >
          Mes dossiers
        </h1>
        {canCreate && (
          <Button
            type="button"
            size="lg"
            className="h-11 self-start px-4 sm:self-auto"
            onClick={goToNew}
          >
            Créer un dossier
          </Button>
        )}
      </div>
      {companies && companies.length > 0 && (
        <section aria-labelledby="companies-heading" className="mt-6">
          <h2 id="companies-heading" className="text-sm font-medium text-muted-foreground">
            Mes entreprises
          </h2>
          <ul role="list" className="mt-2 flex flex-wrap gap-2">
            {companies.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/dashboard/entreprises/${encodeURIComponent(c.id)}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground hover:border-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.dossiers.length <= 1
                      ? `${c.dossiers.length} demande`
                      : `${c.dossiers.length} demandes`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Pour une autre demande de financement d’une entreprise existante, ouvrez sa page : son
            profil n’est pas à ressaisir.
          </p>
        </section>
      )}
      {isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Chargement…</p>
      ) : error ? (
        <p className="mt-8 text-sm text-destructive">
          Impossible de charger vos dossiers. Réessayez plus tard.
        </p>
      ) : list.length > 0 ? (
        <ul
          role="list"
          aria-label="Liste de vos dossiers"
          className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {list.map((d) => (
            <li key={d.id} className="flex">
              <DossierCard
                slug={d.slug}
                name={d.name}
                sector={d.sector}
                maturity={d.maturityStage}
                isShared={d.userId !== currentUser.id}
                companyName={d.company ? companyNames.get(d.company.id) ?? d.company.name : undefined}
                publicationStatus={d.userId === currentUser.id ? d.publicationStatus : undefined}
                ownerEmail={d.ownerEmail}
                ownerName={d.ownerName}
                createdAt={d.createdAt}
                className="flex-1"
              />
            </li>
          ))}
        </ul>
      ) : canCreate ? (
        <EmptyState
          illustration={<EmptyDossiersIllustration />}
          title="Aucun dossier pour l'instant"
          description="Créez votre premier dossier pour commencer à partager votre projet avec des investisseurs."
          cta={{ label: 'Créer un dossier', onClick: goToNew }}
        />
      ) : (
        <EmptyState
          illustration={<EmptyDossiersIllustration />}
          title="Aucun dossier partagé pour l'instant"
          description="Les dossiers que des entrepreneurs partagent avec vous apparaîtront ici."
        />
      )}
    </>
  )
}
