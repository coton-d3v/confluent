import { Link } from 'react-router-dom'
import { ACCESS_LEVELS, ACCESS_LEVEL_LABELS } from '@confluent/shared'
import { StatusDot } from '@/components/confluent/StatusDot'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { AccessEntry, AccessLevel } from '@/features/shares/access-entry'
import { cn } from '@/lib/utils'

function formatRevokedTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

const LEVEL_STYLES: Record<AccessLevel, string> = {
  public: 'bg-amber-50 text-amber-700 border-amber-200',
  partiel: 'bg-blue-50 text-blue-700 border-blue-200',
  complet: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

export function AccessLevelBadge({ level }: { level: AccessLevel }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
        LEVEL_STYLES[level] ?? LEVEL_STYLES.public,
      )}
    >
      {ACCESS_LEVEL_LABELS[level] ?? ACCESS_LEVEL_LABELS.public}
    </span>
  )
}

export interface AccessListRowProps {
  entry: AccessEntry
  onRevokeClick?: (entry: AccessEntry) => void
  // E07.01: the owner changes the level of an active access; the recipient keeps the same link.
  onLevelChange?: (entry: AccessEntry, level: AccessLevel) => void
  levelChanging?: boolean
  // « Voir comme ce destinataire »: the preview at this access's level.
  previewHref?: string
  className?: string
}

export function AccessListRow({
  entry,
  onRevokeClick,
  onLevelChange,
  levelChanging = false,
  previewHref,
  className,
}: AccessListRowProps) {
  const isRevoked = entry.status === 'revoked'
  const isPending = entry.status === 'pending'

  return (
    <li
      className={cn(
        'flex flex-col gap-3 px-4 py-3 not-[:first-child]:border-t not-[:first-child]:border-border sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-w-0 items-center gap-3',
          isRevoked && 'opacity-[0.55]',
        )}
      >
        <Avatar role="img" aria-label={entry.email}>
          <AvatarFallback>{entry.initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium text-foreground"
            title={entry.email}
          >
            {entry.email}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {entry.lastSeen}
          </p>
        </div>
        {isRevoked || !onLevelChange ? (
          <AccessLevelBadge level={entry.accessLevel} />
        ) : (
          <NativeSelect
            aria-label={`Niveau d'accès de ${entry.email}`}
            value={entry.accessLevel}
            disabled={levelChanging}
            onChange={(e) => onLevelChange(entry, e.target.value as AccessLevel)}
            className="h-9 w-auto shrink-0"
          >
            {ACCESS_LEVELS.map((level) => (
              <option key={level} value={level}>
                {ACCESS_LEVEL_LABELS[level]}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:justify-end">
        <span
          className={cn(
            'text-[22px] tabular-nums',
            isPending
              ? 'font-normal text-muted-foreground'
              : 'font-bold text-foreground',
            isRevoked && 'opacity-[0.55]',
          )}
        >
          {entry.sessionDuration}
        </span>
        <StatusDot status={entry.status} />
        {previewHref && !isRevoked && (
          <Link
            to={previewHref}
            aria-label={`Voir comme ${entry.email}`}
            className="inline-flex min-h-11 items-center rounded-sm text-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            Voir comme ce destinataire
          </Link>
        )}
        {entry.status === 'revoked' ? (
          <Tooltip>
            <TooltipTrigger
              className="cursor-help rounded-sm text-xs text-muted-foreground opacity-[0.55] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] focus-visible:opacity-100"
              render={<span tabIndex={0} />}
            >
              Révoqué le {entry.revokedAt}
              {entry.revokedBy !== '—' && ` par ${entry.revokedBy}`}
            </TooltipTrigger>
            <TooltipContent>
              <p>à {formatRevokedTime(entry.revokedAtIso)}</p>
            </TooltipContent>
          </Tooltip>
        ) : onRevokeClick ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Révoquer l'accès de ${entry.email}`}
            onClick={() => onRevokeClick(entry)}
            className="min-h-11 border-border hover:border-destructive hover:bg-transparent hover:text-destructive"
          >
            Révoquer
          </Button>
        ) : null}
      </div>
    </li>
  )
}
