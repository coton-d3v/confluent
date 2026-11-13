import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ACCOUNT_DELETION_BLOCKER_LABELS,
  ACCOUNT_DELETION_STATUS_LABELS,
  EXPORT_LIMITS,
  type AccountDeletionImpact,
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
import { LoadError } from '@/components/confluent/LoadError'
import {
  cancelAccountDeletion,
  exportMyData,
  getMyDeletionRequest,
  requestAccountDeletion,
  saveExport,
  type MyDeletionRequest,
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

// Why an action failed, said in French, never the server's internal message — except a refusal the
// server explains for this very action (a limit, a request already decided).
function actionFailure(err: unknown, what: string): string {
  const e = err as Partial<ApiError> | undefined
  if (e?.status === undefined) {
    return `${what} : le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.`
  }
  if (e.status === 401) return `${what} : votre session a expiré. Reconnectez-vous, puis réessayez.`
  if (e.status === 429) {
    const minutes = e.retryAfter ? Math.ceil(e.retryAfter / 60) : null
    return `${what} : vous avez déjà téléchargé vos données ${EXPORT_LIMITS.perAccount} fois dans l’heure.${
      minutes ? ` Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.` : ''
    }`
  }
  if (e.status >= 500) return `${what} : le serveur est momentanément indisponible. Réessayez.`
  return `${what} (erreur ${e.status}).`
}

// ROADMAP E10.10 — the signed-in person's data: download it, and ask for the deletion of their
// account (an administrator processes the request; what blocks it is listed with where to withdraw
// it). Each action is shown in progress, never sent twice, retried in place after an error, and
// announced only once the server answered.
export default function MyDataRoute() {
  return (
    <>
      <title>Mes données · Confluent</title>
      <h1 className="font-heading text-2xl font-medium text-foreground md:text-[28px]">
        Mes données
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Téléchargez ce que Confluent conserve sur vous, ou demandez la suppression de votre compte.
        Les durées de conservation sont indiquées dans la{' '}
        <Link to="/confidentialite#conservation" className="underline underline-offset-4">
          politique de confidentialité
        </Link>
        .
      </p>
      <ExportSection />
      <DeletionSection />
    </>
  )
}

function ExportSection() {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const inFlight = useRef(false)

  async function download() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setFailure(null)
    setDone(null)
    try {
      const data = await exportMyData()
      const filename = saveExport(data)
      setDone(`Fichier « ${filename} » préparé le ${formatMoment(data.exportedAt)}.`)
    } catch (err) {
      setFailure(actionFailure(err, 'Vos données n’ont pas pu être téléchargées'))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="export-title" className="mt-8 max-w-2xl rounded-lg border border-border bg-card p-4">
      <h2 id="export-title" className="font-heading text-lg font-medium text-foreground">
        Télécharger mes données
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Un fichier JSON avec votre compte, vos entreprises, demandes et réponses, la liste de vos
        documents (les fichiers se téléchargent depuis la bibliothèque), vos partages donnés et
        reçus, vos positionnements, appartenances, notifications, applications connectées et votre
        propre activité. Jamais les données d’une autre personne. {EXPORT_LIMITS.perAccount}{' '}
        téléchargements par heure au plus.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void download()} disabled={busy} aria-busy={busy}>
          {busy ? 'Préparation du fichier…' : failure ? 'Réessayer le téléchargement' : 'Télécharger mes données'}
        </Button>
      </div>
      <div aria-live="polite" className="mt-3 text-sm">
        {done && (
          <p role="status" className="text-foreground">
            {done}
          </p>
        )}
        {failure && (
          <p role="alert" className="text-destructive">
            {failure}
          </p>
        )}
      </div>
    </section>
  )
}

function ImpactList({ impact }: { impact: AccountDeletionImpact }) {
  const lines = [
    [impact.companies, 'entreprise(s)'],
    [impact.requests, 'demande(s) de financement'],
    [impact.documents, 'version(s) de documents'],
    [impact.closedCandidatures, 'candidature(s) close(s)'],
    [impact.investorPositions, 'marque(s) d’intérêt et promesse(s)'],
    [impact.memberships, 'appartenance(s) à un workspace'],
    [impact.connectedApplications, 'application(s) IA connectée(s)'],
  ] as const
  return (
    <ul className="mt-1 list-disc pl-5">
      {lines.map(([n, label]) => (
        <li key={label}>
          {n} {label}
        </li>
      ))}
    </ul>
  )
}

