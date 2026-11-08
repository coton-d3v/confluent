import { useMemo } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import type { AccessLevel, DocumentGroup, FinanceurShareResponse } from '@confluent/shared'
import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
import { DossierField } from '@/components/confluent/DossierField'
import { Badge } from '@/components/ui/badge'
import { useSharedDossier } from '@/features/share-access/useSharedDossier'
import { buildDynamicQuestionnaire } from '@/features/questionnaire/adapter'
import { AccessDeniedPage } from '@/routes/share/AccessDeniedPage'
import { RecipientMismatchPage } from '@/routes/share/RecipientMismatchPage'

// The API already filters fields, answers and documents by the share's access level; this page only
// explains to the financeur what the level leaves out.
const ACCESS_LEVEL_NOTICE: Record<AccessLevel, string> = {
  public: 'Accès public : seules les informations d’identité du projet sont partagées avec vous.',
  partiel: 'Accès partiel : les données financières et les documents ne sont pas partagés avec vous.',
  complet: 'Accès complet : l’entrepreneur partage l’intégralité de son dossier.',
}

const ANCRAGE_LABEL: Record<string, string> = {
  ancré: 'Basé en Centre-Val de Loire',
  en_cours: 'S’installe en Centre-Val de Loire',
  découverte: 'Découvre l’écosystème Centre-Val de Loire',
}

const TAG_TECHNO_LABEL: Record<string, string> = {
  deeptech: 'Deeptech',
  tech: 'Tech',
  non_tech: 'Non tech',
}

export default function ShareDossierRoute() {
  const { token } = useParams<{ token: string }>()
  if (!token) return <AccessDeniedPage />
  return <ShareDossierView token={token} />
}

function ShareDossierView({ token }: { token: string }) {
  const state = useSharedDossier(token)
  if (state.status === 'anonymous') {
    return <Navigate to={`/share/${encodeURIComponent(token)}`} replace />
  }
  if (state.status === 'mismatch') return <RecipientMismatchPage email={state.email} />
  if (state.status === 'denied') return <AccessDeniedPage />
  if (state.status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
        <p className="text-sm text-muted-foreground">Chargement du dossier…</p>
      </main>
    )
  }
  const { data } = state

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
        <SharedAnswers data={data} />
        {data.documents && <SharedDocuments documents={data.documents} />}
      </main>
    </>
  )
}

function ClassificationBadges({ dossier }: { dossier: FinanceurShareResponse['dossier'] }) {
  const labels = [
    dossier.sector,
    dossier.maturityStage,
    dossier.ancrageCvl && (ANCRAGE_LABEL[dossier.ancrageCvl] ?? dossier.ancrageCvl),
    dossier.tagTechnologique && (TAG_TECHNO_LABEL[dossier.tagTechnologique] ?? dossier.tagTechnologique),
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
    () => buildDynamicQuestionnaire({ fields: data.fields }),
    [data.fields],
  )
  const answersByFieldId = useMemo(
    () => Object.fromEntries(data.answers.map((a) => [a.fieldId, a.value])),
    [data.answers],
  )

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
            {section.questions.map((q) => (
              <DossierField key={q.id} label={q.label} value={answersByFieldId[q.id] ?? ''} />
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

function SharedDocuments({ documents }: { documents: DocumentGroup[] }) {
  return (
    <section>
      <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">Documents</h2>
      {documents.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Aucun document déposé.</p>
      ) : (
        <ul role="list" className="mt-4 flex flex-col divide-y divide-border rounded-lg border border-border">
          {documents.map((doc) => (
            <li key={doc.filename} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{doc.filename}</p>
                <p className="text-xs text-muted-foreground">
                  Version {doc.current.version} · {formatSize(doc.current.size)}
                </p>
              </div>
              <DocumentLink url={doc.current.url} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// `null`: the stored file could not be reached (in-memory storage after an API restart).
// `memory://`: until real storage lands (story 12.7), the file exists but a browser cannot open it.
function DocumentLink({ url }: { url: string | null }) {
  if (url === null) {
    return <span className="shrink-0 text-xs text-muted-foreground">Fichier indisponible</span>
  }
  if (!/^https?:\/\//.test(url)) {
    return <span className="shrink-0 text-xs text-muted-foreground">Téléchargement bientôt disponible</span>
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="shrink-0 text-sm font-medium text-foreground underline underline-offset-4"
    >
      Ouvrir
    </a>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}
