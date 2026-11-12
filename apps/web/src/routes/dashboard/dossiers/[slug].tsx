import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetTrigger } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { AccessListRow } from '@/components/confluent/AccessListRow'
import { DossierField } from '@/components/confluent/DossierField'
import { answerLabel } from '@/features/questionnaire/answer-label'
import { filenamesByField, useDossierDocuments } from '@/features/documents/useDossierDocuments'
import { MetricCard } from '@/components/confluent/MetricCard'
import { RevokeAccessDialog } from '@/components/confluent/RevokeAccessDialog'
import { SharePanel } from '@/components/confluent/SharePanel'
import { getDossier, listDossiers, deleteDossier } from '@/features/dossiers/api'
import { useDossierAnswers } from '@/features/dossiers/hooks'
import { AnswerOrigin } from '@/features/questionnaire/components/AnswerProvenance'
import { hasOriginToShow, isPendingProposal } from '@/features/questionnaire/provenance'
import { listShares, createShare, revokeShare, changeShareLevel } from '@/features/shares/api'
import { previewHref } from '@/features/shares/preview'
import { getAnalytics } from '@/features/analytics/api'
import { formatActiveTime } from '@/features/analytics/format'
import { buildAccessEntries } from '@/features/shares/build-access-entries'
import type { AccessEntry, AccessLevel } from '@/features/shares/access-entry'
import { useAsync } from '@/lib/useAsync'
import { readFailure } from '@/lib/read-failure'
import { LoadError } from '@/components/confluent/LoadError'
import { buildDynamicQuestionnaire } from '@/features/questionnaire/adapter'
import type { ApiError } from '@/lib/api-client'
import { useCurrentUser } from '@/features/current-user/context'
import { DocumentsPanel } from '@/features/documents/components/DocumentsPanel'
import { getCompany } from '@/features/companies/api'
import { RequestEditor } from '@/features/dossiers/components/RequestEditor'
import { RequestPresentation } from '@/features/dossiers/components/RequestPresentation'
import { DossierCandidatures } from '@/features/candidatures/components/DossierCandidatures'
import { DossierPositionsSection } from '@/features/positions/components/DossierPositionsSection'
import { DossierHistorySection } from '@/features/history/components/DossierHistorySection'
import { hasPresentation } from '@/features/dossiers/presentation'
import {
  ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
  DOSSIER_PUBLICATION_STATUS_LABELS,
  isArchived,
  publicationStatusOf,
  type Dossier,
} from '@confluent/shared'

const TAB_VALUES = {
  request: 'demande',
  content: 'content',
  documents: 'documents',
  candidatures: 'candidatures',
  analytics: 'analytics',
} as const

type TabValue = (typeof TAB_VALUES)[keyof typeof TAB_VALUES]

export default function DossierViewRoute() {
  const { slug } = useParams<{ slug: string }>()
  if (!slug) {
    return <NotFound />
  }
  return <DossierBySlug key={slug} slug={slug} />
}

function DossierBySlug({ slug }: { slug: string }) {
  const currentUser = useCurrentUser()
  const dossiersQuery = useAsync(() => listDossiers(), [])
  const dossier = dossiersQuery.data?.find((d) => d.slug === slug)

  if (dossiersQuery.isLoading) {
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }
  if (dossiersQuery.error) {
    return (
      <LoadError
        className="mt-8"
        message={readFailure(dossiersQuery.error, 'Ce dossier n’a pas pu être chargé.')}
        onRetry={dossiersQuery.refetch}
      />
    )
  }
  if (!dossier) {
    return <NotFound />
  }
  const isOwner = dossier.userId === currentUser.id
  const isDraft = !dossier.submittedAt
  return <DossierView dossierId={dossier.id} slug={dossier.slug} fallbackName={dossier.name} isOwner={isOwner} isDraft={isDraft} />
}

