import { WORKSPACE_LOGO_TYPES } from '@confluent/shared'
import { detectDocumentType } from '../documents/document-types'

type LogoType = (typeof WORKSPACE_LOGO_TYPES)[number]

const EXTENSIONS: Record<LogoType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

// The logo's format, recognised from its content like documents (never from the name or the type
// the browser announces), or null when it is not an accepted image format.
export function detectLogoType(buffer: Buffer): { mimetype: LogoType; extension: string } | null {
  const detected = detectDocumentType(buffer, '')
  const mimetype = WORKSPACE_LOGO_TYPES.find((t) => t === detected)
  return mimetype ? { mimetype, extension: EXTENSIONS[mimetype] } : null
}
