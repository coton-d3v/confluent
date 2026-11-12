import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  COMPANY_TRANSFER_STATUS_LABELS,
  DOSSIER_PRESENTATION_LIMITS,
  DOSSIER_PUBLICATION_STATUS_LABELS,
  dossierNameSchema,
  publicationStatusOf,
  type Company,
  type CompanyDossier,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createCompanyDossier, getCompany } from '@/features/companies/api'
import { financingTypeLabels, formatAmount } from '@/features/dossiers/presentation'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { readFailure } from '@/lib/read-failure'
import { LoadError } from '@/components/confluent/LoadError'

// ROADMAP E05.07: a company and its financing requests. Its profile (answers) and its document
// library are common to its requests: a new request presents them without entering them again.
export default function CompanyRoute() {
  const { companyId } = useParams<{ companyId: string }>()
  const query = useAsync(
    () => (companyId ? getCompany(companyId) : Promise.reject(new Error('id required'))),
    [companyId],
  )
  if (query.isLoading) return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  if (query.error || !query.data) {
    const notFound = (query.error as ApiError | undefined)?.status === 404 || !companyId
    if (!notFound) {
      return (
        <section className="mx-auto max-w-md pt-16">
          <title>Entreprise indisponible · Confluent</title>
          <LoadError
            message={readFailure(query.error, 'L’entreprise n’a pas pu être chargée.')}
            onRetry={query.refetch}
          />
        </section>
      )
    }
    return (
      <section className="mx-auto max-w-md pt-16 text-center">
        <title>Entreprise introuvable · Confluent</title>
        <p className="text-sm text-muted-foreground">
          Entreprise introuvable.
        </p>
        <Link to="/dashboard" className="mt-4 inline-block text-sm underline hover:text-foreground">
          Retour à mes dossiers
        </Link>
      </section>
    )
  }
  return <CompanyView company={query.data} />
}

function CompanyView({ company }: { company: Company }) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => headingRef.current?.focus(), [company.id])
  return (
    <div className="mx-auto max-w-[720px]">
      <title>{`${company.name} · Confluent`}</title>
      <nav aria-label="Fil d'Ariane" className="mb-4">
        <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <li>
            <Link to="/dashboard" className="rounded-sm hover:text-foreground">
              Dossiers
            </Link>
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="text-muted-foreground/60">
              /
            </span>
            <span aria-current="page" className="font-medium text-foreground">
              {company.name}
            </span>
          </li>
        </ol>
      </nav>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
      >
        {company.name}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Le profil de l’entreprise (réponses au questionnaire) et sa bibliothèque de documents sont
        communs à ses demandes de financement. Chaque demande a sa propre présentation, sa
        publication, ses partages et choisit les documents qu’elle présente.
      </p>

      {company.preparation && <PreparationNotice preparation={company.preparation} />}

      <section aria-labelledby="requests-heading" className="mt-8 flex flex-col gap-4">
        <h2
          id="requests-heading"
          className="font-heading text-xl font-semibold text-foreground md:text-2xl"
        >
          Demandes de financement
        </h2>
        {company.dossiers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune demande pour le moment.</p>
        ) : (
          <ul role="list" className="flex flex-col gap-3">
            {company.dossiers.map((d) => (
              <li key={d.id}>
                <RequestCard dossier={d} />
              </li>
            ))}
          </ul>
        )}
        <NewRequestForm companyId={company.id} />
      </section>
    </div>
  )
}

