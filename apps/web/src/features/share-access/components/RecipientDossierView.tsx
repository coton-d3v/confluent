import { useMemo } from 'react'
import {
  CLASSIFICATION_DIMENSIONS,
  DOCUMENT_TYPE_LABELS,
  TECH_TAG_LABELS,
  isArchived,
  type AccessLevel,
  type DocumentGroup,
  type DocumentVersion,
  type RecipientView,
} from '@confluent/shared'
import { toast } from 'sonner'
import { DossierField } from '@/components/confluent/DossierField'
import { Badge } from '@/components/ui/badge'
import { buildDynamicQuestionnaire } from '@/features/questionnaire/adapter'
import { answerLabel } from '@/features/questionnaire/answer-label'
import { RequestPresentation } from '@/features/dossiers/components/RequestPresentation'
import { hasPresentation } from '@/features/dossiers/presentation'
import { linkExpired } from '@/features/documents/link-lifetime'

// The API already filters fields, answers and documents by the share's access level; this page only
// explains to the recipient what the level leaves out.
const ACCESS_LEVEL_NOTICE: Record<AccessLevel, string> = {
  public:
    'Accès « Public », le plus restreint : seules les informations de base du projet, et leurs pièces jointes, sont partagées avec vous. Cet accès vous est personnel : la demande n’est pas rendue publique.',
  partiel:
    'Accès partiel : les données financières et les documents réservés à l’accès complet ne sont pas partagés avec vous.',
  complet: 'Accès complet : l’entrepreneur partage l’intégralité de son dossier.',
}

const ancrageLabel = (value: string) =>
  CLASSIFICATION_DIMENSIONS.ancrage_cvl.values.find((v) => v.value === value)?.label ?? value

export interface RecipientDossierViewProps {
  view: RecipientView
  accessLevel: AccessLevel
  // The recipient's address, on their own page; absent from a preview, which has no recipient.
  recipientEmail?: string
  // E07.01 « Voir comme le destinataire »: the same view, inside the site, without any file.
  preview?: boolean
}

// What the recipient of a share reads (E07.01): the page of their link and the preview of its owner
// render this one view of the one projection the API builds for both.
export function RecipientDossierView({
  view,
  accessLevel,
  recipientEmail,
  preview = false,
}: RecipientDossierViewProps) {
  const Title = preview ? 'h2' : 'h1'
  const Heading = preview ? 'h3' : 'h2'
  return (
    // `contents`: the parent's layout applies to the view's parts; the attribute names the view.
    <div data-recipient-view className="contents">
      <header className="flex flex-col gap-3">
        <Title className="font-heading text-2xl font-semibold text-foreground md:text-3xl">
          {view.dossier.name}
        </Title>
        <ClassificationBadges dossier={view.dossier} />
        {recipientEmail && (
          <p className="text-sm text-muted-foreground">
            Accès accordé à{' '}
            <span className="font-medium text-foreground">{recipientEmail}</span>
          </p>
        )}
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {ACCESS_LEVEL_NOTICE[accessLevel]}
        </p>
        {/* E06.01: a closed request keeps its shares, without its presentation. */}
        {isArchived(view.dossier) && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Le porteur de projet a archivé cette demande : sa présentation n’est plus diffusée.
          </p>
        )}
      </header>
      {/* E05.07: the request's presentation, sent once its owner has published it. */}
      {hasPresentation(view.dossier) && (
        <section aria-labelledby="request-heading" className="flex flex-col gap-3">
          <Heading
            id="request-heading"
            className="font-heading text-xl font-semibold text-foreground md:text-2xl"
          >
            La demande de financement
          </Heading>
          <RequestPresentation dossier={view.dossier} />
        </section>
      )}
      <SharedAnswers view={view} Heading={Heading} preview={preview} />
      <SharedDocuments view={view} accessLevel={accessLevel} Heading={Heading} preview={preview} />
    </div>
  )
}

function ClassificationBadges({ dossier }: { dossier: RecipientView['dossier'] }) {
  const labels = [
    dossier.sector,
    dossier.maturityStage,
    dossier.ancrageCvl && ancrageLabel(dossier.ancrageCvl),
    dossier.tagTechnologique && (TECH_TAG_LABELS[dossier.tagTechnologique] ?? dossier.tagTechnologique),
  ].filter((l): l is string => Boolean(l))
  if (labels.length === 0) return null
  return (
    <ul role="list" aria-label="Classification" className="flex flex-wrap gap-2">
      {labels.map((label) => (
        <li key={label}>
          <Badge variant="secondary">{label}</Badge>
        </li>
      ))}
    </ul>
  )
}

type HeadingTag = 'h2' | 'h3'