function DeletionSection() {
  const query = useAsync(() => getMyDeletionRequest(), [])
  // The server's answer to the last action, until the list is read again.
  const [answered, setAnswered] = useState<MyDeletionRequest | null | undefined>(undefined)
  const current = answered !== undefined ? answered : query.data
  const [confirming, setConfirming] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState<'request' | 'cancel' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const inFlight = useRef(false)

  async function act(kind: 'request' | 'cancel') {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(kind)
    setFailure(null)
    setStatus(null)
    try {
      const result = kind === 'request' ? await requestAccountDeletion() : await cancelAccountDeletion()
      setAnswered(result)
      setConfirming(false)
      setUnderstood(false)
      setStatus(
        kind === 'request'
          ? `Demande enregistrée le ${formatMoment(result.requestedAt)} : un administrateur la traitera.`
          : 'Votre demande de suppression est retirée : votre compte est conservé.',
      )
    } catch (err) {
      const e = err as Partial<ApiError>
      if (kind === 'cancel' && e.status === 404) {
        // Already decided meanwhile: read the state again rather than guess it.
        setAnswered(undefined)
        query.refetch()
        setFailure('Cette demande n’est plus en attente : son état a été relu ci-dessous.')
      } else {
        setFailure(
          actionFailure(
            err,
            kind === 'request'
              ? 'Votre demande n’a pas pu être enregistrée'
              : 'Votre demande n’a pas pu être retirée',
          ),
        )
      }
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  const pending = current?.status === 'pending'

  return (
    <section aria-labelledby="deletion-title" className="mt-8 max-w-2xl rounded-lg border border-border bg-card p-4">
      <h2 id="deletion-title" className="font-heading text-lg font-medium text-foreground">
        Supprimer mon compte
      </h2>
      <div aria-live="polite" className="text-sm">
        {status && (
          <p role="status" className="mt-2 text-foreground">
            {status}
          </p>
        )}
      </div>
      {query.isLoading && current === undefined ? (
        <p className="mt-2 text-sm text-muted-foreground">Chargement…</p>
      ) : query.error && answered === undefined ? (
        <LoadError
          className="mt-3"
          message={readFailure(query.error, 'L’état de votre demande de suppression n’a pas pu être chargé.')}
          onRetry={query.refetch}
          retrying={query.isLoading}
        />
      ) : pending && current ? (
        <div className="mt-2 flex flex-col gap-3 text-sm">
          <p>
            <span className="font-medium">{ACCOUNT_DELETION_STATUS_LABELS.pending}</span> depuis le{' '}
            {formatMoment(current.requestedAt)}. Votre compte reste utilisable d’ici là.
          </p>
          {current.impact && current.impact.blockers.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="font-medium">Avant que la suppression puisse être faite :</p>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
                {current.impact.blockers.map((b, i) => (
                  <li key={`${b.kind}-${i}`}>
                    {ACCOUNT_DELETION_BLOCKER_LABELS[b.kind]}
                    {b.subject ? (
                      <>
                        {' '}
                        {b.href ? (
                          <Link to={b.href} className="font-medium underline underline-offset-4">
                            {b.subject}
                          </Link>
                        ) : (
                          <span className="font-medium">{b.subject}</span>
                        )}
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {current.impact && (
            <div className="text-muted-foreground">
              Seront supprimés : <ImpactList impact={current.impact} />
            </div>
          )}
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void act('cancel')}
              disabled={busy !== null}
              aria-busy={busy === 'cancel'}
            >
              {busy === 'cancel' ? 'Retrait en cours…' : failure ? 'Réessayer de retirer ma demande' : 'Retirer ma demande'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-3 text-sm">
          {current?.status === 'declined' && (
            <div className="rounded-md border border-border bg-muted p-3">
              <p className="font-medium">
                Votre demande du {formatMoment(current.requestedAt)} n’a pas été acceptée
                {current.decidedAt ? ` (le ${formatMoment(current.decidedAt)})` : ''}.
              </p>
              {current.declineNote && <p className="mt-1 whitespace-pre-line wrap-anywhere">{current.declineNote}</p>}
            </div>
          )}
          <p className="text-muted-foreground">
            Un administrateur traite la demande. Elle n’est faite que lorsqu’aucune de vos demandes
            de financement n’est plus partagée, publiée ou présentée à une structure : la page vous
            dira quoi retirer. Sont alors supprimés votre compte, vos entreprises, demandes,
            réponses et documents, vos positionnements, appartenances, notifications, sessions et
            applications connectées. Sont conservés sans plus vous nommer : le journal des actions
            passées, les consultations que vous avez faites et les notes et décisions des structures.
            Un email vous confirme la suppression.
          </p>
          <div>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setFailure(null)
                setConfirming(true)
              }}
              disabled={busy !== null}
            >
              Demander la suppression de mon compte
            </Button>
          </div>
        </div>
      )}
      {failure && !confirming && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {failure}
        </p>
      )}

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && busy === null) {
            setConfirming(false)
            setUnderstood(false)
            setFailure(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Demander la suppression de votre compte ?</AlertDialogTitle>
            <AlertDialogDescription>
              Une fois traitée par un administrateur, la suppression est définitive : vos
              entreprises, demandes, réponses et documents ne pourront pas être récupérés. Vous
              pourrez retirer votre demande tant qu’elle est en attente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              disabled={busy !== null}
            />
            <span>Je comprends que la suppression de mon compte sera définitive.</span>
          </label>
          <div aria-live="assertive">
            {failure && (
              <p role="alert" className="text-sm text-destructive">
                {failure}
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={!understood || busy !== null}
              aria-busy={busy === 'request'}
              onClick={() => void act('request')}
            >
              {busy === 'request' ? 'Envoi en cours…' : failure ? 'Réessayer' : 'Envoyer ma demande'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