// E05.08: the signed-in conseiller holds this company for an entrepreneur until they accept it.
function PreparationNotice({ preparation }: { preparation: NonNullable<Company['preparation']> }) {
  const { workspace, invitation } = preparation
  const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')
  return (
    <section
      aria-labelledby="preparation-heading"
      className="mt-6 flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="preparation-heading" className="text-base font-medium text-foreground">
          Préparée pour un entrepreneur
        </h2>
        {invitation && (
          <Badge variant={invitation.status === 'pending' ? 'outline' : 'secondary'}>
            {COMPANY_TRANSFER_STATUS_LABELS[invitation.status]}
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Vous préparez cette entreprise dans le workspace{' '}
        <span className="text-foreground">{workspace.name}</span>. Elle ne peut être ni partagée
        ni publiée tant que son entrepreneur n’a pas accepté de la reprendre ; ensuite, elle sera la
        sienne et vous n’y aurez plus accès.
      </p>
      {invitation && (
        <p className="text-sm text-muted-foreground">
          Proposée à <span className="break-all text-foreground">{invitation.email}</span> le{' '}
          {date(invitation.invitedAt)}
          {invitation.status === 'pending'
            ? `, valable jusqu’au ${date(invitation.expiresAt)}.`
            : invitation.decidedAt
              ? ` · ${COMPANY_TRANSFER_STATUS_LABELS[invitation.status].toLowerCase()} le ${date(invitation.decidedAt)}.`
              : '.'}
        </p>
      )}
      <p className="text-sm">
        <Link
          to={`/workspaces/${encodeURIComponent(workspace.id)}`}
          className="underline underline-offset-4 hover:text-foreground"
        >
          Gérer la proposition dans le workspace
        </Link>
      </p>
    </section>
  )
}

function RequestCard({ dossier }: { dossier: CompanyDossier }) {
  const amount = formatAmount(dossier.amountEur)
  const types = financingTypeLabels(dossier.financingTypes)
  const status = publicationStatusOf(dossier.publicationStatus)
  return (
    <Link
      to={`/dashboard/dossiers/view/${encodeURIComponent(dossier.slug)}?tab=demande`}
      className="flex min-h-11 flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 wrap-anywhere text-base font-medium text-foreground">{dossier.name}</h3>
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant={status === 'published' ? 'default' : status === 'archived' ? 'outline' : 'secondary'}
          >
            {DOSSIER_PUBLICATION_STATUS_LABELS[status]}
          </Badge>
          {!dossier.submittedAt && <Badge variant="outline">Profil à soumettre</Badge>}
        </div>
      </div>
      {dossier.summary && (
        <p className="line-clamp-2 wrap-anywhere text-sm text-muted-foreground">{dossier.summary}</p>
      )}
      {(amount || types.length > 0) && (
        <p className="text-xs text-muted-foreground">
          {[amount, types.join(', ')].filter(Boolean).join(' · ')}
        </p>
      )}
    </Link>
  )
}

function NewRequestForm({ companyId }: { companyId: string }) {
  const navigate = useNavigate()
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = dossierNameSchema.safeParse(name)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Titre invalide.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await createCompanyDossier(companyId, { name: parsed.data })
      navigate(`/dashboard/dossiers/view/${encodeURIComponent(created.slug)}?tab=demande`)
    } catch (err) {
      const apiErr = err as Partial<ApiError> | undefined
      setError(
        apiErr?.status === undefined
          ? 'La demande n’a pas pu être créée : vérifiez votre connexion puis réessayez.'
          : (apiErr.message ?? 'La demande n’a pas été créée.'),
      )
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div>
        <Button type="button" className="h-11 px-4" onClick={() => setOpen(true)}>
          Nouvelle demande de financement
        </Button>
      </div>
    )
  }
  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        Titre de la nouvelle demande
      </label>
      <Input
        id={inputId}
        autoFocus
        className="h-11"
        value={name}
        maxLength={DOSSIER_PRESENTATION_LIMITS.name}
        placeholder="Par exemple : Levée de fonds 2027"
        onChange={(e) => setName(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : `${inputId}-help`}
      />
      <p id={`${inputId}-help`} className="text-xs text-muted-foreground">
        Elle reprend le profil et la bibliothèque de l’entreprise ; vous choisirez ensuite les
        documents qu’elle présente.
      </p>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-11 px-4" disabled={busy}>
          {busy ? 'Création…' : 'Créer la demande'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 px-4"
          disabled={busy}
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
        >
          Annuler
        </Button>
      </div>
    </form>
  )
}
