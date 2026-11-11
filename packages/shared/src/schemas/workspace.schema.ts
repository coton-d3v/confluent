import { z } from 'zod'
import { documentAvailabilitySchema } from './document.schema.js'

// Workspaces (ROADMAP E05.01): the space of one structure (CCI, incubator, investor network, club
// deal) and its settings. Same rules for the site (immediate feedback) and the API (authoritative).

export const WORKSPACE_LIMITS = {
  name: 120,
  programName: 120,
  presentation: 5000,
  slugMin: 2,
  slugMax: 60,
} as const

// The logo is shown in `<img>` tags only: raster formats a browser displays, never SVG (it can carry
// scripts) nor HEIC (not displayed by most browsers).
export const WORKSPACE_LOGO_MAX_BYTES = 1024 * 1024
export const WORKSPACE_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const WORKSPACE_LOGO_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const
export const WORKSPACE_LOGO_FORMATS_LABEL = 'PNG, JPEG ou WebP'

// Public, stable identifier (future `/w/<slug>` page, E09): lower-case ASCII letters, digits and
// single hyphens. Chosen at creation, never changed afterwards.
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const workspaceSlugSchema = z
  .string()
  .trim()
  .min(WORKSPACE_LIMITS.slugMin, `Le slug compte au moins ${WORKSPACE_LIMITS.slugMin} caractères.`)
  .max(WORKSPACE_LIMITS.slugMax, `Le slug compte au plus ${WORKSPACE_LIMITS.slugMax} caractères.`)
  .regex(
    WORKSPACE_SLUG_PATTERN,
    'Le slug ne contient que des lettres minuscules sans accent, des chiffres et des tirets simples.',
  )

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Le nom est obligatoire.')
  .max(WORKSPACE_LIMITS.name, `Le nom compte au plus ${WORKSPACE_LIMITS.name} caractères.`)

// Optional settings: an empty or blank value clears the setting (stored as null).
const blankToNull = (v: string) => (v === '' ? null : v)

const programNameSchema = z
  .string()
  .trim()
  .max(
    WORKSPACE_LIMITS.programName,
    `Le nom du programme compte au plus ${WORKSPACE_LIMITS.programName} caractères.`,
  )
  .transform(blankToNull)
  .nullable()

export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/

// `#RRGGBB`, stored in lower case.
const colorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === '' || HEX_COLOR_PATTERN.test(v), {
    message: 'La couleur s’écrit au format hexadécimal #RRGGBB, par exemple #1d4ed8.',
  })
  .transform(blankToNull)
  .nullable()

// Presentation of the structure: plain text, line breaks kept, never interpreted as HTML or
// Markdown wherever it is shown (site, emails, MCP). Tags are refused so that nobody types HTML
// believing it will be rendered.
const HTML_TAG = /<\/?[a-z!][^>]*>/i
const presentationSchema = z
  .string()
  .transform((v) => v.replace(/\r\n?/g, '\n').trim())
  .pipe(
    z
      .string()
      .max(
        WORKSPACE_LIMITS.presentation,
        `La présentation compte au plus ${WORKSPACE_LIMITS.presentation} caractères.`,
      )
      .refine((v) => !HTML_TAG.test(v), {
        message: 'La présentation est un texte simple : les balises HTML ne sont pas acceptées.',
      }),
  )
  .transform(blankToNull)
  .nullable()

const emailCheck = z.string().email()
const contactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'L’adresse de contact est trop longue.')
  .refine((v) => v === '' || emailCheck.safeParse(v).success, {
    message: 'L’adresse de contact n’est pas une adresse email valide.',
  })
  .transform(blankToNull)
  .nullable()

// A host name in ASCII (internationalised names in their `xn--` form), with at least one dot.
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

// The part after « @ » of the addresses a structure accepts, e.g. `cci-touraine.fr`. Accepts
// `@cci-touraine.fr` and upper case; an internationalised name is converted to its ASCII form, the
// one email addresses are compared with. Anything else (address, URL, path, port) is refused rather
// than cut down to a domain the administrator did not type.
export function normalizeEmailDomain(raw: string): string | null {
  const value = raw.trim().toLowerCase().replace(/^@/, '')
  if (value === '' || /[\s/:@?#\\%]/.test(value)) return null
  let host: string
  try {
    host = new URL(`http://${value}`).hostname
  } catch {
    return null
  }
  return DOMAIN_PATTERN.test(host) ? host : null
}

const emailDomainSchema = z
  .string()
  .transform((v, ctx) => {
    if (v.trim() === '') return null
    const domain = normalizeEmailDomain(v)
    if (!domain) {
      ctx.addIssue({
        code: 'custom',
        message: 'Le domaine email s’écrit sans « @ » ni adresse, par exemple cci-touraine.fr.',
      })
      return z.NEVER
    }
    return domain
  })
  .nullable()

const settingsShape = {
  name: nameSchema,
  // Shown as the program's name (e.g. « MoneyPlace, propulsé par Confluent »); null: the name.
  programName: programNameSchema.optional(),
  color: colorSchema.optional(),
  presentation: presentationSchema.optional(),
  contactEmail: contactEmailSchema.optional(),
  // Restriction of the addresses this workspace may invite (applied from E05.02 on, server-side).
  emailDomain: emailDomainSchema.optional(),
}

// Unknown keys are refused rather than ignored, `slug` included on update: it never changes.
export const createWorkspaceSchema = z
  .object({
    ...settingsShape,
    // Derived from the name when omitted.
    slug: workspaceSlugSchema.optional(),
  })
  .strict()

export const updateWorkspaceSchema = z
  .object(settingsShape)
  .partial()
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Indiquez au moins un réglage à modifier.',
  })

export const workspaceLogoSchema = z.object({
  // `missing`: the stored image is lost and must be sent again; `unavailable`: the storage could not
  // be reached for now. Only an `available` logo has a URL (signed, valid 15 minutes).
  availability: documentAvailabilitySchema,
  url: z.string().min(1).nullable(),
})

export const workspaceSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  programName: z.string().nullable(),
  color: z.string().nullable(),
  presentation: z.string().nullable(),
  contactEmail: z.string().nullable(),
  emailDomain: z.string().nullable(),
  logo: workspaceLogoSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type CreateWorkspaceInput = z.input<typeof createWorkspaceSchema>
export type UpdateWorkspaceInput = z.input<typeof updateWorkspaceSchema>
export type WorkspaceLogo = z.infer<typeof workspaceLogoSchema>
export type Workspace = z.infer<typeof workspaceSchema>
