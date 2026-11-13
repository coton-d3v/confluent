import { z } from 'zod'
import {
  ACCESS_LEVEL_LABELS,
  COMMITTEE_APPLICATION_STATUS_LABELS,
  COMMITTEE_APPLICATION_STATUSES,
  FINANCING_STATUS_LABELS,
  FINANCING_STATUSES,
  WORKSPACE_MEMBER_ROLE_LABELS,
  WORKSPACE_MEMBER_ROLES,
  accessLevelSchema,
  type NotificationKind,
} from '@confluent/shared'

// ROADMAP E10.03: what each kind of notification is written from — its allowlist. A payload keeps
// only these fields (any other is dropped when it is recorded), each one readable by the recipient
// when the event happened: a request's name for its owner or a share's recipient, a workspace's name
// for its members, a committee's name and schedule for the people it concerns. Never an investor's
// name, organisation or amount (D05), an email address, a message, a place, a link or a note.

// Identifiers as the database writes them (not checked as UUIDs: a path segment, never shown).
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/)
const name = z.string().min(1).max(300)
const moment = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  timeZone: z.string().min(1).max(100),
})

const dossierOwned = z.object({ dossierId: id, dossierName: name, dossierSlug: name })
const candidatureOwned = z.object({
  candidatureId: id,
  dossierName: name,
  workspaceName: name,
})
const committeeChange = z.object({
  workspaceId: id,
  workspaceName: name,
  committeeName: name,
  ...moment.shape,
  previous: moment.nullable(),
  // Told as the owner of a request on its agenda (their candidature's page) or as a participant.
  audience: z.enum(['entrepreneur', 'participant']),
  candidatureId: id.nullable(),
})

export const NOTIFICATION_PAYLOADS = {
  share_invited: z.object({ dossierId: id, dossierName: name }),
  share_level_changed: z.object({ dossierId: id, dossierName: name, level: accessLevelSchema }),
  share_revoked: z.object({ dossierName: name }),
  workspace_invited: z.object({
    workspaceId: id,
    workspaceName: name,
    role: z.enum(WORKSPACE_MEMBER_ROLES),
  }),
  company_transfer_proposed: z.object({ companyName: name, workspaceName: name }),
  company_transfer_answered: z.object({
    workspaceId: id,
    companyName: name,
    decision: z.enum(['accepted', 'declined']),
  }),
  interest_received: dossierOwned,
  pledge_received: dossierOwned.extend({ change: z.enum(['new', 'changed']) }),
  candidature_status_changed: candidatureOwned.extend({ to: z.enum(FINANCING_STATUSES) }),
  committee_application_changed: candidatureOwned.extend({
    committeeName: name,
    to: z.enum(COMMITTEE_APPLICATION_STATUSES),
  }),
  showcase_card_hidden: candidatureOwned,
  participation_accepted: z.object({ workspaceId: id, workspaceName: name }),
  entrepreneur_access_accepted: z.object({ workspaceName: name }),
  participation_request_received: z.object({ workspaceId: id, workspaceName: name }),
  entrepreneur_access_request_received: z.object({ workspaceId: id, workspaceName: name }),
  committee_rescheduled: committeeChange,
  committee_cancelled: committeeChange,
  committee_restored: committeeChange,
  // E10.10: the request, nothing more — the administrator's note is read on « Mes données ».
  account_deletion_declined: z.object({ requestId: id }),
} satisfies Record<NotificationKind, z.ZodObject>

export type NotificationPayload<K extends NotificationKind> = z.infer<
  (typeof NOTIFICATION_PAYLOADS)[K]
>

// The payload as recorded: the kind's fields only. Throws on a missing or invalid one — a bug of the
// event's code, which undoes the event rather than recording a notification that cannot be read.
export function allowedPayload<K extends NotificationKind>(
  kind: K,
  payload: NotificationPayload<K>,
): NotificationPayload<K> {
  return NOTIFICATION_PAYLOADS[kind].parse(payload) as NotificationPayload<K>
}

export interface NotificationText {
  title: string
  body: string | null
  // A path of the site, or null when the object is out of the recipient's reach.
  href: string | null
}

// The text of a notification, from its recorded payload. A payload this version cannot read (written
// by a later one, or damaged) gives the kind's general sentence, without any detail nor link.
export function notificationText(kind: NotificationKind, raw: unknown): NotificationText {
  const parsed = NOTIFICATION_PAYLOADS[kind].safeParse(raw)
  if (!parsed.success) return { title: FALLBACK_TITLES[kind], body: null, href: null }
  return TEXTS[kind](parsed.data as never)
}

