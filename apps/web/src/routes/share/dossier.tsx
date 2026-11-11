import { useMemo } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import {
  CLASSIFICATION_DIMENSIONS,
  DOCUMENT_TYPE_LABELS,
  TECH_TAG_LABELS,
  type AccessLevel,
  type DocumentGroup,
  type DocumentVersion,
  type FinanceurShareResponse,
} from '@confluent/shared'
import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
import { DossierField } from '@/components/confluent/DossierField'
import { Badge } from '@/components/ui/badge'
import { buildDynamicQuestionnaire } from '@/features/questionnaire/adapter'
import { answerLabel } from '@/features/questionnaire/answer-label'
import { AccessDeniedPage } from '@/routes/share/AccessDeniedPage'
import { RequestPresentation } from '@/features/dossiers/components/RequestPresentation'
import { hasPresentation } from '@/features/dossiers/presentation'

// The API already filters fields, answers and documents by the share's access level; this page only
// explains to the financeur what the level leaves out.
const ACCESS_LEVEL_NOTICE: Record<AccessLevel, string> = {
  public:
    'Accès public : seules les informations d’identité du projet, et leurs pièces jointes, sont partagées avec vous.',
  partiel:
    'Accès partiel : les données financières et les documents réservés à l’accès complet ne sont pas partagés avec vous.',
  complet: 'Accès complet : l’entrepreneur partage l’intégralité de son dossier.',
}

const ancrageLabel = (value: string) =>
  CLASSIFICATION_DIMENSIONS.ancrage_cvl.values.find((v) => v.value === value)?.label ?? value

// Former address of the shared dossier: the share link itself now shows it, read once (R04).
export default function ShareDossierRoute() {
  const { token } = useParams<{ token: string }>()
  if (!token) return <AccessDeniedPage />
  return <Navigate to={`/share/${encodeURIComponent(token)}`} replace />
}

export function SharedDossierPage({ data }: { data: FinanceurShareResponse }) {
  return (
    <>
      <title>{data.dossier.name} · Confluent</title>
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 bg-background px-6 py-8 lg:max-w-3xl lg:px-10">
        <ConfluentWordmark className="h-6 w-auto text-foreground" />
        <header className="flex flex-col gap-3">
          <h1 className="font-heading text-2xl font-semibold text-foreground md:text-3xl">
            {data.dossier.name}
          </h1>
          <ClassificationBadges dossier={data.dossier} />
          <p className="text-sm text-muted-foreground">
            Accès accordé à{' '}
            <span className="font-medium text-foreground">{data.share.recipientEmail}</span>
          </p>
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            {ACCESS_LEVEL_NOTICE[data.share.accessLevel]}
          </p>
        </header>
        {/* E05.07: the request's presentation, sent once its owner has published it. */}
        {hasPresentation(data.dossier) && (
          <section aria-labelledby="request-heading" className="flex flex-col gap-3">
            <h2
              id="request-heading"
              className="font-heading text-xl font-semibold text-foreground md:text-2xl"
            >
              La demande de financement
            </h2>
            <RequestPresentation dossier={data.dossier} />
          </section>
        )}
        <SharedAnswers data={data} />
        <SharedDocuments data={data} />
      </main>
    </>
  )
}

function ClassificationBadges({ dossier }: { dossier: FinanceurShareResponse['dossier'] }) {
  const labels = [
    dossier.sector,
    dossier.maturityStage,
    dossier.ancrageCvl && ancrageLabel(dossier.ancrageCvl),
    dossier.tagTechnologique && (TECH_TAG_LABELS[dossier.tagTechnologique] ?? dossier.tagTechnologique),
  ].filter((l): l is string => Boolean(l))
  if (labels.length === 0) return null
  return (
    <ul role="list" className="flex flex-wrap gap-2">
      {labels.map((label) => (
        <li key={label}>
          <Badge variant="secondary">{label}</Badge>
        </li>
      ))}
    </ul>
  )
}

function SharedAnswers({ data }: { data: FinanceurShareResponse }) {
  const questionnaire = useMemo(
    () => buildDynamicQuestionnaire({ sections: data.sections, fields: data.fields }),
    [data.sections, data.fields],
  )
  const answersByFieldId = useMemo(
    () => Object.fromEntries(data.answers.map((a) => [a.fieldId, a.value])),
    [data.answers],
  )
  const filesByField = useMemo(() => attachmentsByField(data), [data])

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
          <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
            {i + 1}. {section.title}
          </h2>
          <dl className="mt-4 flex flex-col gap-6">
            {section.questions.map((q) =>
              q.fieldType === 'file' ? (
                <DossierField key={q.id} label={q.label} value="">
                  <AttachedFiles documents={filesByField.get(q.id) ?? []} />
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
function attachmentsByField(data: FinanceurShareResponse): Map<string, DocumentGroup[]> {
  const fileFields = new Set(data.fields.filter((f) => f.fieldType === 'file').map((f) => f.id))
  const byField = new Map<string, DocumentGroup[]>()
  for (const doc of data.documents) {
    if (doc.fieldId && fileFields.has(doc.fieldId)) {
      byField.set(doc.fieldId, [...(byField.get(doc.fieldId) ?? []), doc])
    }
  }
  return byField
}

function AttachedFiles({ documents }: { documents: DocumentGroup[] }) {
  if (documents.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <ul role="list" className="flex flex-col gap-1">
      {documents.map((doc) => (
        <li key={doc.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="min-w-0 truncate">{doc.filename}</span>
          <DocumentLink version={doc.current} />
        </li>
      ))}
    </ul>
  )
}

// The other documents of the dossier: those that answer no question shown on this page.
function SharedDocuments({ data }: { data: FinanceurShareResponse }) {
  const fileFields = new Set(data.fields.filter((f) => f.fieldType === 'file').map((f) => f.id))
  const documents = data.documents.filter((d) => !d.fieldId || !fileFields.has(d.fieldId))
  // Below `complet` these documents are not shared: say nothing rather than « Aucun document ».
  if (documents.length === 0 && data.share.accessLevel !== 'complet') return null
  return (
    <section>
      <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">Documents</h2>
      {documents.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Aucun document déposé.</p>
      ) : (
        <ul role="list" className="mt-4 flex flex-col divide-y divide-border rounded-lg border border-border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{doc.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {DOCUMENT_TYPE_LABELS[doc.type]} · Version {doc.current.version} ·{' '}
                  {formatSize(doc.current.size)}
                </p>
              </div>
              <DocumentLink version={doc.current} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function DocumentLink({ version }: { version: DocumentVersion }) {
  if (version.availability === 'available' && version.url) {
    return (
      <a
        href={version.url}
        className="shrink-0 text-sm font-medium text-foreground underline underline-offset-4"
      >
        Télécharger
      </a>
    )
  }
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {version.availability === 'missing' ? 'Fichier à redéposer par le porteur' : 'Momentanément indisponible'}
    </span>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}
