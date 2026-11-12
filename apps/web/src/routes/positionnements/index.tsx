import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ACCESS_LEVEL_LABELS,
  PLEDGE_INTENTION_LABELS,
  PLEDGE_NON_COMMITMENT,
  type MyPosition,
} from '@confluent/shared'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatAmount } from '@/features/dossiers/presentation'
import { withdrawInterest } from '@/features/interests/api'
import { withdrawPledge } from '@/features/pledges/api'
import { getMyPositions, withdrawDisclosure } from '@/features/positions/api'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { readFailure } from '@/lib/read-failure'
import { LoadError } from '@/components/confluent/LoadError'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

function failure(err: unknown, what: string): string {
  const e = err as Partial<ApiError> | undefined
  if (e?.status === undefined) return `${what} Vérifiez votre connexion puis réessayez.`
  return e.message ?? what
}

// ROADMAP E07.07: « Mes positionnements » — the signed-in investor's own marks of interest, pledges
// and consents to structures, request by request, with where each request stands now. A request
// they no longer read shows nothing of itself (the API gives none of it): only their own data, which
// they may withdraw here, the opportunity's page being closed to them.
export default function PositionsRoute() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const query = useAsync(() => getMyPositions(), [])
  const data = query.data
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => headingRef.current?.focus(), [])

  async function act(run: () => Promise<void>, done: string, what: string) {
    setBusy(true)
    try {
      await run()
      toast.success(done)
      query.refetch()
    } catch (err) {
      toast.error(failure(err, what))
    } finally {
      setBusy(false)
    }
  }

  const pledges = (data?.items ?? []).flatMap((i) => (i.pledge ? [i.pledge] : []))
  const counted = (data?.items ?? []).filter((i) => i.readable && i.pledge)
  const countedTotal = counted.reduce((sum, i) => sum + (i.pledge?.amountEur ?? 0), 0)

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-5">
      <title>Mes positionnements · Confluent</title>
      <div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
        >
          Mes positionnements
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Vos marques d’intérêt et vos promesses, demande par demande. Chacune compte pour le
          porteur tant que vous lisez la demande, avec seulement ce que vous avez choisi de lui
          montrer. Aucun autre investisseur ne les voit ; une structure, seulement si vous avez
          choisi de lui montrer votre positionnement. {PLEDGE_NON_COMMITMENT}
        </p>
      </div>

      {query.isLoading && !data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : !data ? (
        <LoadError
          message={readFailure(query.error, 'Vos positionnements n’ont pas pu être chargés.')}
          onRetry={query.refetch}
          retrying={query.isLoading}
        />
      ) : data.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center">
          <h2 className="text-base font-medium text-foreground">
            Aucun positionnement pour l’instant
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Marquez votre intérêt ou faites une promesse depuis la fiche d’une{' '}
            <Link to="/opportunites" className="text-foreground underline underline-offset-4">
              opportunité
            </Link>{' '}
            : vous les retrouverez ici.
          </p>
        </div>
      ) : (
        <>
          {pledges.length > 0 && (
            <p className="text-sm text-foreground">
              {pledges.length === 1 ? '1 promesse' : `${pledges.length} promesses`}
              {counted.length > 0 &&
                ` — ${formatAmount(countedTotal)} sur les demandes que vous lisez encore`}
              .
            </p>
          )}
          <ul role="list" className="flex flex-col gap-3">
            {data.items.map((item) => (
              <PositionCard
                key={item.dossierId}
                item={item}
                busy={busy}
                onWithdrawInterest={() =>
                  void act(
                    () => withdrawInterest(item.dossierId),
                    'Votre marque d’intérêt est retirée.',
                    'Le retrait n’a pas été enregistré.',
                  )
                }
                onWithdrawPledge={() =>
                  setConfirm({
                    title: 'Retirer votre promesse ?',
                    description:
                      'Le porteur ne la comptera plus. Vous ne pourrez en faire une nouvelle que si vous lisez de nouveau cette demande.',
                    confirmLabel: 'Retirer ma promesse',
                    onConfirm: () =>
                      void act(
                        () => withdrawPledge(item.dossierId),
                        'Votre promesse est retirée.',
                        'Le retrait n’a pas été enregistré.',
                      ),
                  })
                }
                onWithdrawDisclosure={(id, name) =>
                  void act(
                    () => withdrawDisclosure(id),
                    `${name} ne voit plus votre positionnement.`,
                    'Votre choix n’a pas été enregistré.',
                  )
                }
              />
            ))}
          </ul>
        </>
      )}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}

