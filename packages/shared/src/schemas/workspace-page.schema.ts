import { z } from 'zod'
import { publicCommitteeSchema } from './participation-request.schema.js'
import { publicCardSchema } from './showcase-card.schema.js'
import { HTML_TAG, plainParagraphs } from './support-path.schema.js'

// ROADMAP E09.01: a workspace's public page (`/w/<slug>`) — the programme's identity, its
// presentation, criteria and contact, the next sessions offered to participation requests (E08.04)
// and how to apply. Same rules for the site (immediate feedback) and the API (authoritative).
//
// Closed by default: the page is unpublished until a manager turns it on; an unpublished page and an
// unknown slug answer alike (`404`). The public reads a closed list of fields
// (`PUBLIC_WORKSPACE_FIELDS`), never the workspace's id, members, contact email for its members,
// email domain or anything internal. Not indexed by search engines (E09.06 decides indexing).
// Blocks, their order and a richer preview come with E09.04; the requests' cards are E09.02's.

export const WORKSPACE_PAGE_LIMITS = {
  criteria: 3000,
  contact: 1000,
  // Sessions listed on the page (the participation form lists all of them).
  committees: 10,
} as const

// Plain text in paragraphs, bounded; blank is none. Never rendered as HTML or Markdown.
const plainTextSchema = (max: number, tooLong: string, markup: string) =>
  z
    .string()
    .transform(plainParagraphs)
    .pipe(
      z
        .string()
        .max(max, tooLong)
        .refine((v) => !HTML_TAG.test(v), { message: markup }),
    )
    .transform((v) => (v === '' ? null : v))
    .nullable()

// The managers' settings of the page, all sent again from the version they read (`409` otherwise).
// `contact` is shown to anyone once the page is published: whatever the managers type there (an
// address, a phone number, a form's link) is public — the workspace's contact email for its members
// never is.
export const updateWorkspacePageSchema = z
  .object({
    published: z.boolean({ message: 'Indiquez si la page est publiée.' }),
    criteria: plainTextSchema(
      WORKSPACE_PAGE_LIMITS.criteria,
      `Les critères comptent au plus ${WORKSPACE_PAGE_LIMITS.criteria} caractères.`,
      'Les critères sont un texte simple : les balises HTML ne sont pas acceptées.',
    ),
    contact: plainTextSchema(
      WORKSPACE_PAGE_LIMITS.contact,
      `Le contact compte au plus ${WORKSPACE_PAGE_LIMITS.contact} caractères.`,
      'Le contact est un texte simple : les balises HTML ne sont pas acceptées.',
    ),
    version: z.number().int().positive(),
  })
  .strict()
export type UpdateWorkspacePageInput = z.input<typeof updateWorkspacePageSchema>

// What the public reads of a workspace — a closed list, copied field by field by the API.
export const PUBLIC_WORKSPACE_FIELDS = [
  'slug',
  'name',
  'programName',
  'color',
  'presentation',
  'criteria',
  'contact',
  'logoVersion',
] as const

export const publicWorkspaceSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    programName: z.string().nullable(),
    color: z.string().nullable(),
    presentation: z.string().nullable(),
    criteria: z.string().nullable(),
    contact: z.string().nullable(),
    // Changes with the image; null: no logo. The image itself is served, while the page is
    // published, by `GET /v1/public/workspaces/<slug>/logo` (never a bucket address).
    logoVersion: z.string().nullable(),
  })
  .strict()
export type PublicWorkspace = z.infer<typeof publicWorkspaceSchema>

export const publicWorkspacePageSchema = z
  .object({
    workspace: publicWorkspaceSchema,
    // The next sessions its managers offer to participation requests (E08.04), by name and time
    // only (`toPublicCommittee`), soonest first, at most `WORKSPACE_PAGE_LIMITS.committees`.
    committees: z.array(publicCommitteeSchema),
    // Whether it receives candidatures (a published candidature form, E05.09): presented from a
    // Confluent account, never through a sign-up opened by this page.
    receivesCandidatures: z.boolean(),
    // E09.02: the anonymous cards of the requests whose owners consented to show them here, under
    // their pseudonym (`toPublicCard`, showcase-card.schema.ts), the latest consents first, at most
    // `SHOWCASE_CARD_LIMITS.cardsPerPage`.
    cards: z.array(publicCardSchema),
  })
  .strict()
export type PublicWorkspacePage = z.infer<typeof publicWorkspacePageSchema>

// The page as its managers set it, with what the public sees (or would see, once published) —
// built by the same projection as the public route.
export const workspacePageSettingsSchema = z
  .object({
    published: z.boolean(),
    criteria: z.string().nullable(),
    contact: z.string().nullable(),
    version: z.number().int().positive(),
    preview: publicWorkspacePageSchema,
  })
  .strict()
export type WorkspacePageSettings = z.infer<typeof workspacePageSettingsSchema>
