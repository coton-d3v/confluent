import { Link } from 'react-router-dom'
import { DOSSIER_PUBLICATION_STATUS_LABELS, type DossierPublicationStatus } from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatRelativeDate } from '@/lib/relative-date'

export interface DossierCardProps {
  slug: string
  name: string
  sector: string | null
  maturity: string | null
  activeShareLinksCount?: number
  isShared?: boolean
  ownerEmail?: string
  ownerName?: string
  // E05.07: for the owner, the company the request belongs to and its publication.
  companyName?: string
  publicationStatus?: DossierPublicationStatus
  // E05.08: a company the signed-in conseiller prepares for an entrepreneur.
  inPreparation?: boolean
  createdAt: string
  className?: string
}

function formatAccessLabel(count: number): string {
  if (count <= 1) return `${count} accès actif`
  return `${count} accès actifs`
}

export function DossierCard({
  slug,
  name,
  sector,
  maturity,
  activeShareLinksCount,
  isShared,
  ownerEmail,
  ownerName,
  companyName,
  publicationStatus,
  inPreparation,
  createdAt,
  className,
}: DossierCardProps) {
  const relativeCreatedAt = formatRelativeDate(createdAt)
  const accessLabel =
    activeShareLinksCount === undefined ? null : formatAccessLabel(activeShareLinksCount)
  const sectorLabel = sector ?? 'Secteur non classifié'
  const maturityLabel = maturity ?? 'À soumettre'
  const publicationLabel =
    publicationStatus === undefined ? null : DOSSIER_PUBLICATION_STATUS_LABELS[publicationStatus]
  return (
    // E10.07: no aria-label: the link is named by the text it shows, so that what is read and what
    // a voice command names agree (WCAG 2.5.3).
    <Link
      to={`/dashboard/dossiers/view/${slug}`}
      className={cn(
        'group flex min-h-11 flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors',
        'hover:border-foreground/20',
        'focus-visible:border-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="min-w-0 wrap-anywhere text-base font-medium text-foreground">
          {name}
        </h3>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {isShared && (
            <Badge variant="outline" className="shrink-0">
              Partagé avec moi
            </Badge>
          )}
          {inPreparation && (
            <Badge variant="outline" className="shrink-0">
              En préparation
            </Badge>
          )}
          {publicationLabel && (
            <Badge variant={publicationStatus === 'published' ? 'default' : 'outline'} className="shrink-0">
              {publicationLabel}
            </Badge>
          )}
          <Badge variant="secondary" className="shrink-0">
            <span className="sr-only">Stade : </span>
            {maturityLabel}
          </Badge>
        </div>
      </div>
      {companyName && companyName !== name && (
        <p className="text-xs text-muted-foreground">{companyName}</p>
      )}
      <p className="text-xs text-muted-foreground">{sectorLabel}</p>
      {isShared && ownerEmail && (
        <p className="text-xs text-muted-foreground">Partagé par {ownerName ?? ownerEmail}</p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {accessLabel && (
          <>
            <span>{accessLabel}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <span>{`Créé ${relativeCreatedAt}`}</span>
      </div>
    </Link>
  )
}
