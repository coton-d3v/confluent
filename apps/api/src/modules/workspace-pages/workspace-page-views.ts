import { createHash } from 'node:crypto'
import type { Workspace } from '@prisma/client'
import type { PublicWorkspace } from '@confluent/shared'

// Every column of `workspaces`, and whether the public reads it on the workspace's page (ROADMAP
// E09.01): `public` reaches anyone once the page is published, through `toPublicWorkspace`;
// `internal` never leaves the site's signed-in screens. A column added to the table without being
// classified here fails to compile, and the tests check this list against the Prisma model and the
// database (closed by default: a new column is internal until it is named public, and the
// projection copies named fields only).
export const WORKSPACE_COLUMN_AUDIENCE = {
  id: 'internal',
  slug: 'public',
  name: 'public',
  programName: 'public',
  color: 'public',
  presentation: 'public',
  // The address its members reach it at (E05.01); the public page shows `publicContact` instead,
  // which its managers write for anyone.
  contactEmail: 'internal',
  emailDomain: 'internal',
  // The image is served by the public logo route; the key (bucket path, workspace id) never.
  logoKey: 'internal',
  createdAt: 'internal',
  updatedAt: 'internal',
  // The page exists for the public or not (`404` alike for an unknown slug): never a field.
  publicPagePublished: 'internal',
  publicCriteria: 'public',
  publicContact: 'public',
  publicPageVersion: 'internal',
  // E09.04: the managers' choice of blocks. The public reads the blocks shown, in their order, and
  // what each shows (`toPublicWorkspacePage`), never this setting itself.
  publicPageBlocks: 'internal',
} as const satisfies Record<keyof Workspace, 'public' | 'internal'>

// What the public reads of a workspace, copied field by field (@confluent/shared
// `PUBLIC_WORKSPACE_FIELDS`).
export function toPublicWorkspace(row: Workspace): PublicWorkspace {
  return {
    slug: row.slug,
    name: row.name,
    programName: row.programName,
    color: row.color,
    presentation: row.presentation,
    criteria: row.publicCriteria,
    contact: row.publicContact,
    logoVersion: row.logoKey ? logoVersionOf(row.logoKey) : null,
  }
}

// Changes with the stored image (its key is new at each upload), so that a browser never keeps an
// old logo; tells nothing of the key itself.
export function logoVersionOf(logoKey: string): string {
  return createHash('sha256').update(logoKey).digest('hex').slice(0, 16)
}
