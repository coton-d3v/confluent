import { useState } from 'react'
import { toast } from 'sonner'
import {
  INVESTOR_TYPE_LABELS,
  WORKSPACE_MEMBER_ROLE_LABELS,
  type Workspace,
  type WorkspaceMember,
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useCurrentUser } from '@/features/current-user/context'
import {
  deactivateWorkspaceMember,
  inviteWorkspaceMember,
  reactivateWorkspaceMember,
  updateWorkspaceMember,
} from '@/features/admin/workspace-members.api'
import type { ApiError } from '@/lib/api-client'
import { WorkspaceMemberForm } from './WorkspaceMemberForm'

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' })
const formatDate = (iso: string) => dateFormat.format(new Date(iso))

const nameOf = (person: { firstName: string | null; lastName: string | null }) =>
  [person.firstName, person.lastName].filter(Boolean).join(' ')

// Members of a workspace (ROADMAP E05.02): invite, edit, deactivate and reactivate.
export function WorkspaceMembersPanel({
  workspace,
  members,
  onChange,
}: {
  workspace: Workspace
  members: WorkspaceMember[]
  // After any change: reload the list (the account may have given up its own right).
  onChange: () => void
}) {
  const me = useCurrentUser()
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<WorkspaceMember | null>(null)
  const [deactivating, setDeactivating] = useState<WorkspaceMember | null>(null)
  const active = members.filter((m) => m.status === 'active')

  async function deactivate(member: WorkspaceMember) {
    setDeactivating(null)
    try {
      await deactivateWorkspaceMember(workspace.id, member.id)
      toast.success(`${member.user.email} est désactivé dans ce workspace.`)
    } catch (err) {
      toast.error((err as ApiError)?.message ?? 'Désactivation impossible.')
    }
    onChange()
  }

  async function reactivate(member: WorkspaceMember) {
    try {
      await reactivateWorkspaceMember(workspace.id, member.id)
      toast.success(`${member.user.email} est réactivé dans ce workspace.`)
    } catch (err) {
      toast.error((err as ApiError)?.message ?? 'Réactivation impossible.')
    }
    onChange()
  }

  return (
    <section aria-labelledby="ws-members-title" className="flex flex-col gap-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 id="ws-members-title" className="font-heading text-lg font-semibold text-foreground">
            Membres
          </h2>
          <p className="text-sm text-muted-foreground">
            {active.length} actif{active.length > 1 ? 's' : ''}
            {members.length > active.length
              ? `, ${members.length - active.length} désactivé${members.length - active.length > 1 ? 's' : ''}`
              : ''}
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setInviting(true)}>
          Inviter un membre
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Les conseillers forment l’équipe de la structure ; ceux qui ont le droit de gestion règlent
        le workspace et ses membres. Les investisseurs composent sa communauté.
        {workspace.emailDomain
          ? ` Les conseillers doivent avoir une adresse @${workspace.emailDomain}.`
          : ''}
      </p>

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun membre pour l’instant : invitez les conseillers et investisseurs de la structure.
        </p>
      ) : (
        <ul role="list" aria-label="Membres du workspace" className="flex flex-col gap-3">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isSelf={member.user.id === me.id}
              onEdit={() => setEditing(member)}
              onDeactivate={() => setDeactivating(member)}
              onReactivate={() => void reactivate(member)}
            />
          ))}
        </ul>
      )}

      <Sheet open={inviting} onOpenChange={setInviting}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Inviter un membre</SheetTitle>
            <SheetDescription>
              La personne rejoint {workspace.name} et reçoit un email pour se connecter à Confluent.
            </SheetDescription>
          </SheetHeader>
          <Separator />
          {inviting && (
            <WorkspaceMemberForm
              emailDomain={workspace.emailDomain}
              onCancel={() => setInviting(false)}
              onSubmit={async (input) => {
                const { member, invitationEmailSent } = await inviteWorkspaceMember(
                  workspace.id,
                  input,
                )
                setInviting(false)
                if (invitationEmailSent) toast.success(`Invitation envoyée à ${member.user.email}.`)
                else
                  toast.warning(
                    `${member.user.email} a rejoint le workspace, mais l’email d’invitation n’a pas pu partir.`,
                  )
                onChange()
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Modifier le membre</SheetTitle>
            <SheetDescription>
              Rôle, organisation, type d’investisseur et droit de gérer le workspace.
            </SheetDescription>
          </SheetHeader>
          <Separator />
          {editing && (
            <WorkspaceMemberForm
              key={editing.id}
              member={editing}
              isSelf={editing.user.id === me.id}
              emailDomain={workspace.emailDomain}
              onCancel={() => setEditing(null)}
              onSubmit={async (input) => {
                await updateWorkspaceMember(workspace.id, editing.id, input)
                setEditing(null)
                toast.success('Membre enregistré.')
                onChange()
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Désactiver ce membre ?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivating?.user.email} ne fera plus partie de {workspace.name}
              {deactivating?.canManageWorkspace ? ' et ne pourra plus le gérer' : ''}, dès
              maintenant. Son compte Confluent et l’historique sont conservés ; vous pourrez le
              réactiver.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => deactivating && void deactivate(deactivating)}>
              Oui, désactiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function MemberRow({
  member,
  isSelf,
  onEdit,
  onDeactivate,
  onReactivate,
}: {
  member: WorkspaceMember
  isSelf: boolean
  onEdit: () => void
  onDeactivate: () => void
  onReactivate: () => void
}) {
  const name = nameOf(member.user)
  const deactivated = member.status === 'deactivated'
  const details = [
    member.organization,
    member.investorType ? INVESTOR_TYPE_LABELS[member.investorType] : null,
  ].filter(Boolean)
  const inviter = member.invitedBy ? nameOf(member.invitedBy) || member.invitedBy.email : null
  return (
    <li
      className={
        'flex flex-col gap-3 rounded-lg border border-border bg-card p-4 md:flex-row md:items-center' +
        (deactivated ? ' opacity-70' : '')
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="break-all text-base font-medium text-foreground">
            {name || member.user.email}
            {isSelf && <span className="font-normal text-muted-foreground"> (vous)</span>}
          </span>
          <Badge variant="secondary">{WORKSPACE_MEMBER_ROLE_LABELS[member.role]}</Badge>
          {member.canManageWorkspace && <Badge>Gestionnaire</Badge>}
          {deactivated && <Badge variant="destructive">Désactivé</Badge>}
          {!deactivated && member.awaitingFirstSignIn && (
            <Badge variant="outline">Jamais connecté</Badge>
          )}
        </div>
        {name && <p className="break-all text-sm text-muted-foreground">{member.user.email}</p>}
        {details.length > 0 && (
          <p className="mt-1 text-sm text-foreground">{details.join(' · ')}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Invité le {formatDate(member.invitedAt)}
          {inviter ? ` par ${inviter}` : ''}
          {member.deactivatedAt ? ` · désactivé le ${formatDate(member.deactivatedAt)}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Modifier ${member.user.email}`}
          onClick={onEdit}
        >
          Modifier
        </Button>
        {deactivated ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Réactiver ${member.user.email}`}
            onClick={onReactivate}
          >
            Réactiver
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Désactiver ${member.user.email}`}
            onClick={onDeactivate}
          >
            Désactiver
          </Button>
        )}
      </div>
    </li>
  )
}
