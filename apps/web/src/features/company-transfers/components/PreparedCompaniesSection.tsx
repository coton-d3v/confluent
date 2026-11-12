import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  COMPANY_TRANSFER_STATUS_LABELS,
  companyOwnerEmailSchema,
  prepareCompanySchema,
  type PreparedCompany,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import {
  inviteCompanyOwner,
  listPreparedCompanies,
  prepareCompany,
  withdrawCompanyInvitation,
} from '../api'

const dateFr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '')

const personLabel = (p: { email: string; firstName: string | null; lastName: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email

const failureMessage = (err: unknown, fallback: string) => {
  const apiError = err as Partial<ApiError> | undefined
  return apiError?.status === undefined
    ? `${fallback} Vérifiez votre connexion puis réessayez.`
    : (apiError.message ?? fallback)
}

// ROADMAP E05.08, on a workspace's page for its conseillers: prepare a company for an entrepreneur,
// follow the invitations and act on the companies one holds. The API checks every action.
export function PreparedCompaniesSection({ workspaceId }: { workspaceId: string }) {
  const query = useAsync(() => listPreparedCompanies(workspaceId), [workspaceId])
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const held = (query.data ?? []).filter((p) => p.held)
  const transferred = (query.data ?? []).filter((p) => !p.held)

  return (
    <section aria-labelledby="prepared-title" className="flex flex-col gap-4">
      <div>
        <h2 id="prepared-title" className="font-heading text-lg font-semibold text-foreground">
          Entreprises préparées pour des entrepreneurs
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Préparez le profil, les documents et les demandes de financement d’une entreprise, puis
          proposez à son entrepreneur d’en devenir propriétaire. D’ici là, vous seul la complétez,
          et elle ne peut être ni partagée ni publiée. S’il accepte, elle devient la sienne et vous
          n’y avez plus accès ; s’il refuse, elle reste à vous.
        </p>
      </div>

      <PrepareCompanyForm workspaceId={workspaceId} />

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : query.error ? (
        <p role="alert" className="text-sm text-destructive">
          Impossible de charger les entreprises préparées. Réessayez plus tard.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-foreground">En préparation</h3>
            {held.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune entreprise en préparation.</p>
            ) : (
              <ul role="list" className="flex flex-col gap-3">
                {held.map((p) => (
                  <li key={p.company.id}>
                    <HeldCompanyCard
                      workspaceId={workspaceId}
                      preparation={p}
                      onChanged={query.refetch}
                      onConfirm={setConfirm}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {transferred.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">
                Reprises par leur entrepreneur
              </h3>
              <ul role="list" className="flex flex-col gap-2">
                {transferred.map((p) => (
                  <li
                    key={p.company.id}
                    className="rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground"
                  >
                    <span className="font-medium wrap-anywhere text-foreground">
                      {p.company.name}
                    </span>
                    {' — '}acceptée par <span className="break-all">{p.invitation.email}</span> le{' '}
                    {dateFr(p.invitation.decidedAt)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </section>
  )
}

function PrepareCompanyForm({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate()
  const ids = { name: useId(), email: useId() }
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState({ companyName: '', ownerEmail: '' })
  const [errors, setErrors] = useState<{ companyName?: string; ownerEmail?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = prepareCompanySchema.safeParse(values)
    if (!parsed.success) {
      const found: typeof errors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof typeof errors
        found[key] ??= issue.message
      }
      setErrors(found)
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const created = await prepareCompany(workspaceId, parsed.data)
      if (created.invitationEmailSent) {
        toast.success(`Entreprise créée ; proposition envoyée à ${parsed.data.ownerEmail}.`)
      } else {
        toast.warning(
          `Entreprise créée et proposition enregistrée, mais l’email à ${parsed.data.ownerEmail} n’a pas pu partir : renvoyez l’invitation plus tard.`,
        )
      }
      navigate(`/dashboard/entreprises/${encodeURIComponent(created.preparation.company.id)}`)
    } catch (err) {
      const apiError = err as Partial<ApiError> | undefined
      const details = (apiError?.details ?? []) as Array<{ path?: unknown[]; message?: string }>
      const onEmail = details.find((d) => d.path?.[0] === 'email' || d.path?.[0] === 'ownerEmail')
      if (onEmail?.message) setErrors({ ownerEmail: apiError?.message ?? onEmail.message })
      else setFormError(failureMessage(err, 'L’entreprise n’a pas été créée.'))
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div>
        <Button type="button" className="h-11 px-4" onClick={() => setOpen(true)}>
          Préparer une entreprise
        </Button>
      </div>
    )
  }
  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-label="Préparer une entreprise pour un entrepreneur"
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.name}>Nom de l’entreprise</Label>
        <Input
          id={ids.name}
          autoFocus
          className="h-11"
          value={values.companyName}
          onChange={(e) => {
            setValues((v) => ({ ...v, companyName: e.target.value }))
            setErrors((x) => ({ ...x, companyName: undefined }))
          }}
          aria-invalid={errors.companyName ? true : undefined}
          aria-describedby={errors.companyName ? `${ids.name}-error` : undefined}
        />
        {errors.companyName && (
          <p id={`${ids.name}-error`} className="text-xs text-destructive">
            {errors.companyName}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.email}>Adresse email de l’entrepreneur</Label>
        <Input
          id={ids.email}
          type="email"
          autoComplete="off"
          className="h-11"
          value={values.ownerEmail}
          onChange={(e) => {
            setValues((v) => ({ ...v, ownerEmail: e.target.value }))
            setErrors((x) => ({ ...x, ownerEmail: undefined }))
          }}
          aria-invalid={errors.ownerEmail ? true : undefined}
          aria-describedby={`${ids.email}-help${errors.ownerEmail ? ` ${ids.email}-error` : ''}`}
        />
        <p id={`${ids.email}-help`} className="text-xs text-muted-foreground">
          Il reçoit une proposition par email (un compte est ouvert pour lui s’il n’en a pas) et
          l’accepte ou la refuse dans Confluent, sous 30 jours.
        </p>
        {errors.ownerEmail && (
          <p id={`${ids.email}-error`} className="text-xs text-destructive">
            {errors.ownerEmail}
          </p>
        )}
      </div>
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-11 px-4" disabled={busy}>
          {busy ? 'Création…' : 'Créer et envoyer la proposition'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 px-4"
          disabled={busy}
          onClick={() => {
            setOpen(false)
            setErrors({})
            setFormError(null)
          }}
        >
          Annuler
        </Button>
      </div>
    </form>
  )
}

function HeldCompanyCard({
  workspaceId,
  preparation,
  onChanged,
  onConfirm,
}: {
  workspaceId: string
  preparation: PreparedCompany
  onChanged: () => void
  onConfirm: (request: ConfirmRequest) => void
}) {
  const { company, invitation, heldByMe, holder } = preparation
  const emailId = useId()
  const [inviting, setInviting] = useState(false)
  const [email, setEmail] = useState(invitation.email)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = invitation.status === 'pending'

  async function invite(e: FormEvent) {
    e.preventDefault()
    const parsed = companyOwnerEmailSchema.safeParse(email)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Adresse invalide.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const sent = await inviteCompanyOwner(workspaceId, company.id, parsed.data)
      if (sent.invitationEmailSent) toast.success(`Proposition envoyée à ${parsed.data}.`)
      else toast.warning(`Proposition enregistrée, mais l’email n’a pas pu partir.`)
      setInviting(false)
      onChanged()
    } catch (err) {
      setError(failureMessage(err, 'La proposition n’a pas été envoyée.'))
    } finally {
      setBusy(false)
    }
  }

  function withdraw() {
    onConfirm({
      title: 'Retirer la proposition ?',
      description: `${invitation.email} ne pourra plus l’accepter. L’entreprise reste à vous ; vous pourrez envoyer une nouvelle proposition.`,
      confirmLabel: 'Retirer',
      onConfirm: () => {
        withdrawCompanyInvitation(workspaceId, company.id)
          .then(() => {
            toast.success('Proposition retirée.')
            onChanged()
          })
          .catch((err: unknown) =>
            toast.error(failureMessage(err, 'La proposition n’a pas été retirée.')),
          )
      },
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium wrap-anywhere text-foreground">{company.name}</p>
          <p className="text-xs text-muted-foreground">
            {preparation.dossierCount === 1
              ? '1 demande'
              : `${preparation.dossierCount ?? 0} demandes`}
            {holder && !heldByMe && ` · préparée par ${personLabel(holder)}`}
          </p>
        </div>
        <Badge variant={pending ? 'outline' : 'secondary'}>
          {COMPANY_TRANSFER_STATUS_LABELS[invitation.status]}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Proposée à <span className="break-all text-foreground">{invitation.email}</span> le{' '}
        {dateFr(invitation.invitedAt)}
        {pending
          ? ` · valable jusqu’au ${dateFr(invitation.expiresAt)}`
          : invitation.decidedAt
            ? ` · ${COMPANY_TRANSFER_STATUS_LABELS[invitation.status].toLowerCase()} le ${dateFr(invitation.decidedAt)}`
            : ''}
      </p>
      {heldByMe && !inviting && (
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/dashboard/entreprises/${encodeURIComponent(company.id)}`}
            className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            Ouvrir
          </Link>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            onClick={() => {
              setEmail(invitation.email)
              setError(null)
              setInviting(true)
            }}
          >
            {pending ? 'Renvoyer ou changer d’adresse' : 'Envoyer une nouvelle proposition'}
          </Button>
          {pending && (
            <Button type="button" variant="outline" className="h-11 px-4" onClick={withdraw}>
              Retirer la proposition
            </Button>
          )}
        </div>
      )}
      {heldByMe && inviting && (
        <form onSubmit={(e) => void invite(e)} noValidate className="flex flex-col gap-2">
          <Label htmlFor={emailId}>Adresse email de l’entrepreneur</Label>
          <Input
            id={emailId}
            type="email"
            autoFocus
            className="h-11"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError(null)
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${emailId}-error` : undefined}
          />
          {pending && (
            <p className="text-xs text-muted-foreground">
              La proposition en attente sera remplacée par la nouvelle.
            </p>
          )}
          {error && (
            <p id={`${emailId}-error`} role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="h-11 px-4" disabled={busy}>
              {busy ? 'Envoi…' : 'Envoyer la proposition'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              disabled={busy}
              onClick={() => setInviting(false)}
            >
              Annuler
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
