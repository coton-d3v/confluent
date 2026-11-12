import { z } from 'zod'
import { publicCommitteeSchema, type PublicCommittee } from './participation-request.schema.js'
import { publicCardSchema } from './showcase-card.schema.js'
import { HTML_TAG, plainParagraphs } from './support-path.schema.js'

// ROADMAP E09.01: a workspace's public page (`/w/<slug>`) — the programme's identity, its
// presentation, criteria and contact, the next sessions offered to participation requests (E08.04)
// and how to apply. Same rules for the site (immediate feedback) and the API (authoritative).
//
// Closed by default: the page is unpublished until a manager turns it on; an unpublished page and an
// unknown slug answer alike (`404`). The public reads a closed list of fields
// (`PUBLIC_WORKSPACE_FIELDS`), never the workspace's id, members, contact email for its members,
// email domain or anything internal. E09.06: not indexed by search engines unless its managers
// allow it (`publicPageRobots`).
// The requests' cards are E09.02's. E09.04: the page is an ordered list of blocks from a closed
// catalogue, each shown or not by its managers.

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

// ROADMAP E09.04: the blocks of the page below its header (identity: logo, name, programme — always
// shown), a closed catalogue, each at most once. Its managers choose which are shown and in which
// order; a block never adds data to the page: it shows (or not) what E09.01–E09.03 already allow.
//  * presentation, criteria, contact: the texts (the presentation is the workspace's settings');
//  * committees: the next sessions offered to participation requests, each with its link to the form;
//  * cards: the anonymous cards of the requests (E09.02/E09.03);
//  * apply: how to present a request (only while a candidature form is published);
//  * participate: the call to ask to take part (only while sessions are offered).
// No free text block (decision D06 not confirmed: guided fields only).
export const PUBLIC_PAGE_BLOCKS = [
  'presentation',
  'criteria',
  'committees',
  'cards',
  'apply',
  'participate',
  'contact',
] as const
export type PublicPageBlock = (typeof PUBLIC_PAGE_BLOCKS)[number]

// A page whose managers never chose its blocks: every block, in E09.01's order.
export const DEFAULT_PUBLIC_PAGE_BLOCKS: readonly PublicPageBlock[] = PUBLIC_PAGE_BLOCKS

export const isPublicPageBlock = (value: unknown): value is PublicPageBlock =>
  (PUBLIC_PAGE_BLOCKS as readonly unknown[]).includes(value)

// The blocks shown, in their order: each known block at most once, from the catalogue only.
export const publicPageBlocksSchema = z
  .array(z.enum(PUBLIC_PAGE_BLOCKS, { message: 'Ce bloc n’existe pas.' }), {
    message: 'Indiquez les blocs affichés.',
  })
  .max(PUBLIC_PAGE_BLOCKS.length, `La page compte au plus ${PUBLIC_PAGE_BLOCKS.length} blocs.`)
  .superRefine((blocks, ctx) => {
    blocks.forEach((block, i) => {
      if (blocks.indexOf(block) !== i) {
        ctx.addIssue({
          code: 'custom',
          path: [i],
          message: 'Chaque bloc figure au plus une fois.',
        })
      }
    })
  })

// The blocks as stored, read closed: what is not a known block (a value left by a later version of
// the application, say) is ignored, a block named twice counts once, at its first place, and anything
// but a list shows nothing. (A page whose managers never chose holds the default, E09.01's page.)
export function readPublicPageBlocks(stored: unknown): PublicPageBlock[] {
  if (!Array.isArray(stored)) return []
  const shown: PublicPageBlock[] = []
  for (const value of stored) {
    if (isPublicPageBlock(value) && !shown.includes(value)) shown.push(value)
  }
  return shown
}

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
    // E09.04: absent, the blocks stay as they are (a client that does not know them).
    blocks: publicPageBlocksSchema.optional(),
    // E09.06: search engines may index the page while it is published. Absent, kept as it is.
    indexable: z.boolean({ message: 'Indiquez si la page peut être indexée.' }).optional(),
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

// Everything the page's blocks may show, before the managers' choice: the workspace's public fields,
// the offered sessions, whether it receives candidatures and the cards — each already a closed
// projection (`toPublicWorkspace`, `toPublicCommittee`, `toPublicCard`).
export const publicPageContentSchema = z
  .object({
    workspace: publicWorkspaceSchema,
    // The next sessions its managers offer to participation requests (E08.04), by name and time
    // only (`toPublicCommittee`), soonest first, at most `WORKSPACE_PAGE_LIMITS.committees`.
    committees: z.array(publicCommitteeSchema),
    // Whether it receives candidatures (a published candidature form, E05.09).
    receivesCandidatures: z.boolean(),
    // E09.02: the anonymous cards of the requests whose owners consented to show them here, under
    // their pseudonym (`toPublicCard`, showcase-card.schema.ts), the latest consents first, at most
    // `SHOWCASE_CARD_LIMITS.cardsPerPage`.
    cards: z.array(publicCardSchema),
  })
  .strict()
