import { z } from 'zod'

// Memberships of a workspace (ROADMAP E05.02): a person's role in one structure, distinct from the
// account's global role. Same rules for the site (immediate feedback) and the API (authoritative);
// the database repeats them in CHECK constraints.

// `conseiller`: staff of the structure (advisor), the only role that may hold the right to manage
// the workspace. `investisseur`: member of the structure's investor community.
export const WORKSPACE_MEMBER_ROLES = ['conseiller', 'investisseur'] as const
export type WorkspaceMemberRole = (typeof WORKSPACE_MEMBER_ROLES)[number]

export const WORKSPACE_MEMBER_ROLE_LABELS: Record<WorkspaceMemberRole, string> = {
  conseiller: 'Conseiller',
  investisseur: 'Investisseur',
}

// Close to the financing sources a promise will feed (D04, E06/E07); `autre` when none fits.
export const INVESTOR_TYPES = [
  'business_angel',
  'fonds_investissement',
  'banque',
  'financeur_public',
  'reseau_pret_honneur',
  'autre',
] as const
export type InvestorType = (typeof INVESTOR_TYPES)[number]

export const INVESTOR_TYPE_LABELS: Record<InvestorType, string> = {
  business_angel: 'Business angel',
  fonds_investissement: 'Fonds d’investissement',
  banque: 'Banque',
  financeur_public: 'Financeur public',
  reseau_pret_honneur: 'Réseau de prêt d’honneur',
  autre: 'Autre',
}

export const WORKSPACE_MEMBER_LIMITS = { organization: 120, email: 254 } as const

export const workspaceMemberRoleSchema = z.enum(WORKSPACE_MEMBER_ROLES, {
  message: 'Choisissez le rôle : conseiller ou investisseur.',
})

export const investorTypeSchema = z.enum(INVESTOR_TYPES, {
  message: 'Type d’investisseur inconnu.',
})

// An empty or blank organization clears it (stored as null).
const organizationSchema = z
  .string()
  .trim()
  .max(
    WORKSPACE_MEMBER_LIMITS.organization,
    `L’organisation compte au plus ${WORKSPACE_MEMBER_LIMITS.organization} caractères.`,
  )
  .transform((v) => (v === '' ? null : v))
  .nullable()

export const MEMBER_RULE_MESSAGES = {
  investorTypeRole: 'Le type d’investisseur ne concerne que les investisseurs.',
  managerRole: 'Seul un conseiller peut gérer le workspace.',
} as const

// What a membership may hold given its role: an investor type for an investisseur only, the right to
// manage the workspace for a conseiller only. Returns the first broken rule, or null.
export function memberRuleViolation(member: {
  role?: WorkspaceMemberRole
  investorType?: InvestorType | null
  canManageWorkspace?: boolean
}): { path: 'investorType' | 'canManageWorkspace'; message: string } | null {
  if (member.role === 'conseiller' && member.investorType) {
    return { path: 'investorType', message: MEMBER_RULE_MESSAGES.investorTypeRole }
  }
  if (member.role === 'investisseur' && member.canManageWorkspace === true) {
    return { path: 'canManageWorkspace', message: MEMBER_RULE_MESSAGES.managerRole }
  }
  return null
}

const followsMemberRules = (
  value: Parameters<typeof memberRuleViolation>[0],
  ctx: z.RefinementCtx,
) => {
  const violation = memberRuleViolation(value)
  if (violation)
    ctx.addIssue({ code: 'custom', path: [violation.path], message: violation.message })
}

// The address part after « @ », compared with a workspace's email domain restriction (exact match:
// a sub-domain is another domain).
export function emailDomainOf(email: string): string {
  return email.trim().toLowerCase().split('@').pop() ?? ''
}

export const inviteWorkspaceMemberSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(WORKSPACE_MEMBER_LIMITS.email, 'L’adresse email est trop longue.')
      .email('L’adresse email n’est pas valide.'),
    role: workspaceMemberRoleSchema,
    organization: organizationSchema.optional(),
    investorType: investorTypeSchema.nullable().optional(),
    canManageWorkspace: z.boolean().optional(),
  })
  .strict()
  .superRefine(followsMemberRules)

// Only what is sent changes. Changing the role clears what the new role cannot hold (the investor
// type of a former investisseur, the management right of a former conseiller).
export const updateWorkspaceMemberSchema = z
  .object({
    role: workspaceMemberRoleSchema,
    organization: organizationSchema,
    investorType: investorTypeSchema.nullable(),
    canManageWorkspace: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Indiquez au moins une information à modifier.',
  })
  .superRefine(followsMemberRules)

const personSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
})

export const workspaceMemberSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  user: personSchema,
  role: workspaceMemberRoleSchema,
  organization: z.string().nullable(),
  investorType: investorTypeSchema.nullable(),
  canManageWorkspace: z.boolean(),
  // `deactivated`: kept with its history, grants nothing until reactivated.
  status: z.enum(['active', 'deactivated']),
  // The invited account has never signed in yet.
  awaitingFirstSignIn: z.boolean(),
  invitedBy: personSchema.nullable(),
  invitedAt: z.string().datetime(),
  deactivatedAt: z.string().datetime().nullable(),
})

export const workspaceMemberInvitationSchema = z.object({
  member: workspaceMemberSchema,
  // False when the invitation email could not be sent: the membership exists all the same.
  invitationEmailSent: z.boolean(),
})

// One of the signed-in person's active memberships, with the workspace it belongs to.
export const myWorkspaceMembershipSchema = z.object({
  id: z.string().uuid(),
  role: workspaceMemberRoleSchema,
  organization: z.string().nullable(),
  investorType: investorTypeSchema.nullable(),
  canManageWorkspace: z.boolean(),
  workspace: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    programName: z.string().nullable(),
    color: z.string().nullable(),
  }),
})

export type InviteWorkspaceMemberInput = z.input<typeof inviteWorkspaceMemberSchema>
export type UpdateWorkspaceMemberInput = z.input<typeof updateWorkspaceMemberSchema>
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>
export type WorkspaceMemberInvitation = z.infer<typeof workspaceMemberInvitationSchema>
export type MyWorkspaceMembership = z.infer<typeof myWorkspaceMembershipSchema>
