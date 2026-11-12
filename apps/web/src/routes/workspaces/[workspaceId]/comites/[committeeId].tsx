import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { Committee, CommitteeStatus } from '@confluent/shared'
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
import { changeCommitteeStatus, getCommittee, updateCommittee } from '@/features/committees/api'
import { CommitteeForm } from '@/features/committees/components/CommitteeForm'
import {
  CommitteeStatusBadge,
  CommitteeWhen,
} from '@/features/committees/components/CommitteeSummary'
import {
  CommitteeTexts,
  SharedCommitteePreview,
} from '@/features/committees/components/CommitteeTexts'
import { isOverdue } from '@/features/committees/format'
import {
  CommitteesTrail,
  CommitteesUnavailable,
} from '@/features/committees/components/CommitteesTrail'
import { enterWorkspace } from '@/features/workspaces/api'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

const STATUS_DONE: Record<CommitteeStatus, string> = {
  planned: 'est de nouveau programmé',
  held: 'est marqué comme tenu',
  cancelled: 'est annulé',
}

// One committee of a workspace (ROADMAP E08.01, E08.02): when (in its zone, named), where, its
// status, its internal notes beside the information shared with its candidates and investors (and a
// preview of what they will read), for the workspace's conseillers and Confluent's administrators; its
// managers edit it, cancel it, mark it held or put it back to planned, from the version shown. The
// API decides, at each request.
export default function CommitteeRoute() {
  const { workspaceId = '', committeeId = '' } = useParams()
  return (
    <CommitteePage
      key={`${workspaceId}/${committeeId}`}
      workspaceId={workspaceId}
      committeeId={committeeId}
    />
  )
}

function CommitteePage({ workspaceId, committeeId }: { workspaceId: string; committeeId: string }) {
  const entered = useAsync(() => enterWorkspace(workspaceId), [workspaceId])
  const query = useAsync(() => getCommittee(workspaceId, committeeId), [workspaceId, committeeId])
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [now] = useState(() => Date.now())
  const headingRef = useRef<HTMLHeadingElement>(null)
  const error = (entered.error ?? query.error) as ApiError | null

  useEffect(() => {
    if (query.data && !editing) headingRef.current?.focus()
  }, [query.data, editing])

  if (error) return <CommitteesUnavailable error={error} />
  if (!entered.data || !query.data) {
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }

  const { workspace, canManageWorkspace } = entered.data
  const committee = query.data

  async function moveTo(status: CommitteeStatus) {
    setBusy(true)
    try {
      const updated = await changeCommitteeStatus(workspace.id, committee.id, {
        status,
        version: committee.version,
      })
      toast.success(`« ${updated.name} » ${STATUS_DONE[status]}.`)
    } catch (err) {
      toast.error((err as ApiError)?.message ?? 'Changement de statut impossible.')
    } finally {
      setBusy(false)
      setCancelling(false)
      query.refetch()
    }
  }

  return (
    <>
      <title>{`${committee.name} · Comités · ${workspace.name} · Confluent`}</title>
      <CommitteesTrail workspace={workspace} committee={committee.name} />
      <div className="mt-4 flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 wrap-anywhere font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
        >
          {committee.name}
        </h1>
        <CommitteeStatusBadge status={committee.status} />
      </div>

      <div className="mt-6 flex max-w-3xl flex-col gap-6">
        {editing ? (
          <section aria-labelledby="committee-edit-title" className="flex flex-col gap-4">
            <h2
              id="committee-edit-title"
              className="font-heading text-lg font-semibold text-foreground"
            >
              Modifier le comité
            </h2>
            <CommitteeForm
              committee={committee}
              submitLabel="Enregistrer"
              // Back to the committee as it now is (changed meanwhile, after a refusal).
              onCancel={() => {
                setEditing(false)
                query.refetch()
              }}
              onSubmit={async (input) => {
                await updateCommittee(workspace.id, committee.id, {
                  ...input,
                  version: committee.version,
                })
                toast.success('Comité enregistré.')
                setEditing(false)
                query.refetch()
              }}
            />
          </section>
        ) : (
          <>
            <CommitteeDetails committee={committee} />
            <CommitteeTexts committee={committee} />
            <SharedCommitteePreview committee={committee} />
          </>
        )}

        {canManageWorkspace && !editing && (
          <section aria-labelledby="committee-actions-title" className="flex flex-col gap-2">
            <h2 id="committee-actions-title" className="sr-only">
              Actions
            </h2>
            <div className="flex flex-wrap gap-2">
              {committee.status === 'planned' && (
                <>
                  <Button type="button" disabled={busy} onClick={() => setEditing(true)}>
                    Modifier
                  </Button>
                  {isOverdue(committee, now) && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void moveTo('held')}
                    >
                      Marquer comme tenu
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => setCancelling(true)}
                  >
                    Annuler le comité
                  </Button>
                </>
              )}
              {committee.status === 'cancelled' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void moveTo('planned')}
                >
                  Rétablir le comité
                </Button>
              )}
              {committee.status === 'held' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void moveTo('planned')}
                >
                  Remettre au statut « Programmé »
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {committee.status === 'planned'
                ? isOverdue(committee, now)
                  ? 'Sa date est passée : marquez-le comme tenu, ou annulez-le.'
                  : 'Il pourra être marqué comme tenu une fois son heure passée.'
                : 'Un comité annulé ou tenu n’est plus modifié : remettez-le d’abord au statut « Programmé ».'}
            </p>
          </section>
        )}
      </div>

      <AlertDialog
        open={cancelling}
        onOpenChange={(open) => {
          if (!open && !busy) setCancelling(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler « {committee.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le comité reste dans la liste, marqué « Annulé », et n’est plus modifiable. Vous
              pourrez le rétablir. Personne n’est prévenu automatiquement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Ne pas annuler</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void moveTo('cancelled')}>
              Annuler le comité
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function CommitteeDetails({ committee }: { committee: Committee }) {
  return (
    <dl className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <dt className="text-sm font-medium text-muted-foreground">Date et heure</dt>
        <dd>
          <CommitteeWhen committee={committee} />
        </dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-sm font-medium text-muted-foreground">Lieu</dt>
        <dd className="wrap-anywhere text-sm text-foreground">
          {committee.location ?? (committee.meetingUrl ? 'En ligne' : 'Lieu à préciser')}
        </dd>
      </div>
      {committee.meetingUrl && (
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-muted-foreground">Visioconférence</dt>
          <dd className="text-sm">
            <a
              href={committee.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-foreground underline underline-offset-4"
            >
              {committee.meetingUrl}
            </a>
          </dd>
        </div>
      )}
    </dl>
  )
}
