import { Link } from 'react-router-dom'
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
  publicationStatus?: 'draft' | 'published'
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
  createdAt,
  className,
}: DossierCardProps) {
  const relativeCreatedAt = formatRelativeDate(createdAt)
  const accessLabel =
    activeShareLinksCount === undefined ? null : formatAccessLabel(activeShareLinksCount)
  const sectorLabel = sector ?? 'Secteur non classifié'
  const maturityLabel = maturity ?? 'À soumettre'
  const publicationLabel =
    publicationStatus === undefined
      ? null
      : publicationStatus === 'published'
        ? 'Publiée'
        : 'Brouillon'
  const ariaLabel = [
    name,
    companyName && `entreprise ${companyName}`,
    publicationLabel && `demande ${publicationLabel.toLowerCase()}`,
    `secteur ${sectorLabel}`,
    `stade ${maturityLabel}`,
    accessLabel,
    `créé ${relativeCreatedAt}`,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <Link
      to={`/dashboard/dossiers/view/${slug}`}
      aria-label={ariaLabel}
      className={cn(
        'group flex min-h-11 flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors',
        'hover:border-foreground/20',
        'focus-visible:border-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words text-base font-medium text-foreground">
          {name}
        </h3>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {isShared && (
            <Badge variant="outline" className="shrink-0">
              Partagé avec moi
            </Badge>
          )}
          {publicationLabel && (
            <Badge variant={publicationStatus === 'published' ? 'default' : 'outline'} className="shrink-0">
              {publicationLabel}
            </Badge>
          )}
          <Badge variant="secondary" className="shrink-0">
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