export type PublicPageContent = z.infer<typeof publicPageContentSchema>

export const publicWorkspacePageSchema = z
  .object({
    // Presentation, criteria and contact null when their block is not shown.
    workspace: publicWorkspaceSchema,
    // E09.04: the blocks shown, in their order — those chosen by the managers that have something to
    // show. The fields below hold nothing for a block not shown.
    blocks: z.array(z.enum(PUBLIC_PAGE_BLOCKS)),
    // `committees` block: the next offered sessions.
    committees: z.array(publicCommitteeSchema),
    // `apply` block: a candidature form is published; presented from a Confluent account, never
    // through a sign-up opened by this page.
    receivesCandidatures: z.boolean(),
    // `participate` block: sessions are offered to participation requests (the form itself,
    // `/w/<slug>/participer`, does not depend on the page).
    receivesParticipationRequests: z.boolean(),
    // `cards` block.
    cards: z.array(publicCardSchema),
    // E09.06: its managers allow search engines to index it (`publicPageRobots`).
    indexable: z.boolean(),
  })
  .strict()
export type PublicWorkspacePage = z.infer<typeof publicWorkspacePageSchema>

// ROADMAP E09.06: what a page of the site tells search engines. Every page says `noindex, nofollow`
// (the site's HTML before any script, the web server's `X-Robots-Tag`, the API's answers), but one:
// a workspace's public page whose managers allowed indexing, while it is published. Read closed: only
// `indexable: true` opens it — a page still loading, missing, unpublished or answered by an older API
// stays closed.
export const ROBOTS_CLOSED = 'noindex, nofollow'
export const ROBOTS_OPEN = 'index, follow'
export type RobotsDirective = typeof ROBOTS_CLOSED | typeof ROBOTS_OPEN

export function publicPageRobots(page: unknown): RobotsDirective {
  const indexable =
    typeof page === 'object' && page !== null && (page as { indexable?: unknown }).indexable
  return indexable === true ? ROBOTS_OPEN : ROBOTS_CLOSED
}

// The same with the sessions as the API holds them before they are sent (dates as `Date`).
type WithCommittees<T, C> = Omit<T, 'committees'> & { committees: C[] }

// THE projection of the public page: the content its blocks may show, reduced to the blocks shown,
// in their order. The API answers the public with it, and builds its managers' preview with it; the
// site builds the live preview of settings not yet saved with it too. The workspace's fields are
// copied one by one, the sessions and cards are already closed projections: nothing of `content`
// reaches the page but through a block shown, and a block with nothing to show is not listed.
// E09.06: `indexable` is the managers' choice, read closed (anything but `true` is no).
export function toPublicWorkspacePage<C = PublicCommittee>(
  content: WithCommittees<PublicPageContent, C>,
  shownBlocks: unknown,
  indexable: unknown = false,
): WithCommittees<PublicWorkspacePage, C> {
  const shown = readPublicPageBlocks(shownBlocks)
  const on = (block: PublicPageBlock) => shown.includes(block)
  const { workspace } = content
  const page: WithCommittees<PublicWorkspacePage, C> = {
    workspace: {
      slug: workspace.slug,
      name: workspace.name,
      programName: workspace.programName,
      color: workspace.color,
      presentation: on('presentation') ? workspace.presentation : null,
      criteria: on('criteria') ? workspace.criteria : null,
      contact: on('contact') ? workspace.contact : null,
      logoVersion: workspace.logoVersion,
    },
    blocks: [],
    committees: on('committees') ? [...content.committees] : [],
    receivesCandidatures: on('apply') && content.receivesCandidatures,
    receivesParticipationRequests: on('participate') && content.committees.length > 0,
    cards: on('cards') ? [...content.cards] : [],
    indexable: indexable === true,
  }
  const hasContent: Record<PublicPageBlock, boolean> = {
    presentation: page.workspace.presentation !== null,
    criteria: page.workspace.criteria !== null,
    contact: page.workspace.contact !== null,
    committees: page.committees.length > 0,
    cards: page.cards.length > 0,
    apply: page.receivesCandidatures,
    participate: page.receivesParticipationRequests,
  }
  page.blocks = shown.filter((block) => hasContent[block])
  return page
}

// The page as its managers set it, with what the public sees (or would see, once published) —
// built by the same projection as the public route — and, for a preview of settings not yet saved,
// everything its blocks may show (`content`, through `toPublicWorkspacePage`).
export const workspacePageSettingsSchema = z
  .object({
    published: z.boolean(),
    criteria: z.string().nullable(),
    contact: z.string().nullable(),
    // E09.04: the blocks shown, in their order (some may have nothing to show for now).
    blocks: z.array(z.enum(PUBLIC_PAGE_BLOCKS)),
    // E09.06: search engines may index the page while it is published (no by default).
    indexable: z.boolean(),
    version: z.number().int().positive(),
    preview: publicWorkspacePageSchema,
    content: publicPageContentSchema,
  })
  .strict()
export type WorkspacePageSettings = z.infer<typeof workspacePageSettingsSchema>
