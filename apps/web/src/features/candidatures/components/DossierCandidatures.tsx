import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { CANDIDATURE_STATUS_LABELS, type CandidatureSummary } from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { createCandidature, listCandidatureWorkspaces, listDossierCandidatures } from '../api'
import { FinancingStatusBadge } from './FinancingStatusPanel'
import { PoolPublicationBadge } from './PoolPublicationPanel'
import { readFailure } from '@/lib/read-failure'
import { LoadError } from '@/components/confluent/LoadError'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

const failure = (err: unknown, fallback: string) => {
  const apiError = err as Partial<ApiError> | undefined
  return apiError?.status === undefined
    ? `${fallback} Vérifiez votre connexion puis réessayez.`
    : (apiError.message ?? fallback)
}

// ROADMAP E05.09, on a request's page for its owner: the structures it is presented to, and
// presenting it to another one. Each candidature reuses the company profile as is and answers the
// structure's own form, on its own page.
export function DossierCandidatures({
  dossierId,
  profileSubmitted,
  inPreparation,
  archived = false,
}: {
  dossierId: string
  profileSubmitted: boolean
  inPreparation: boolean
  // E06.01: an archived request is presented to no new structure.
  archived?: boolean
}) {
  const candidatures = useAsync(() => listDossierCandidatures(dossierId), [dossierId])

  return (
    <section aria-labelledby="candidatures-title" className="flex max-w-3xl flex-col gap-5">
      <div>
        <h2 id="candidatures-title" className="font-heading text-lg font-semibold text-foreground">
          Candidatures auprès des structures
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Présentez cette demande à un incubateur, une CCI ou un réseau d’investisseurs. La structure
          reçoit le profil de l’entreprise tel que vous l’avez déjà renseigné, sans ressaisie, et vos
          réponses à son propre formulaire. Ces réponses ne sont lues que par ses conseillers : ni les
          autres structures, ni les personnes avec qui vous partagez la demande ne les voient.
        </p>
      </div>

      {inPreparation ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Cette entreprise est préparée pour un entrepreneur : seul son propriétaire, après avoir
          accepté la proposition, pourra la présenter à une structure.
        </p>
      ) : archived ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Cette demande est archivée : désarchivez-la (onglet « Demande ») pour la présenter à une
          nouvelle structure. Les structures qui la suivent déjà gardent leur statut.
        </p>
      ) : (
        <PresentForm
          dossierId={dossierId}
          taken={new Set((candidatures.data ?? []).map((c) => c.workspace.id))}
        />
      )}

      {candidatures.isLoading && !candidatures.data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : candidatures.error ? (
        <LoadError
          message={readFailure(candidatures.error, 'Les candidatures n’ont pas pu être chargées.')}
          onRetry={candidatures.refetch}
        />
      ) : (candidatures.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Cette demande n’est présentée à aucune structure pour l’instant.
        </p>
      ) : (
        <ul role="list" className="flex flex-col gap-3">
          {(candidatures.data ?? []).map((c) => (
            <CandidatureRow key={c.id} candidature={c} />
          ))}
        </ul>
      )}

      {!profileSubmitted && !inPreparation && (
        <p className="text-xs text-muted-foreground">
          Pour envoyer une candidature, soumettez d’abord le profil de l’entreprise (« Reprendre le
          questionnaire »).
        </p>
      )}
    </section>
  )
}

function CandidatureRow({ candidature }: { candidature: CandidatureSummary }) {
  const { workspace, status } = candidature
  return (
    <li className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to={`/dashboard/candidatures/${candidature.id}`}
          className="min-w-0 wrap-anywhere text-base font-medium text-foreground underline-offset-4 hover:underline"
        >
          {workspace.name}
        </Link>
        <span className="flex flex-wrap items-center gap-1.5">
          {status === 'submitted' ? (
            <FinancingStatusBadge status={candidature.financingStatus} />
          ) : (
            <Badge variant="outline">{CANDIDATURE_STATUS_LABELS[status]}</Badge>
          )}
          {/* E07.02: published in the structure's pool. */}
          <PoolPublicationBadge publication={candidature.poolPublication} />
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground wrap-anywhere">
        {workspace.programName ? `${workspace.programName} · ` : ''}
        {candidature.submittedAt
          ? `Envoyée le ${dateFr(candidature.submittedAt)}`
          : `Brouillon ouvert le ${dateFr(candidature.createdAt)} — la structure ne voit rien avant l’envoi`}
      </p>
    </li>
  )
}

// Choosing a structure among those that receive candidatures, and not yet chosen for this request.
function PresentForm({ dossierId, taken }: { dossierId: string; taken: ReadonlySet<string> }) {
  const navigate = useNavigate()
  const selectId = useId()
  const workspaces = useAsync(() => listCandidatureWorkspaces(), [])
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const available = (workspaces.data ?? []).filter((w) => !taken.has(w.id))
  const chosen = available.find((w) => w.id === choice) ?? null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!chosen) return
    setBusy(true)
    try {
      const created = await createCandidature(dossierId, chosen.id)
      toast.success(`Candidature ouverte auprès de ${chosen.name}.`)
      void navigate(`/dashboard/candidatures/${created.id}`)
    } catch (err) {
      toast.error(failure(err, 'La candidature n’a pas pu être ouverte.'))
      setBusy(false)
    }
  }

  if (workspaces.isLoading && !workspaces.data) return null
  if (workspaces.error) {
    return (
      <LoadError
        message={readFailure(workspaces.error, 'Les structures n’ont pas pu être chargées.')}
        onRetry={workspaces.refetch}
      />
    )
  }
  if (available.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {(workspaces.data ?? []).length === 0
          ? 'Aucune structure ne reçoit de candidatures pour l’instant.'
          : 'Cette demande est déjà présentée à toutes les structures qui reçoivent des candidatures.'}
      </p>
    )
  }
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={selectId}>Présenter la demande à une structure</Label>
        <NativeSelect
          id={selectId}
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          disabled={busy}
        >
          <option value="">Choisir une structure…</option>
          {available.map((w) => (
            <option key={w.id} value={w.id}>
              {w.programName ? `${w.name} — ${w.programName}` : w.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {chosen?.presentation && (
        <p className="whitespace-pre-line wrap-anywhere text-sm text-muted-foreground">
          {chosen.presentation}
        </p>
      )}
      <Button type="submit" size="sm" className="self-start" disabled={!chosen || busy}>
        {busy ? 'Ouverture…' : 'Ouvrir la candidature'}
      </Button>
    </form>
  )
}
