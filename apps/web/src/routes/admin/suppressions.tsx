import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  ACCOUNT_DELETION_BLOCKER_LABELS,
  ACCOUNT_DELETION_NOTE_MAX,
  ACCOUNT_DELETION_STATUS_LABELS,
  type AccountDeletionBlockerView,
} from '@confluent/shared'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { LoadError } from '@/components/confluent/LoadError'
import { useAuthState } from '@/features/current-user/context'
import {
  completeDeletionRequest,
  declineDeletionRequest,
  listDeletionRequests,
  type AdminDeletionRequest,
} from '@/features/privacy/api'
import type { ApiError } from '@/lib/api-client'
import { readFailure } from '@/lib/read-failure'
import { useAsync } from '@/lib/useAsync'

const formatMoment = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const SUMMARY_LABELS: Record<string, string> = {
  companies: 'entreprise(s)',
  requests: 'demande(s)',
  documents: 'version(s) de documents',
  closedCandidatures: 'candidature(s) close(s)',
  investorPositions: 'marque(s) d’intérêt et promesse(s)',
  memberships: 'appartenance(s)',
  connectedApplications: 'application(s) IA',
  sharesReceived: 'partage(s) reçu(s) révoqué(s)',
  publicFormRequests: 'demande(s) de formulaire public',
  journalEntriesPseudonymized: 'entrée(s) de journal pseudonymisée(s)',
}

type Action = { kind: 'complete' | 'decline'; request: AdminDeletionRequest }

// Why a decision was refused because the request changed meanwhile (`409`, `404`).
function conflictReason(err: unknown): string {
  const e = err as Partial<ApiError> | undefined
  if (e?.status === 409 && Array.isArray(e.details)) {
    return 'ce compte ne peut pas encore être supprimé, des demandes sont encore partagées ou présentées à une structure.'
  }
  if (e?.status === 404) return 'cette demande n’existe plus.'
  return 'cette demande a déjà été traitée ou retirée, ou c’est la vôtre.'
}

function actionFailure(err: unknown): string {
  const e = err as Partial<ApiError> | undefined
  if (e?.status === undefined) {
    return 'La décision n’a pas pu être confirmée : le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.'
  }
  if (e.status === 400) return 'La note est requise (1 000 caractères au plus).'
  if (e.status === 401) return 'Votre session a expiré : reconnectez-vous, puis réessayez.'
  return 'La décision n’a pas pu être confirmée : le serveur est momentanément indisponible. Réessayez.'
}

function Blockers({ blockers }: { blockers: AccountDeletionBlockerView[] }) {
  return (
    <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
      {blockers.map((b, i) => (
        <li key={`${b.kind}-${i}`}>
          {ACCOUNT_DELETION_BLOCKER_LABELS[b.kind]}
          {b.subject ? <span className="font-medium"> {b.subject}</span> : null}
        </li>
      ))}
    </ul>
  )
}