function PositionCard({
  item,
  busy,
  onWithdrawInterest,
  onWithdrawPledge,
  onWithdrawDisclosure,
}: {
  item: MyPosition
  busy: boolean
  onWithdrawInterest: () => void
  onWithdrawPledge: () => void
  onWithdrawDisclosure: (id: string, name: string) => void
}) {
  const { interest, pledge } = item
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {item.readable && item.dossier ? (
          <Link
            to={`/opportunites/${encodeURIComponent(item.dossierId)}`}
            className="min-w-0 wrap-anywhere text-base font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            {item.dossier.name}
          </Link>
        ) : (
          <span className="min-w-0 text-base font-medium text-foreground">
            Demande que vous ne lisez plus
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          {item.accessLevel && (
            <Badge variant="outline">
              Accès {ACCESS_LEVEL_LABELS[item.accessLevel].toLowerCase()}
            </Badge>
          )}
          {item.closed && <Badge variant="outline">Demande archivée</Badge>}
        </div>
      </div>
      {!item.readable && (
        <p className="text-sm text-muted-foreground">
          Le partage a pu être révoqué, la publication retirée du vivier ou mise en pause, ou votre
          accès à la structure terminé. Le porteur ne compte plus votre positionnement tant que cela
          dure ; vous pouvez le retirer.
        </p>
      )}

      <dl className="grid grid-cols-1 gap-x-3 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        {interest && (
          <>
            <dt className="text-muted-foreground">Intérêt</dt>
            <dd className="wrap-anywhere text-foreground">
              Marqué le {dateFr(interest.markedAt)} —{' '}
              {interest.nameVisible ? 'nom montré au porteur' : 'nom non montré au porteur'}
            </dd>
          </>
        )}
        {pledge && (
          <>
            <dt className="text-muted-foreground">Promesse</dt>
            <dd className="flex min-w-0 flex-col gap-0.5 text-foreground">
              <span className="wrap-anywhere">
                {formatAmount(pledge.amountEur)} — intention «{' '}
                {PLEDGE_INTENTION_LABELS[pledge.intention]} » — faite le {dateFr(pledge.pledgedAt)}
                {dateFr(pledge.updatedAt) !== dateFr(pledge.pledgedAt) &&
                  `, modifiée le ${dateFr(pledge.updatedAt)}`}
              </span>
              <span className="wrap-anywhere text-muted-foreground">
                {pledge.showName || pledge.showAmount
                  ? `Le porteur voit ${[pledge.showName && 'votre nom', pledge.showAmount && 'votre montant'].filter(Boolean).join(' et ')}.`
                  : 'Le porteur la compte dans le total, sans votre nom ni votre montant.'}
              </span>
              {pledge.comment && (
                <span className="wrap-anywhere whitespace-pre-line text-muted-foreground">
                  Votre commentaire, pour vous seul : {pledge.comment}
                </span>
              )}
            </dd>
          </>
        )}
        {item.disclosures.length > 0 && (
          <>
            <dt className="text-muted-foreground">Structures</dt>
            <dd className="flex min-w-0 flex-col gap-1.5">
              {item.disclosures.map((d) => (
                <span key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="wrap-anywhere text-foreground">
                    Montré à {d.workspace.name} depuis le {dateFr(d.disclosedAt)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-9"
                    disabled={busy}
                    onClick={() => onWithdrawDisclosure(d.id, d.workspace.name)}
                  >
                    Ne plus montrer
                  </Button>
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>

      {item.readable ? (
        <Link
          to={`/opportunites/${encodeURIComponent(item.dossierId)}`}
          className="self-start text-sm font-medium text-foreground underline underline-offset-4"
        >
          Modifier depuis la fiche de l’opportunité
        </Link>
      ) : (
        (interest || pledge) && (
          <div className="flex flex-wrap gap-2">
            {interest && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={onWithdrawInterest}
              >
                Retirer ma marque d’intérêt
              </Button>
            )}
            {pledge && !item.closed && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={onWithdrawPledge}
              >
                Retirer ma promesse
              </Button>
            )}
            {pledge && item.closed && (
              <p className="text-sm text-muted-foreground">
                La demande est archivée : votre promesse est close, elle ne peut plus être retirée.
              </p>
            )}
          </div>
        )
      )}
    </li>
  )
}
