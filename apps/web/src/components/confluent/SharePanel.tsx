import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ACCESS_LEVEL_LABELS, ACCESS_LEVELS as SHARE_LEVELS } from '@confluent/shared'
import { StatusDot } from '@/components/confluent/StatusDot'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { AccessEntry, AccessLevel } from '@/features/shares/access-entry'
import { ACCESS_LEVEL_DESCRIPTIONS, PUBLIC_IS_NOT_PUBLISHED } from '@/features/shares/levels'

const shareFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "L'adresse email est requise.")
    .email("Format d'email invalide.")
    .toLowerCase(),
})
type ShareFormValues = z.infer<typeof shareFormSchema>

const ACCESS_LEVELS: { value: AccessLevel; label: string; description: string }[] =
  SHARE_LEVELS.map((value) => ({
    value,
    label: ACCESS_LEVEL_LABELS[value],
    description: ACCESS_LEVEL_DESCRIPTIONS[value],
  }))

export interface SharePanelProps {
  existingEntries: readonly AccessEntry[]
  onSubmitInvitation: (email: string, accessLevel: AccessLevel) => Promise<void>
  // E07.01: the preview « Voir comme le destinataire » at the level chosen.
  previewHref?: (level: AccessLevel) => string
}

export function SharePanel({
  existingEntries,
  onSubmitInvitation,
  previewHref,
}: SharePanelProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('complet')
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ShareFormValues>({
    resolver: zodResolver(shareFormSchema),
    mode: 'onSubmit',
    defaultValues: { email: '' },
  })

  const onSubmit = handleSubmit(async ({ email }) => {
    if (
      existingEntries.some(
        (entry) => entry.email === email && entry.status !== 'revoked',
      )
    ) {
      setError('email', {
        type: 'duplicate',
        message: 'Cette adresse est déjà invitée.',
      })
      return
    }
    setIsSubmitting(true)
    try {
      await onSubmitInvitation(email, accessLevel)
      reset()
      setAccessLevel('complet')
    } catch (err) {
      const message =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : "L'invitation a échoué. Réessayez."
      setError('email', { type: 'server', message })
    } finally {
      setIsSubmitting(false)
    }
  })

  return (
    <SheetContent className="w-[300px] duration-150 sm:max-w-[300px]">
      <SheetHeader>
        <SheetTitle>Partager le dossier</SheetTitle>
        <SheetDescription>
          Invitez une personne par son adresse email : elle seule lira la demande, une
          fois connectée, au niveau choisi.
        </SheetDescription>
      </SheetHeader>

      <Separator />

      <form onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-4 px-4 py-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="share-email">Email du destinataire</Label>
            <Input
              id="share-email"
              type="email"
              autoFocus
              autoComplete="email"
              placeholder="marc@fonds.fr"
              aria-required="true"
              aria-invalid={errors.email ? 'true' : undefined}
              aria-describedby={errors.email ? 'share-email-error' : undefined}
              {...register('email')}
            />
            <div aria-live="assertive" aria-atomic="true" className="min-h-[1em]">
              {errors.email && (
                <p id="share-email-error" className="text-xs text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium text-foreground">
              Niveau d&apos;accès
            </legend>
            <p className="mb-1 text-xs text-muted-foreground">{PUBLIC_IS_NOT_PUBLISHED}</p>
            {ACCESS_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                aria-pressed={accessLevel === level.value}
                onClick={() => setAccessLevel(level.value)}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                  accessLevel === level.value
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-card hover:border-foreground/40',
                )}
              >
                <span className="block text-sm font-medium">{level.label}</span>
                <span
                  className={cn(
                    'block text-xs',
                    accessLevel === level.value
                      ? 'text-background/70'
                      : 'text-muted-foreground',
                  )}
                >
                  {level.description}
                </span>
              </button>
            ))}
          </fieldset>
          {previewHref && (
            <Link
              to={previewHref(accessLevel)}
              className="self-start rounded-sm text-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              Voir ce que lira le destinataire
            </Link>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 p-4 sm:flex-row-reverse sm:justify-start">
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? 'Envoi…' : "Envoyer l'invitation"}
          </Button>
          <SheetClose
            render={<Button type="button" variant="outline" size="lg" />}
          >
            Annuler
          </SheetClose>
        </SheetFooter>
      </form>

      <Separator />

      <div className="flex flex-col gap-2 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Destinataires existants
        </p>
        {existingEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Aucun destinataire pour le moment.
          </p>
        ) : (
          <ul role="list" className="m-0 flex list-none flex-col gap-1.5 p-0">
            {existingEntries.map((entry) => (
              <li
                // A recipient invited again after a revocation has two entries.
                key={entry.id}
                className="flex min-w-0 items-center gap-2"
              >
                <StatusDot status={entry.status} />
                <span
                  className="truncate text-sm text-foreground"
                  title={entry.email}
                >
                  {entry.email}
                </span>
                <AccessLevelBadge level={entry.accessLevel} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </SheetContent>
  )
}

const LEVEL_STYLES: Record<AccessLevel, { label: string; className: string }> = {
  public: { label: 'Public', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  partiel: { label: 'Partiel', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  complet: { label: 'Complet', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

function AccessLevelBadge({ level }: { level: AccessLevel }) {
  const style = LEVEL_STYLES[level] ?? LEVEL_STYLES.complet
  return (
    <span
      className={cn(
        'ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
        style.className,
      )}
    >
      {style.label}
    </span>
  )
}