function NotFound() {
  return (
    <section className="mx-auto max-w-md pt-16 text-center">
      <title>Dossier introuvable · Confluent</title>
      <p className="text-sm text-muted-foreground">Dossier introuvable.</p>
      <Link
        to="/dashboard"
        className="mt-4 inline-block text-sm underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        Retour au tableau de bord
      </Link>
    </section>
  )
}

function DossierView({
  dossierId,
  slug,
  fallbackName,
  isOwner,
  isDraft,
}: {
  dossierId: string
  slug: string
  fallbackName: string
  isOwner: boolean
  isDraft: boolean
}) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [entryToRevoke, setEntryToRevoke] = useState<AccessEntry | null>(null)
  const [levelChanging, setLevelChanging] = useState<string | null>(null)
  const revokingRef = useRef(false)
  const deletingRef = useRef(false)

  const dossierQuery = useAsync(() => getDossier(dossierId), [dossierId])
  // The owner's answers carry their provenance and history (E04.05); a financeur's never do.
  const answersQuery = useDossierAnswers(dossierId)
  // Attachment questions show the files that answer them (E03.11).
  const documentsQuery = useDossierDocuments(dossierId)
  const sharesQuery = useAsync(
    () => isOwner ? listShares(dossierId) : Promise.resolve([]),
    [dossierId, isOwner],
  )
  const analyticsQuery = useAsync(
    () => isOwner ? getAnalytics(dossierId) : Promise.resolve(undefined),
    [dossierId, isOwner],
  )
  // The company's other requests (E05.07): deleting the last one deletes the company with it.
  const companyId = dossierQuery.data?.company?.id
  const companyQuery = useAsync(
    () => (companyId ? getCompany(companyId) : Promise.resolve(undefined)),
    [companyId],
  )
  const isLastRequest = (companyQuery.data?.dossiers.length ?? 1) <= 1
  // E05.08: a company the signed-in conseiller prepares for an entrepreneur: no share, no publication.
  const inPreparation = dossierQuery.data?.company?.inPreparation === true
  // E06.01/E07.01: an archived request is not diffused further; its existing accesses stay open.
  const archived = dossierQuery.data ? isArchived(dossierQuery.data) : false
  const basePath = `/dashboard/dossiers/view/${encodeURIComponent(slug)}`

  function handleRequestChange(updated: Dossier) {
    if (updated.slug !== slug) {
      navigate(`/dashboard/dossiers/view/${encodeURIComponent(updated.slug)}?tab=${TAB_VALUES.request}`, {
        replace: true,
      })
      return
    }
    dossierQuery.refetch()
  }

  useEffect(() => {
    headingRef.current?.focus()
  }, [dossierId])

  const accessEntries = useMemo<AccessEntry[]>(
    () => buildAccessEntries(sharesQuery.data ?? [], analyticsQuery.data),
    [sharesQuery.data, analyticsQuery.data],
  )

  const displayName = dossierQuery.data?.name ?? fallbackName
  const requestedTab = searchParams.get('tab')
  const activeTab: TabValue =
    requestedTab === TAB_VALUES.analytics ||
    requestedTab === TAB_VALUES.documents ||
    requestedTab === TAB_VALUES.request ||
    (isOwner && requestedTab === TAB_VALUES.candidatures)
      ? requestedTab
      : TAB_VALUES.content

  function handleTabChange(value: unknown) {
    if (typeof value !== 'string') return
    setSearchParams(
      (prev) => {
        if (
          value === TAB_VALUES.analytics ||
          value === TAB_VALUES.documents ||
          value === TAB_VALUES.request ||
          value === TAB_VALUES.candidatures
        ) {
          prev.set('tab', value)
        } else {
          prev.delete('tab')
        }
        return prev
      },
      { replace: true },
    )
  }

  const handleInvitationSubmit = useCallback(
    async (email: string, accessLevel: AccessLevel) => {
      try {
        await createShare(dossierId, email, accessLevel)
        toast.success(`Invitation envoyée à ${email}`)
        setShareOpen(false)
        sharesQuery.refetch()
      } catch (err) {
        const apiErr = err as ApiError
        throw new Error(apiErr?.message ?? "L'invitation a échoué.")
      }
    },
    [dossierId, sharesQuery],
  )

  async function handleLevelChange(entry: AccessEntry, level: AccessLevel) {
    if (levelChanging) return
    setLevelChanging(entry.id)
    try {
      await changeShareLevel(dossierId, entry.id, level)
      toast.success(`Accès de ${entry.email} : ${ACCESS_LEVEL_LABELS[level]}`)
    } catch (err) {
      const apiErr = err as ApiError
      toast.error(apiErr?.message ?? 'Changement de niveau impossible.')
    } finally {
      setLevelChanging(null)
      sharesQuery.refetch()
    }
  }

  function handleRevokeClick(entry: AccessEntry) {
    revokingRef.current = false
    setEntryToRevoke(entry)
  }

  async function handleConfirmDelete() {
    if (deletingRef.current) return
    deletingRef.current = true
    try {
      await deleteDossier(dossierId)
      navigate('/dashboard')
    } catch {
      toast.error('Suppression impossible. Réessayez plus tard.')
      deletingRef.current = false
    }
  }

  async function handleConfirmRevoke(entry: AccessEntry) {
    if (revokingRef.current) return
    revokingRef.current = true
    try {
      await revokeShare(dossierId, entry.id)
      toast.success('Accès révoqué')
      sharesQuery.refetch()
      analyticsQuery.refetch()
    } catch (err) {
      const apiErr = err as ApiError
      toast.error(apiErr?.message ?? 'Révocation impossible.')
    }
    setEntryToRevoke(null)
  }

  const questionnaire = dossierQuery.data?.questionnaireVersion
    ? buildDynamicQuestionnaire(dossierQuery.data.questionnaireVersion)
    : null
  const answersByFieldId: Record<string, string> = {}
  const rowsByFieldId = new Map((answersQuery.data ?? []).map((row) => [row.fieldId, row]))
  for (const row of answersQuery.data ?? []) {
    answersByFieldId[row.fieldId] = row.value
  }
  const toConfirm = isOwner
    ? (questionnaire?.flat ?? []).filter(
        (q) => q.fieldType !== 'file' && isPendingProposal(rowsByFieldId.get(q.id)),
      ).length
    : 0
  const questionPath = (fieldId: string) =>
    `/dashboard/dossiers/nouveau/questionnaire?dossierId=${encodeURIComponent(dossierId)}&question=${encodeURIComponent(fieldId)}`
  const attachedFiles = filenamesByField(documentsQuery.data)
  const attachmentLabels = new Map(
    (questionnaire?.flat ?? []).filter((q) => q.fieldType === 'file').map((q) => [q.id, q.label]),
  )

  const isContentReady = !dossierQuery.isLoading && !answersQuery.isLoading

  return (
    <div className="mx-auto max-w-[720px]">
      <title>{displayName} · Confluent</title>

      <nav aria-label="Fil d'Ariane" className="mb-4">
        <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <li>
            <Link
              to="/dashboard"
              className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              Dossiers
            </Link>
          </li>
          {dossierQuery.data?.company && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="text-muted-foreground/60">
                /
              </span>
              <Link
                to={`/dashboard/entreprises/${encodeURIComponent(dossierQuery.data.company.id)}`}
                className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
              >
                {dossierQuery.data.company.name}
              </Link>
            </li>
          )}
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="text-muted-foreground/60">
              /
            </span>
            <span aria-current="page" className="font-medium text-foreground">
              {displayName}
            </span>
          </li>
        </ol>
      </nav>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
          >
            {displayName}
          </h1>
          {/* The company the dossier finances (E05.04), given to its owner only. */}
          {dossierQuery.data?.company && (
            <p className="mt-1 text-sm text-muted-foreground">
              Demande de financement de{' '}
              <Link
                to={`/dashboard/entreprises/${encodeURIComponent(dossierQuery.data.company.id)}`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {dossierQuery.data.company.name}
              </Link>
              {' · '}
              {DOSSIER_PUBLICATION_STATUS_LABELS[publicationStatusOf(dossierQuery.data.publicationStatus)]}
            </p>
          )}
        </div>
        {isOwner && isDraft ? (
          <div className="flex gap-2 self-start sm:self-auto">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 px-4"
              onClick={() => setDeleteOpen(true)}
            >
              Supprimer
            </Button>
            <Button
              type="button"
              size="lg"
              className="h-11 px-4"
              onClick={() => navigate(`/dashboard/dossiers/nouveau/questionnaire?dossierId=${dossierId}`)}
            >
              Reprendre le questionnaire
            </Button>
          </div>
        ) : isOwner ? (
          <div className="flex gap-2 self-start sm:self-auto">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 px-4"
              onClick={() =>
                navigate(`/dashboard/dossiers/nouveau/recapitulatif?dossierId=${encodeURIComponent(dossierId)}`)
              }
            >
              Modifier les réponses
            </Button>
            {!inPreparation && !archived && (
              <Sheet open={shareOpen} onOpenChange={setShareOpen}>
                <SheetTrigger
                  render={
                    <Button
                      type="button"
                      size="lg"
                      className="h-11 self-start px-4 sm:self-auto"
                    >
                      Partager
                    </Button>
                  }
                />
                <SharePanel
                  existingEntries={accessEntries}
                  onSubmitInvitation={handleInvitationSubmit}
                  previewHref={(level) => previewHref(basePath, level)}
                />
              </Sheet>
            )}
          </div>
        ) : null}
      </div>

      {inPreparation && (
        <p
          role="note"
          className="mt-4 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-foreground"
        >
          Vous préparez cette entreprise pour un entrepreneur : complétez son profil, ses documents
          et ses demandes. Elle ne peut être ni partagée ni publiée tant qu’il n’a pas accepté
          votre proposition ; ensuite, elle sera la sienne et vous n’y aurez plus accès.{' '}
          {dossierQuery.data?.company && (
            <Link
              to={`/dashboard/entreprises/${encodeURIComponent(dossierQuery.data.company.id)}`}
              className="underline underline-offset-4"
            >
              Voir la proposition
            </Link>
          )}
        </p>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange} className="mt-6">
        {/* The tabs do not fit on a phone: they wrap instead of widening the page. */}
        <TabsList className="h-auto max-w-full flex-wrap">
          <TabsTrigger value={TAB_VALUES.request}>Demande</TabsTrigger>
          <TabsTrigger value={TAB_VALUES.content}>Contenu</TabsTrigger>
          <TabsTrigger value={TAB_VALUES.documents}>Documents</TabsTrigger>
          {/* E05.09: the structures the request is presented to, its owner's only. */}
          {isOwner && (
            <TabsTrigger value={TAB_VALUES.candidatures}>Candidatures</TabsTrigger>
          )}
          {isOwner && (
            <TabsTrigger value={TAB_VALUES.analytics}>
              Accès &amp; analytics
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value={TAB_VALUES.request}>
          {!dossierQuery.data ? (
            <p className="text-sm text-muted-foreground">Chargement de la demande…</p>
          ) : isOwner ? (
            <RequestEditor
              key={`${dossierQuery.data.id}-${dossierQuery.data.updatedAt}`}
              dossier={dossierQuery.data}
              onChange={handleRequestChange}
              inPreparation={inPreparation}
            />
          ) : hasPresentation(dossierQuery.data) ? (
            <RequestPresentation dossier={dossierQuery.data} />
          ) : (
            <p className="text-sm text-muted-foreground">
              La présentation de cette demande n’est pas encore publiée par l’entrepreneur.
            </p>
          )}
        </TabsContent>

        <TabsContent value={TAB_VALUES.content}>
          {!isContentReady ? (
            <p className="text-sm text-muted-foreground">Chargement du contenu…</p>
          ) : dossierQuery.error || answersQuery.error ? (
            <LoadError
              message={readFailure(
                dossierQuery.error ?? answersQuery.error,
                'Le contenu du dossier n’a pas pu être chargé.',
              )}
              onRetry={() => {
                if (dossierQuery.error) dossierQuery.refetch()
                if (answersQuery.error) answersQuery.refetch()
              }}
            />
          ) : questionnaire ? (
            <div className="flex flex-col gap-10">
              {toConfirm > 0 && (
                <p
                  role="status"
                  className="rounded-md border border-status-pending/50 bg-status-pending/10 px-4 py-3 text-sm text-foreground"
                >
                  {toConfirm === 1
                    ? 'Une réponse proposée par un assistant IA reste à confirmer : vérifiez-la ci-dessous.'
                    : `${toConfirm} réponses proposées par un assistant IA restent à confirmer : vérifiez-les ci-dessous.`}
                </p>
              )}
              {questionnaire.sections.map((section, i) => {
                const sectionMetas = questionnaire.flat.filter(
                  (q) => q.sectionId === section.id,
                )
                return (
                  <section key={section.id}>
                    <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
                      {i + 1}. {section.title}
                    </h2>
                    <dl className="mt-4 flex flex-col gap-6">
                      {sectionMetas.map((q) => (
                        <DossierField
                          key={q.id}
                          label={q.label}
                          value={
                            q.fieldType === 'file'
                              ? (attachedFiles.get(q.id) ?? []).join('\n')
                              : answerLabel(q, answersByFieldId[q.id] ?? '')
                          }
                          details={
                            isOwner && q.fieldType !== 'file' && hasOriginToShow(rowsByFieldId.get(q.id)) ? (
                              <AnswerOrigin
                                dossierId={dossierId}
                                label={q.label}
                                row={rowsByFieldId.get(q.id)}
                                onConfirmed={answersQuery.replace}
                                correctHref={questionPath(q.id)}
                                formatValue={(v) => answerLabel(q, v)}
                              />
                            ) : undefined
                          }
                        />
                      ))}
                    </dl>
                  </section>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ce dossier n&apos;a pas encore de contenu renseigné.
            </p>
          )}
        </TabsContent>

        <TabsContent value={TAB_VALUES.documents}>
          <DocumentsPanel
            dossierId={dossierId}
            canUpload={isOwner}
            fieldLabels={attachmentLabels}
            requestName={displayName}
          />
        </TabsContent>

        {isOwner && (
          <TabsContent value={TAB_VALUES.candidatures}>
            <DossierCandidatures
              dossierId={dossierId}
              profileSubmitted={dossierQuery.data?.submittedAt != null}
              inPreparation={inPreparation}
              archived={dossierQuery.data ? isArchived(dossierQuery.data) : false}
            />
          </TabsContent>
        )}

        <TabsContent value={TAB_VALUES.analytics}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <MetricCard
              label="Destinataires actifs"
              value={(analyticsQuery.data?.activeRecipients ?? 0).toString()}
            />
            <MetricCard
              label="Consultations"
              value={(analyticsQuery.data?.totalViews ?? 0).toString()}
              subLabel="Par vos liens nominatifs"
            />
            <MetricCard
              label="Temps actif moyen"
              value={formatActiveTime(analyticsQuery.data?.avgSessionDurationSeconds)}
              subLabel={
                analyticsQuery.data?.totalActiveSeconds == null
                  ? 'Aucune consultation mesurée'
                  : `Par consultation · ${formatActiveTime(analyticsQuery.data.totalActiveSeconds)} au total`
              }
            />
          </div>
          {/* E07.08: what the measures count, and what they do not tell. */}
          <section
            aria-labelledby="measures-heading"
            className="mt-4 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-foreground"
          >
            <h2 id="measures-heading" className="font-medium">
              Comment lire ces mesures
            </h2>
            <ul role="list" className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
              <li>
                Une consultation regroupe les ouvertures d’un même destinataire à moins de
                30 minutes d’intervalle : un rechargement, une reconnexion ou un second onglet ne
                comptent qu’une fois.
              </li>
              <li>
                Le temps actif ne compte que les moments où la page est affichée au premier plan et
                où le destinataire s’en sert (défilement, clic, clavier) depuis moins d’une minute.
                Les consultations antérieures à cette mesure n’ont pas de durée.
              </li>
              <li>
                C’est une mesure de présence, pas d’intérêt : une lecture rapide, un document
                imprimé ou transmis, une page laissée ouverte pendant une autre tâche la faussent.
                Fiez-vous plutôt aux marques d’intérêt et aux promesses.
              </li>
              <li>
                Seules les lectures par vos liens nominatifs sont comptées : celles des
                investisseurs d’un vivier ne vous sont pas montrées, même en nombre, faute de leur
                consentement.
              </li>
            </ul>
          </section>

          {/* E07.07: the marks of interest (E07.05) and pledges (E07.06), in one view. */}
          {isOwner && <DossierPositionsSection dossierId={dossierId} />}

          <section className="mt-8">
            <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
              Accès &amp; partage
            </h2>
            {archived && (
              <p
                role="note"
                className="mt-4 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-foreground"
              >
                Cette demande est archivée : les accès existants restent ouverts, sans sa
                présentation. Vous pouvez restreindre ou révoquer un accès ; pour inviter un
                nouveau destinataire ou élargir un accès, désarchivez-la d’abord.
              </p>
            )}
            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
              {sharesQuery.isLoading ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Chargement…
                </p>
              ) : accessEntries.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Aucun destinataire pour le moment.
                </p>
              ) : (
                <ul role="list" className="m-0 list-none p-0">
                  {accessEntries.map((entry) => (
                    <AccessListRow
                      key={entry.id}
                      entry={entry}
                      onRevokeClick={handleRevokeClick}
                      onLevelChange={isOwner ? handleLevelChange : undefined}
                      levelChanging={levelChanging === entry.id}
                      previewHref={previewHref(basePath, entry.accessLevel)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* E07.09: who consulted, what happened to the accesses, the administration's interventions. */}
          {isOwner && <DossierHistorySection dossierId={dossierId} />}

          {isOwner && (
            <section className="mt-8" aria-labelledby="preview-heading">
              <h2
                id="preview-heading"
                className="font-heading text-xl font-semibold text-foreground md:text-2xl"
              >
                Voir comme le destinataire
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Vérifiez ce que lit un destinataire de lien nominatif à chaque niveau : questions,
                réponses, classification et documents choisis pour cette demande. Aucun lien
                n’est créé et aucune consultation n’est comptée.
              </p>
              <ul role="list" className="mt-4 flex flex-wrap gap-2">
                {ACCESS_LEVELS.map((level) => (
                  <li key={level}>
                    <Link
                      to={previewHref(basePath, level)}
                      className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:border-foreground/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                    >
                      Accès {ACCESS_LEVEL_LABELS[level].toLowerCase()}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </TabsContent>
      </Tabs>

      <RevokeAccessDialog
        open={entryToRevoke !== null}
        entry={entryToRevoke}
        onOpenChange={(open) => {
          if (!open) setEntryToRevoke(null)
        }}
        onConfirm={handleConfirmRevoke}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette demande ?</AlertDialogTitle>
            <AlertDialogDescription>
              {isLastRequest
                ? 'Cette action est irréversible. C’est la dernière demande de l’entreprise : la demande, ses partages, le profil de l’entreprise (réponses) et sa bibliothèque de documents seront définitivement supprimés.'
                : 'Cette action est irréversible. La demande et ses partages seront supprimés ; le profil et la bibliothèque de l’entreprise restent disponibles pour ses autres demandes.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