type Texts = { [K in NotificationKind]: (p: NotificationPayload<K>) => NotificationText }

const q = (s: string) => `« ${s} »`

const committeeBody = (p: NotificationPayload<'committee_rescheduled'>, when: string) =>
  [
    `${p.workspaceName} — ${when} ${momentLine(p)}.`,
    p.previous ? `Date précédente : ${momentLine(p.previous)}.` : null,
  ]
    .filter(Boolean)
    .join(' ')

const committeeHref = (p: NotificationPayload<'committee_rescheduled'>) =>
  p.audience === 'entrepreneur' && p.candidatureId
    ? `/dashboard/candidatures/${p.candidatureId}`
    : `/workspaces/${p.workspaceId}`

const APPLICATION_TITLES: Record<
  (typeof COMMITTEE_APPLICATION_STATUSES)[number],
  (dossier: string, committee: string) => string
> = {
  applied: (d, c) => `${q(d)} est inscrite au comité ${q(c)}`,
  proposed: (d, c) => `${q(d)} est proposée pour le comité ${q(c)}`,
  accepted: (d, c) => `${q(d)} est retenue pour le comité ${q(c)}`,
  refused: (d, c) => `${q(d)} n’est pas retenue pour le comité ${q(c)}`,
  withdrawn: (d, c) => `${q(d)} est retirée du comité ${q(c)}`,
}

const TEXTS: Texts = {
  share_invited: (p) => ({
    title: `Une demande vous est partagée : ${q(p.dossierName)}`,
    body: 'Vous la retrouvez dans vos opportunités.',
    href: `/opportunites/${p.dossierId}`,
  }),
  share_level_changed: (p) => ({
    title: `Votre accès à ${q(p.dossierName)} a changé`,
    body: `Niveau d’accès : ${ACCESS_LEVEL_LABELS[p.level]}.`,
    href: `/opportunites/${p.dossierId}`,
  }),
  share_revoked: (p) => ({
    title: `Votre accès à ${q(p.dossierName)} a été retiré`,
    body: 'Cette demande ne vous est plus partagée.',
    href: null,
  }),
  workspace_invited: (p) => ({
    title: `Vous êtes membre de ${q(p.workspaceName)}`,
    body: `Votre rôle : ${WORKSPACE_MEMBER_ROLE_LABELS[p.role].toLowerCase()}.`,
    href: `/workspaces/${p.workspaceId}`,
  }),
  company_transfer_proposed: (p) => ({
    title: `L’entreprise ${q(p.companyName)} vous est proposée`,
    body: `Préparée par un conseiller de ${q(p.workspaceName)} : acceptez-en ou refusez-en la propriété.`,
    href: '/dashboard/propositions',
  }),
  company_transfer_answered: (p) => ({
    title:
      p.decision === 'accepted'
        ? `L’entreprise ${q(p.companyName)} a été acceptée`
        : `L’entreprise ${q(p.companyName)} a été refusée`,
    body:
      p.decision === 'accepted'
        ? 'L’entrepreneur invité en est désormais propriétaire.'
        : 'L’entrepreneur invité a refusé d’en devenir propriétaire ; l’entreprise vous reste.',
    href: `/workspaces/${p.workspaceId}`,
  }),
  interest_received: (p) => ({
    title: `Nouvelle marque d’intérêt pour ${q(p.dossierName)}`,
    body: 'Un investisseur s’intéresse à votre demande. Son nom n’apparaît que s’il a choisi de le montrer.',
    href: `/dashboard/dossiers/view/${p.dossierSlug}`,
  }),
  pledge_received: (p) => ({
    title:
      p.change === 'new'
        ? `Nouvelle promesse pour ${q(p.dossierName)}`
        : `Promesse modifiée pour ${q(p.dossierName)}`,
    body: 'Une intention de financement, non engageante. Le total est à jour sur votre demande ; le nom et le montant n’apparaissent que si l’investisseur a choisi de les montrer.',
    href: `/dashboard/dossiers/view/${p.dossierSlug}`,
  }),
  candidature_status_changed: (p) => ({
    title: `${q(p.dossierName)} : ${FINANCING_STATUS_LABELS[p.to].toLowerCase()}`,
    body: `Statut de financement changé par ${q(p.workspaceName)}.`,
    href: `/dashboard/candidatures/${p.candidatureId}`,
  }),
  committee_application_changed: (p) => ({
    title: APPLICATION_TITLES[p.to](p.dossierName, p.committeeName),
    body: `${p.workspaceName} — ${COMMITTEE_APPLICATION_STATUS_LABELS[p.to]}.`,
    href: `/dashboard/candidatures/${p.candidatureId}`,
  }),
  showcase_card_hidden: (p) => ({
    title: `La carte de ${q(p.dossierName)} est masquée`,
    body: `Un gestionnaire de ${q(p.workspaceName)} l’a retirée de sa page publique. Votre consentement reste enregistré : vous pouvez le retirer.`,
    href: `/dashboard/candidatures/${p.candidatureId}`,
  }),
  participation_accepted: (p) => ({
    title: `Votre demande de participation à ${q(p.workspaceName)} est acceptée`,
    body: 'Retrouvez vos sessions de comité dans le workspace.',
    href: `/workspaces/${p.workspaceId}`,
  }),
  entrepreneur_access_accepted: (p) => ({
    title: `Votre demande d’accès à ${q(p.workspaceName)} est acceptée`,
    body: 'Vous pouvez lui présenter une demande de financement.',
    href: '/dashboard',
  }),
  participation_request_received: (p) => ({
    title: `Nouvelle demande de participation à un comité de ${q(p.workspaceName)}`,
    body: 'À traiter depuis la page du comité.',
    href: `/workspaces/${p.workspaceId}/comites`,
  }),
  entrepreneur_access_request_received: (p) => ({
    title: `Nouvelle demande d’accès entrepreneur à ${q(p.workspaceName)}`,
    body: 'À traiter dans les demandes reçues du workspace.',
    href: `/admin/workspaces/${p.workspaceId}/demandes`,
  }),
  committee_rescheduled: (p) => ({
    title: `Le comité ${q(p.committeeName)} change de date`,
    body: committeeBody(p, 'nouvelle date :'),
    href: committeeHref(p),
  }),
  committee_cancelled: (p) => ({
    title: `Le comité ${q(p.committeeName)} est annulé`,
    body: committeeBody(p, 'il était prévu le'),
    href: committeeHref(p),
  }),
  committee_restored: (p) => ({
    title: `Le comité ${q(p.committeeName)} est rétabli`,
    body: committeeBody(p, 'il a lieu le'),
    href: committeeHref(p),
  }),
  account_deletion_declined: () => ({
    title: 'Votre demande de suppression de compte n’a pas été acceptée',
    body: 'Votre compte est conservé. La raison est indiquée dans « Mes données ».',
    href: '/compte',
  }),
}