// ROADMAP E10.10 — the administrators' queue of deletion requests: what processing each one would
// delete and what blocks it, read now; delete (after a confirmation that says what is kept) or
// decline with a note the person reads. A decision is shown in progress, never sent twice, retried
// in place after an error; the queue is read again after each answer (R70), and a failed reading is
// shown with « Réessayer », the decisions unavailable meanwhile (R71).
export default function AdminDeletionRequestsRoute() {
  const { user } = useAuthState()
  const [tab, setTab] = useState<'pending' | 'decided'>('pending')
  const query = useAsync(() => listDeletionRequests(tab), [tab])
  const [action, setAction] = useState<Action | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  // R77: a decision refused because the request changed (`409`, `404`) closes its confirmation — its
  // context is stale — and the queue is read again; a new decision waits for that reading to succeed
  // (`reread`: requested, then loading, then done), and only then is it said to be read again.
  const [conflict, setConflict] = useState<string | null>(null)
  // `failed`: that reading failed — its « Réessayer » reads again, never decides.
  const [reread, setReread] = useState<'requested' | 'loading' | 'failed' | null>(null)
  const inFlight = useRef(false)

  useEffect(() => {
    if ((reread === 'requested' || reread === 'failed') && query.isLoading) setReread('loading')
    else if (reread === 'loading' && !query.isLoading) {
      if (query.error) {
        setReread('failed')
        return
      }
      setReread(null)
      setConflict(
        (current) =>
          current &&
          `${current} La liste a été relue : vérifiez la demande avant de décider à nouveau.`,
      )
    }
  }, [reread, query.isLoading, query.error])

  if (user && user.role !== 'admin') return <Navigate to="/dashboard" replace />

  async function decide() {
    if (!action || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setFailure(null)
    try {
      const who = action.request.account?.email ?? action.request.subjectRef
      if (action.kind === 'complete') {
        const done = await completeDeletionRequest(action.request.id)
        setStatus(
          `Compte ${who} supprimé (désormais « ${done.subjectRef} »). ${
            done.confirmationEmail === 'sent'
              ? 'L’email de confirmation est parti.'
              : 'L’email de confirmation n’a pas pu partir : prévenez la personne autrement.'
          }`,
        )
      } else {
        await declineDeletionRequest(action.request.id, note.trim())
        setStatus(`Demande de ${who} refusée : la personne est notifiée et lit votre note.`)
      }
      setAction(null)
      setNote('')
      query.refetch()
    } catch (err) {
      const e = err as Partial<ApiError>
      if (e.status === 409 || e.status === 404) {
        // Stale: never sent again from this confirmation.
        setAction(null)
        setNote('')
        setConflict(`La décision n’a pas été appliquée : ${conflictReason(err)}`)
        setReread('requested')
        query.refetch()
      } else {
        setFailure(actionFailure(err))
      }
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const list = query.data ?? []
  const blocked = query.error !== null && query.error !== undefined

  return (
    <>
      <title>Demandes de suppression · Confluent</title>
      <h1 className="font-heading text-2xl font-semibold text-foreground md:text-[28px]">
        Demandes de suppression de compte
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        Une demande n’est traitée que si le compte n’a plus de demande partagée ou présentée à une
        structure. Le traitement supprime le compte et tout ce qu’il détient ; le journal garde les
        faits sans le nommer, les structures leurs notes et décisions (
        <Link to="/confidentialite#vos-droits" className="underline underline-offset-4">
          règle publiée
        </Link>
        ).
      </p>
      <div role="tablist" aria-label="Demandes" className="mt-6 flex gap-2">
        {(['pending', 'decided'] as const).map((t) => (
          <Button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            variant={tab === t ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setTab(t)
              setStatus(null)
              setConflict(null)
            }}
          >
            {t === 'pending' ? 'À traiter' : 'Décidées'}
          </Button>
        ))}
      </div>
      <div aria-live="assertive">
        {conflict && (
          <p role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            {conflict}
          </p>
        )}
      </div>
      <div aria-live="polite">
        {status && (
          <p role="status" className="mt-4 rounded-md border border-border bg-muted px-4 py-3 text-sm">
            {status}
          </p>
        )}
      </div>

      {(query.isLoading && !query.data) || reread === 'requested' || reread === 'loading' ? (
        <p className="mt-6 text-sm text-muted-foreground">Chargement…</p>
      ) : blocked || reread === 'failed' ? (
        <LoadError
          className="mt-6"
          message={readFailure(query.error, 'Les demandes de suppression n’ont pas pu être chargées.')}
          onRetry={query.refetch}
          retrying={query.isLoading}
        />
      ) : list.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {tab === 'pending' ? 'Aucune demande à traiter.' : 'Aucune demande décidée.'}
        </p>
      ) : (
        <ul role="list" className="mt-6 flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {list.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 p-4 text-sm">
              <h2 className="wrap-anywhere font-medium text-foreground">
                {r.account ? `${r.account.name ?? r.account.email} — ${r.account.email}` : r.subjectRef}
              </h2>
              <p className="text-muted-foreground">
                {ACCOUNT_DELETION_STATUS_LABELS[r.status]} · demandée le {formatMoment(r.requestedAt)}
                {r.decidedAt ? ` · décidée le ${formatMoment(r.decidedAt)}` : ''}
                {r.account ? ` · rôle ${r.account.role}` : ''}
              </p>
              {r.declineNote && (
                <p className="whitespace-pre-line wrap-anywhere">Note : {r.declineNote}</p>
              )}
              {r.summary && (
                <p className="text-muted-foreground">
                  Supprimé :{' '}
                  {Object.entries(r.summary)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => `${n} ${SUMMARY_LABELS[k] ?? k}`)
                    .join(', ')}
                  {r.confirmationEmail === 'failed' ? ' · email de confirmation en échec' : ''}
                  {r.confirmationEmail === 'sent' ? ' · email de confirmation envoyé' : ''}
                </p>
              )}
              {r.impact && (
                <>
                  <p className="text-muted-foreground">
                    Supprimerait : {r.impact.companies} entreprise(s), {r.impact.requests} demande(s),{' '}
                    {r.impact.documents} version(s) de documents, {r.impact.closedCandidatures}{' '}
                    candidature(s) close(s), {r.impact.investorPositions} positionnement(s),{' '}
                    {r.impact.memberships} appartenance(s), {r.impact.connectedApplications}{' '}
                    application(s) IA ; révoquerait {r.impact.sharesReceived} partage(s) reçu(s).
                  </p>
                  {r.impact.blockers.length > 0 && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                      <p className="font-medium">Bloquée tant que :</p>
                      <Blockers blockers={r.impact.blockers} />
                    </div>
                  )}
                </>
              )}
              {r.status === 'pending' && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={
                      busy ||
                      reread !== null ||
                      r.account?.id === user?.id ||
                      (r.impact?.blockers.length ?? 0) > 0
                    }
                    onClick={() => {
                      setFailure(null)
                      setConflict(null)
                      setAction({ kind: 'complete', request: r })
                    }}
                  >
                    Supprimer le compte
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || reread !== null || r.account?.id === user?.id}
                    onClick={() => {
                      setFailure(null)
                      setNote('')
                      setConflict(null)
                      setAction({ kind: 'decline', request: r })
                    }}
                  >
                    Refuser
                  </Button>
                  {r.account?.id === user?.id && (
                    <span className="self-center text-muted-foreground">
                      Votre propre demande : un autre administrateur la traite.
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setAction(null)
            setFailure(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action?.kind === 'complete'
                ? `Supprimer le compte ${action.request.account?.email ?? ''} ?`
                : `Refuser la demande de ${action?.request.account?.email ?? ''} ?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {action?.kind === 'complete'
                ? 'Définitif : le compte, ses entreprises, demandes, réponses, documents, positionnements, appartenances, sessions et applications connectées sont supprimés. Le journal garde les faits sans le nommer ; les structures gardent leurs notes et décisions. Un email de confirmation part à son adresse.'
                : 'La personne est notifiée et lit votre note dans « Mes données » ; son compte est conservé.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {action?.kind === 'decline' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="decline-note" className="text-sm font-medium text-foreground">
                Note à la personne
              </label>
              <Textarea
                id="decline-note"
                value={note}
                maxLength={ACCOUNT_DELETION_NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
                rows={4}
              />
            </div>
          )}
          <div aria-live="assertive">
            {failure && (
              <p role="alert" className="text-sm text-destructive">
                {failure}
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || (action?.kind === 'decline' && note.trim().length === 0)}
              aria-busy={busy}
              onClick={() => void decide()}
            >
              {busy
                ? 'Traitement en cours…'
                : failure
                  ? 'Réessayer'
                  : action?.kind === 'complete'
                    ? 'Oui, supprimer le compte'
                    : 'Refuser la demande'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
