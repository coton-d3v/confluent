import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { CompanyTransferOffer } from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import { answerCompanyOffer, listCompanyOffers } from '@/features/company-transfers/api'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

const fromLabel = (offer: CompanyTransferOffer) => {
  if (!offer.from) return offer.workspace.name
  const name = [offer.from.firstName, offer.from.lastName].filter(Boolean).join(' ')
  return name ? `${name} (${offer.from.email})` : offer.from.email
}

// ROADMAP E05.08: the companies a conseiller prepared for the signed-in person, waiting for their
// answer. Nothing of a company's content is shown before it is accepted.
export default function CompanyOffersRoute() {
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const offers = useAsync(() => listCompanyOffers(), [])
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => headingRef.current?.focus(), [])

  function answer(offer: CompanyTransferOffer, decision: 'accept' | 'decline') {
    setBusyId(offer.id)
    setError(null)
    answerCompanyOffer(offer.id, decision)
      .then((result) => {
        if (result.status === 'accepted' && result.companyId) {
          toast.success(`${offer.company.name} est désormais votre entreprise.`)
          navigate(`/dashboard/entreprises/${encodeURIComponent(result.companyId)}`)
          return
        }
        toast.success(`Proposition pour ${offer.company.name} refusée.`)
        offers.refetch()
      })
      .catch((err: unknown) => {
        const apiError = err as Partial<ApiError> | undefined
        setError(
          apiError?.status === undefined
            ? 'Votre réponse n’a pas été enregistrée : vérifiez votre connexion puis réessayez.'
            : (apiError.message ?? 'Votre réponse n’a pas été enregistrée.'),
        )
        offers.refetch()
      })
      .finally(() => setBusyId(null))
  }

  const list = offers.data ?? []
  return (
    <div className="mx-auto max-w-[720px]">
      <title>Entreprises proposées · Confluent</title>
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
              Entreprises proposées
            </span>
          </li>
        </ol>
      </nav>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
      >
        Entreprises qui vous sont proposées
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Un conseiller d’une structure a préparé ces entreprises pour vous : leur profil, leurs
        documents et leurs demandes de financement. Si vous acceptez, l’entreprise devient la vôtre
        avec tout son contenu, et le conseiller n’y a plus accès. Si vous refusez, rien n’est
        rattaché à votre compte.
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {offers.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Chargement…</p>
      ) : offers.error ? (
        <p role="alert" className="mt-8 text-sm text-destructive">
          Impossible de charger les propositions. Réessayez plus tard.
        </p>
      ) : list.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Aucune proposition en attente.{' '}
          <Link to="/dashboard" className="underline underline-offset-4 hover:text-foreground">
            Retour à mes dossiers
          </Link>
        </p>
      ) : (
        <ul role="list" className="mt-6 flex flex-col gap-4">
          {list.map((offer) => (
            <li key={offer.id}>
              <article
                aria-labelledby={`offer-${offer.id}`}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
              >
                <div>
                  <h2
                    id={`offer-${offer.id}`}
                    className="font-heading text-lg font-semibold break-words text-foreground"
                  >
                    {offer.company.name}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {offer.dossierCount === 1 ? '1 demande' : `${offer.dossierCount} demandes`} de
                    financement · préparée par{' '}
                    <span className="break-all text-foreground">{fromLabel(offer)}</span> pour{' '}
                    <span className="text-foreground">{offer.workspace.name}</span>
                    {offer.workspace.programName ? ` (${offer.workspace.programName})` : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Proposée le {dateFr(offer.invitedAt)} · à accepter avant le{' '}
                    {dateFr(offer.expiresAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="h-11 px-4"
                    disabled={busyId !== null}
                    onClick={() =>
                      setConfirm({
                        title: `Devenir propriétaire de ${offer.company.name} ?`,
                        description:
                          'L’entreprise, ses demandes de financement, son profil et ses documents deviennent les vôtres ; le conseiller n’y aura plus accès. Vos autres entreprises ne changent pas.',
                        confirmLabel: 'Accepter',
                        onConfirm: () => answer(offer, 'accept'),
                      })
                    }
                  >
                    {busyId === offer.id ? 'Enregistrement…' : 'Accepter'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    disabled={busyId !== null}
                    onClick={() =>
                      setConfirm({
                        title: `Refuser ${offer.company.name} ?`,
                        description:
                          'Rien ne sera rattaché à votre compte ; l’entreprise reste au conseiller qui l’a préparée.',
                        confirmLabel: 'Refuser',
                        onConfirm: () => answer(offer, 'decline'),
                      })
                    }
                  >
                    Refuser
                  </Button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}
