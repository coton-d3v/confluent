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
import { MetricCard } from '@/components/confluent/MetricCard'
import { RevokeAccessDialog } from '@/components/confluent/RevokeAccessDialog'
import { SharePanel } from '@/components/confluent/SharePanel'
import { getDossier, listDossiers, deleteDossier } from '@/features/dossiers/api'
import { listAnswers } from '@/features/dossiers/answers.api'
import { listShares, createShare, revokeShare } from '@/features/shares/api'
import { getAnalytics } from '@/features/analytics/api'
import { buildAccessEntries } from '@/features/shares/build-access-entries'
import type { AccessEntry } from '@/features/shares/access-entry'
import { useAsync } from '@/lib/useAsync'
import { buildDynamicQuestionnaire } from '@/features/questionnaire/adapter'
import type { ApiError } from '@/lib/api-client'
import { useCurrentUser } from '@/features/current-user/context'
import { DocumentsPanel } from '@/features/documents/components/DocumentsPanel'

const TAB_VALUES = {
  content: 'content',
  documents: 'documents',
  analytics: 'analytics',
} as const

type TabValue = (typeof TAB_VALUES)[keyof typeof TAB_VALUES]

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  const min = Math.floor(seconds / 60)
  const sec = Math.floor(seconds % 60)
  return `${min}m ${sec.toString().padStart(2, '0')}s`
}

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
      <p className="pt-8 text-sm text-destructive">
        Impossible de charger vos dossiers.
      </p>
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
  const revokingRef = useRef(false)
  const deletingRef = useRef(false)

  const dossierQuery = useAsync(() => getDossier(dossierId), [dossierId])
  const answersQuery = useAsync(() => listAnswers(dossierId), [dossierId])
  const sharesQuery = useAsync(
    () => isOwner ? listShares(dossierId) : Promise.resolve([]),
    [dossierId, isOwner],
  )
  const analyticsQuery = useAsync(
    () => isOwner ? getAnalytics(dossierId) : Promise.resolve(undefined),
    [dossierId, isOwner],
  )

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
    requestedTab === TAB_VALUES.analytics || requestedTab === TAB_VALUES.documents
      ? requestedTab
      : TAB_VALUES.content

  function handleTabChange(value: unknown) {
    if (typeof value !== 'string') return
    setSearchParams(
      (prev) => {
        if (value === TAB_VALUES.analytics || value === TAB_VALUES.documents) {
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
    async (email: string, accessLevel: 'public' | 'partiel' | 'complet' = 'complet') => {
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
  for (const row of answersQuery.data ?? []) {
    answersByFieldId[row.fieldId] = row.value
  }

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
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
        >
          {displayName}
        </h1>
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
              />
            </Sheet>
          </div>
        ) : null}
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="mt-6">
        <TabsList>
          <TabsTrigger value={TAB_VALUES.content}>Contenu</TabsTrigger>
          <TabsTrigger value={TAB_VALUES.documents}>Documents</TabsTrigger>
          {isOwner && (
            <TabsTrigger value={TAB_VALUES.analytics}>
              Accès &amp; analytics
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value={TAB_VALUES.content}>
          {!isContentReady ? (
            <p className="text-sm text-muted-foreground">Chargement du contenu…</p>
          ) : questionnaire ? (
            <div className="flex flex-col gap-10">
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
                          value={answerLabel(q, answersByFieldId[q.id] ?? '')}
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
          <DocumentsPanel dossierId={dossierId} canUpload={isOwner} />
        </TabsContent>

        <TabsContent value={TAB_VALUES.analytics}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <MetricCard
              label="Destinataires actifs"
              value={(analyticsQuery.data?.activeRecipients ?? 0).toString()}
            />
            <MetricCard
              label="Vues totales"
              value={(analyticsQuery.data?.totalViews ?? 0).toString()}
            />
            <MetricCard
              label="Durée moy. de session"
              value={formatDuration(
                analyticsQuery.data?.avgSessionDurationSeconds ?? null,
              )}
            />
          </div>

          <section className="mt-8">
            <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
              Accès &amp; partage
            </h2>
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
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>
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
            <AlertDialogTitle>Supprimer ce dossier ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Le dossier, ses réponses et ses partages seront définitivement supprimés.
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
