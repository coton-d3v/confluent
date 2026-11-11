import { Link, useSearchParams } from 'react-router-dom'
import {
  ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
  accessLevelSchema,
  type AccessLevel,
  type SharePreview,
} from '@confluent/shared'
import { RecipientDossierView } from '@/features/share-access/components/RecipientDossierView'
import { PREVIEW_LEVEL_PARAM } from '@/features/shares/preview'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

// E07.01 « Voir comme le destinataire »: what a recipient reads at each level — the same view of the
// same projection as their own page —, for the owner of the request or an administrator. Neither a
// link nor a view is recorded; no file is delivered.
export function RecipientPreview({
  dossierName,
  backHref,
  backLabel,
  load,
}: {
  dossierName: string
  backHref: string
  backLabel: string
  load: (level: AccessLevel) => Promise<SharePreview>
}) {
  const [searchParams] = useSearchParams()
  const parsed = accessLevelSchema.safeParse(searchParams.get(PREVIEW_LEVEL_PARAM))
  // Closed by default: an unknown level previews the least shared one.
  const level: AccessLevel = parsed.success ? parsed.data : 'public'
  const query = useAsync(() => load(level), [level])
  const data = query.data?.preview.accessLevel === level ? query.data : undefined

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6">
      <title>{`Voir comme le destinataire · ${dossierName} · Confluent`}</title>
      <nav aria-label="Fil d'Ariane">
        <Link
          to={backHref}
          className="rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          ← {backLabel}
        </Link>
      </nav>
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold text-foreground md:text-[28px]">
          Voir comme le destinataire
        </h1>
        <p className="text-sm text-muted-foreground">
          {dossierName} · ce qu’un destinataire de lien nominatif lit à chaque niveau d’accès.
        </p>
      </header>

      <nav aria-label="Niveau d'accès prévisualisé">
        <ul role="list" className="flex flex-wrap gap-2">
          {ACCESS_LEVELS.map((l) => (
            <li key={l}>
              <Link
                to={`?${PREVIEW_LEVEL_PARAM}=${l}`}
                replace
                aria-current={l === level ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                  l === level
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-card text-foreground hover:border-foreground/40',
                )}
              >
                {ACCESS_LEVEL_LABELS[l]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <p
        role="note"
        className="rounded-md border border-status-pending/50 bg-status-pending/10 px-4 py-3 text-sm text-foreground"
      >
        Aperçu en accès « {ACCESS_LEVEL_LABELS[level]} » : exactement les questions, réponses,
        classification et documents qu’un destinataire lit à ce niveau. Aucun lien n’est créé,
        aucune consultation n’est comptée et les fichiers ne se téléchargent pas depuis l’aperçu.
      </p>

      {query.error ? (
        <p role="alert" className="text-sm text-destructive">
          Impossible de charger l’aperçu.{' '}
          <button type="button" onClick={query.refetch} className="underline underline-offset-4">
            Réessayer
          </button>
        </p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Chargement de l’aperçu…</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Partagé à ce niveau :{' '}
            {plural(data.fields.length, 'question', 'questions')} sur {data.preview.totalQuestions}{' '}
            · {plural(data.documents.length, 'document', 'documents')} sur{' '}
            {data.preview.totalDocuments} choisis pour cette demande.
          </p>
          <div className="flex flex-col gap-8 rounded-lg border border-border bg-background p-4 sm:p-6">
            <RecipientDossierView view={data} accessLevel={level} preview />
          </div>
        </>
      )}
    </div>
  )
}