function SharedAnswers({
  view,
  Heading,
  preview,
}: {
  view: RecipientView
  Heading: HeadingTag
  preview: boolean
}) {
  const questionnaire = useMemo(
    () => buildDynamicQuestionnaire({ sections: view.sections, fields: view.fields }),
    [view.sections, view.fields],
  )
  const answersByFieldId = useMemo(
    () => Object.fromEntries(view.answers.map((a) => [a.fieldId, a.value])),
    [view.answers],
  )
  const filesByField = useMemo(() => attachmentsByField(view), [view])

  if (questionnaire.totalQuestions === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune réponse n’est partagée à ce niveau d’accès.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-10">
      {questionnaire.sections.map((section, i) => (
        <section key={section.id}>
          <Heading className="font-heading text-xl font-semibold text-foreground md:text-2xl">
            {i + 1}. {section.title}
          </Heading>
          <dl className="mt-4 flex flex-col gap-6">
            {section.questions.map((q) =>
              q.fieldType === 'file' ? (
                <DossierField key={q.id} label={q.label} value="">
                  <AttachedFiles documents={filesByField.get(q.id) ?? []} preview={preview} />
                </DossierField>
              ) : (
                <DossierField
                  key={q.id}
                  label={q.label}
                  value={answerLabel(q, answersByFieldId[q.id] ?? '')}
                />
              ),
            )}
          </dl>
        </section>
      ))}
    </div>
  )
}

// Files shown under the question they answer (E03.11); the API only sends those the level may read.
function attachmentsByField(view: RecipientView): Map<string, DocumentGroup[]> {
  const fileFields = new Set(view.fields.filter((f) => f.fieldType === 'file').map((f) => f.id))
  const byField = new Map<string, DocumentGroup[]>()
  for (const doc of view.documents) {
    if (doc.fieldId && fileFields.has(doc.fieldId)) {
      byField.set(doc.fieldId, [...(byField.get(doc.fieldId) ?? []), doc])
    }
  }
  return byField
}

function AttachedFiles({ documents, preview }: { documents: DocumentGroup[]; preview: boolean }) {
  if (documents.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <ul role="list" className="flex flex-col gap-1">
      {documents.map((doc) => (
        <li key={doc.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="min-w-0 truncate">{doc.filename}</span>
          <DocumentLink version={doc.current} preview={preview} />
        </li>
      ))}
    </ul>
  )
}

// The other documents of the dossier: those that answer no question shown on this page.
function SharedDocuments({
  view,
  accessLevel,
  Heading,
  preview,
}: {
  view: RecipientView
  accessLevel: AccessLevel
  Heading: HeadingTag
  preview: boolean
}) {
  const fileFields = new Set(view.fields.filter((f) => f.fieldType === 'file').map((f) => f.id))
  const documents = view.documents.filter((d) => !d.fieldId || !fileFields.has(d.fieldId))
  // Below `complet` these documents are not shared: say nothing rather than « Aucun document ».
  if (documents.length === 0 && accessLevel !== 'complet') return null
  return (
    <section>
      <Heading className="font-heading text-xl font-semibold text-foreground md:text-2xl">
        Documents
      </Heading>
      {documents.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Aucun document déposé.</p>
      ) : (
        <ul role="list" className="mt-4 flex flex-col divide-y divide-border rounded-lg border border-border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{doc.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {DOCUMENT_TYPE_LABELS[doc.type]} · Version {doc.current.version} ·{' '}
                  {formatSize(doc.current.size)}
                </p>
              </div>
              <DocumentLink version={doc.current} preview={preview} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function DocumentLink({ version, preview }: { version: DocumentVersion; preview: boolean }) {
  // A preview delivers no file (E07.01): it says what the recipient could do.
  if (preview && version.availability === 'available') {
    return <span className="shrink-0 text-xs text-muted-foreground">Téléchargeable par le destinataire</span>
  }
  if (version.availability === 'available' && version.url) {
    return (
      <a
        href={version.url}
        className="shrink-0 text-sm font-medium text-foreground underline underline-offset-4"
        onClick={(event) => {
          // E10.06: the storage's own error page otherwise.
          if (!linkExpired(version)) return
          event.preventDefault()
          toast.error(
            'Ce lien de téléchargement a expiré (il est valable 15 minutes) : rechargez la page pour en obtenir un nouveau.',
          )
        }}
      >
        Télécharger
      </a>
    )
  }
  // E10.06: the rest of the request stays readable; the reader learns why this file is not offered.
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {version.availability === 'missing'
        ? 'Pièce indisponible : fichier à redéposer par le porteur'
        : 'Pièce momentanément indisponible : rechargez la page plus tard'}
    </span>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}