const FALLBACK_TITLES: Record<NotificationKind, string> = {
  share_invited: 'Une demande vous est partagée',
  share_level_changed: 'Votre accès à une demande a changé',
  share_revoked: 'Votre accès à une demande a été retiré',
  workspace_invited: 'Vous êtes membre d’un workspace',
  company_transfer_proposed: 'Une entreprise vous est proposée',
  company_transfer_answered: 'Réponse à une proposition d’entreprise',
  interest_received: 'Nouvelle marque d’intérêt',
  pledge_received: 'Nouvelle promesse',
  candidature_status_changed: 'Statut de financement changé',
  committee_application_changed: 'Votre participation à un comité a changé',
  showcase_card_hidden: 'Une carte de vitrine est masquée',
  participation_accepted: 'Demande de participation acceptée',
  entrepreneur_access_accepted: 'Demande d’accès acceptée',
  participation_request_received: 'Nouvelle demande de participation',
  entrepreneur_access_request_received: 'Nouvelle demande d’accès entrepreneur',
  committee_rescheduled: 'Un comité change de date',
  committee_cancelled: 'Un comité est annulé',
  committee_restored: 'Un comité est rétabli',
  account_deletion_declined: 'Demande de suppression de compte non acceptée',
}

// « mercredi 10 juin 2099 à 14:00 (Europe/Paris) »: the wall-clock time of the committee's own zone.
export function momentLine(m: { date: string; time: string; timeZone: string }): string {
  const day = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'UTC' })
  return `${day.format(new Date(`${m.date}T00:00:00Z`))} à ${m.time} (${m.timeZone})`
}
