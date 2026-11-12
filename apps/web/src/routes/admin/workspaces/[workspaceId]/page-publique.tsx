import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  WORKSPACE_PAGE_LIMITS,
  toPublicWorkspacePage,
  updateWorkspacePageSchema,
  type PublicPageBlock,
  type Workspace,
  type WorkspacePageSettings,
} from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { getWorkspace } from '@/features/admin/workspaces.api'
import { ShowcaseCardModeration } from '@/features/showcase-cards/components/ShowcaseCardModeration'
import { getWorkspacePage, updateWorkspacePage } from '@/features/workspace-pages/api'
import { PageBlocksEditor } from '@/features/workspace-pages/components/PageBlocksEditor'
import { PublicWorkspaceContent } from '@/features/workspace-pages/components/PublicWorkspaceContent'
import {
  WorkspaceNotManaged,
  WorkspacePageHeader,
} from '@/features/workspaces/components/WorkspacePageHeader'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

type FieldName = 'criteria' | 'contact'
type Errors = Partial<Record<FieldName, string>>
const FIELDS: FieldName[] = ['criteria', 'contact']
const isField = (key: unknown): key is FieldName => FIELDS.includes(key as FieldName)

// ROADMAP E09.01: a workspace's public page, set by Confluent administrators and the workspace's
// managers (the API decides who may, at each request): published or not — unpublished by default —,
// criteria and contact. E09.03: the projects' cards, hidden or restored. E09.04: the blocks shown and
// their order, with a live preview of the settings as edited, built by the same projection as the
// public page (@confluent/shared `toPublicWorkspacePage`). E09.06: whether search engines may index
// the page while it is published — no by default.
export default function AdminWorkspacePublicPageRoute() {
  const { workspaceId = '' } = useParams()
  return <WorkspacePublicPage key={workspaceId} workspaceId={workspaceId} />
}

function WorkspacePublicPage({ workspaceId }: { workspaceId: string }) {
  const workspace = useAsync(() => getWorkspace(workspaceId), [workspaceId])
  const loaded = useAsync(() => getWorkspacePage(workspaceId), [workspaceId])
  // The settings as last returned by a change, otherwise as loaded.
  const [changed, setSettings] = useState<WorkspacePageSettings | null>(null)
  // The form starts again from the values as last saved or read again.
  const [revision, setRevision] = useState(0)
  const settings = changed ?? loaded.data ?? null
  const error = (workspace.error ?? loaded.error) as ApiError | null

  if (error && !settings) {
    if (error.status === 403) return <WorkspaceNotManaged />
    return (
      <p className="pt-8 text-sm text-destructive">
        {error.status === 404 || error.status === 400
          ? 'Workspace introuvable.'
          : 'Impossible de charger la page publique du workspace.'}
      </p>
    )
  }
  if (!workspace.data || !settings) {
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }

  // After a change made meanwhile (409): the form starts again from the settings read.
  async function reload() {
    const fresh = await getWorkspacePage(workspaceId)
    setSettings(fresh)
    setRevision((n) => n + 1)
  }

  // After a card hidden or restored: what the blocks may show is read again, the form keeps what is
  // being typed (it still writes from the version it started from).
  async function refresh() {
    setSettings(await getWorkspacePage(workspaceId))
  }

  return (
    <>
      <title>{`Page publique · ${workspace.data.name} · Confluent`}</title>
      <WorkspacePageHeader workspace={workspace.data} />
      <div className="mt-6 flex max-w-2xl flex-col gap-6">
        <PublicationStatus
          workspace={workspace.data}
          published={settings.published}
          indexable={settings.indexable}
        />
        <PublicPageForm
          key={revision}
          workspaceId={workspaceId}
          settings={settings}
          // Members read the logo through its signed address; the public through the page's.
          logoSrc={workspace.data.logo?.url ?? null}
          onSaved={(saved) => {
            setSettings(saved)
            setRevision((n) => n + 1)
          }}
          onStale={reload}
        />
        <Separator />
        <ShowcaseCardModeration
          workspaceId={workspaceId}
          refreshKey={revision}
          onChanged={refresh}
        />
      </div>
    </>
  )
}

function PublicationStatus({
  workspace,
  published,
  indexable,
}: {
  workspace: Workspace
  published: boolean
  indexable: boolean
}) {
  const address = `/w/${workspace.slug}`
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4 text-sm">
      <p className="font-medium text-foreground">
        {published ? 'Page publiée' : 'Page non publiée'}
      </p>
      {published ? (
        <p className="text-muted-foreground">
          Visible par tous, sans connexion, à l’adresse{' '}
          <Link
            to={address}
            target="_blank"
            rel="noopener"
            className="break-all font-mono text-foreground underline underline-offset-4 hover:no-underline"
          >
            {address}
            <span className="sr-only"> (nouvel onglet)</span>
          </Link>
          .{' '}
          {indexable
            ? 'Les moteurs de recherche sont autorisés à l’indexer : ils décident eux-mêmes quand elle apparaît dans leurs résultats.'
            : 'Elle demande aux moteurs de recherche de ne pas l’indexer.'}
        </p>
      ) : (
        <p className="text-muted-foreground">
          À l’adresse <span className="break-all font-mono text-foreground">{address}</span>, le
          public lit « Aucune page publique à cette adresse », comme pour une adresse inconnue.
          {indexable &&
            ' L’indexation par les moteurs de recherche est autorisée : elle vaudra une fois la page publiée.'}
        </p>
      )}
    </div>
  )
}

// What a text would be once saved (normalised as the API does), or as typed while it is invalid.
function draftText(field: FieldName, value: string): string | null {
  const parsed = updateWorkspacePageSchema.shape[field].safeParse(value)
  return parsed.success ? parsed.data : value.trim() || null
}

function PublicPageForm({
  workspaceId,
  settings,
  logoSrc,
  onSaved,
  onStale,
}: {
  workspaceId: string
  // The settings as last read: what the blocks may show (`content`) follows them.
  settings: WorkspacePageSettings
  logoSrc: string | null
  onSaved: (saved: WorkspacePageSettings) => void
  onStale: () => Promise<void>
}) {
  // The settings the form started from: it writes from their version, whatever was read since.
  const [base] = useState(settings)
  const [published, setPublished] = useState(base.published)
  const [values, setValues] = useState({
    criteria: base.criteria ?? '',
    contact: base.contact ?? '',
  })
  const [blocks, setBlocks] = useState<PublicPageBlock[]>(base.blocks)
  const [indexable, setIndexable] = useState(base.indexable)
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<string | null>(null)
  // Set when a change made meanwhile could not be read again (code review R71): the form still shows
  // the settings as they were before it — say so, and offer to read them again.
  const [unread, setUnread] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const texts = {
    presentation: settings.content.workspace.presentation,
    criteria: draftText('criteria', values.criteria),
    contact: draftText('contact', values.contact),
  }
  const unsaved =
    published !== base.published ||
    texts.criteria !== base.criteria ||
    texts.contact !== base.contact ||
    blocks.join() !== base.blocks.join() ||
    indexable !== base.indexable
  // The page as the public would read it with these settings, by the public route's projection.
  const preview = useMemo(
    () =>
      toPublicWorkspacePage(
        {
          ...settings.content,
          workspace: {
            ...settings.content.workspace,
            criteria: texts.criteria,
            contact: texts.contact,
          },
        },
        blocks,
        indexable,
      ),
    [settings.content, texts.criteria, texts.contact, blocks, indexable],
  )

  // Reads the settings as they now are; true once read (the form is then rebuilt from them).
  async function readAgain(): Promise<boolean> {
    try {
      await onStale()
      return true
    } catch {
      setUnread(true)
      setFailure(
        'La page publique a été modifiée entre-temps, mais ses réglages actuels n’ont pas pu être relus : rien n’a été enregistré. Relisez-les avant d’enregistrer de nouveau.',
      )
      return false
    }
  }

  function set(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    // Kept while the settings changed meanwhile are still unread: the form is not them.
    if (!unread) setFailure(null)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Nothing is written from settings that could not be read again (code review R72).
    if (unread) return
    setFailure(null)
    const parsed = updateWorkspacePageSchema.safeParse({
      published,
      ...values,
      blocks,
      indexable,
      version: base.version,
    })
    if (!parsed.success) {
      const found: Errors = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (isField(field)) found[field] ??= issue.message
      }
      setErrors(found)
      focusFirstError(found)
      return
    }
    setSubmitting(true)
    try {
      const saved = await updateWorkspacePage(workspaceId, parsed.data)
      onSaved(saved)
      toast.success(
        saved.published === base.published
          ? 'Page publique enregistrée.'
          : saved.published
            ? 'Page publiée.'
            : 'Page retirée du public.',
      )
    } catch (err) {
      const apiError = err as ApiError
      if (apiError?.status === 409) {
        // Changed meanwhile by someone else: read again, nothing of theirs is overwritten. Said to be
        // reloaded only once it was (code review R71).
        if (await readAgain()) {
          toast.error(
            'La page publique a été modifiée entre-temps : elle a été rechargée, vérifiez-la puis enregistrez de nouveau.',
          )
        }
        return
      }
      const found = fieldErrorsOf(apiError)
      if (Object.keys(found).length > 0) {
        setErrors(found)
        focusFirstError(found)
      } else {
        setFailure(apiError?.message ?? 'Enregistrement impossible. Réessayez plus tard.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {/* Nothing is changed from settings that could not be read again (code review R72). */}
        <fieldset disabled={unread} className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="flex min-h-11 items-start gap-3 text-sm text-foreground">
              <input
                id="ws-page-published"
                type="checkbox"
                className="mt-0.5 size-4 shrink-0"
                checked={published}
                aria-describedby="ws-page-published-help"
                onChange={(e) => {
                  setPublished(e.target.checked)
                  setFailure(null)
                }}
              />
              <span className="font-medium">Page publique visible</span>
            </label>
            <p id="ws-page-published-help" className="text-xs text-muted-foreground">
              Décochée, la page n’existe pas pour le public. Cochée, tout le monde peut lire sans
              connexion son en-tête (nom, programme, couleur et logo du workspace) et les blocs
              affichés ci-dessous : présentation, critères, contact, prochains comités ouverts aux
              demandes de participation (nom, date et heure seulement)… Ni les membres, ni l’email
              de contact des réglages, ni les dossiers n’y figurent, hors les cartes anonymes que
              les entreprises choisissent d’y afficher.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="flex min-h-11 items-start gap-3 text-sm text-foreground">
              <input
                id="ws-page-indexable"
                type="checkbox"
                className="mt-0.5 size-4 shrink-0"
                checked={indexable}
                aria-describedby="ws-page-indexable-help"
                onChange={(e) => {
                  setIndexable(e.target.checked)
                  if (!unread) setFailure(null)
                }}
              />
              <span className="font-medium">Autoriser l’indexation par les moteurs de recherche</span>
            </label>
            <p id="ws-page-indexable-help" className="text-xs text-muted-foreground">
              Décochée (par défaut), la page demande aux moteurs de recherche (Google, Bing…) de ne
              pas l’indexer : elle n’apparaît pas dans leurs résultats. Cochée, ils
              peuvent l’indexer tant qu’elle est publiée, et la proposer dans leurs résultats avec
              son contenu public. Les formulaires de participation et de candidature, comme le reste
              de Confluent, ne sont jamais indexés. Décocher ne la retire de leurs résultats qu’à
              leur prochain passage.
            </p>
          </div>

          <Field
            id="criteria"
            label="Critères"
            error={errors.criteria}
            help={`Facultatif. À qui s’adresse le programme : secteur, territoire, stade, montant… Texte simple, retours à la ligne conservés, sans HTML. ${values.criteria.length} / ${WORKSPACE_PAGE_LIMITS.criteria} caractères.`}
          >
            <Textarea
              id="ws-page-criteria"
              rows={6}
              value={values.criteria}
              maxLength={WORKSPACE_PAGE_LIMITS.criteria}
              onChange={(e) => set('criteria', e.target.value)}
              {...invalid('criteria', errors)}
            />
          </Field>

          <Field
            id="contact"
            label="Contact public"
            error={errors.contact}
            help={`Facultatif. Visible par tous une fois la page publiée : n’y écrivez qu’une adresse, un numéro ou un lien que la structure accepte de rendre publics. L’email de contact des réglages n’est jamais affiché. ${values.contact.length} / ${WORKSPACE_PAGE_LIMITS.contact} caractères.`}
          >
            <Textarea
              id="ws-page-contact"
              rows={3}
              value={values.contact}
              maxLength={WORKSPACE_PAGE_LIMITS.contact}
              onChange={(e) => set('contact', e.target.value)}
              {...invalid('contact', errors)}
            />
          </Field>

          <PageBlocksEditor
            blocks={blocks}
            onChange={(next) => {
              setBlocks(next)
              if (!unread) setFailure(null)
            }}
            content={settings.content}
            texts={texts}
            disabled={submitting}
          />
        </fieldset>

        <div aria-live="assertive">
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          {unread && (
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              disabled={submitting}
              onClick={() => void readAgain()}
            >
              Relire les réglages
            </Button>
          )}
        </div>

        <div>
          <Button type="submit" size="lg" disabled={submitting || unread}>
            {submitting ? 'Enregistrement…' : 'Enregistrer la page publique'}
          </Button>
        </div>
      </form>

      <section aria-labelledby="ws-page-preview-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="ws-page-preview-title"
            className="font-heading text-lg font-semibold text-foreground"
          >
            Aperçu
          </h2>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {unsaved
              ? `Modifications non enregistrées : la page telle que le public la verra une fois ces réglages enregistrés${published ? '' : ' et la page publiée'}.`
              : `La page telle que le public la voit avec les réglages enregistrés${published ? '' : ', une fois publiée'}.`}
          </p>
          <p className="text-xs text-muted-foreground">
            Nom, programme, couleur, logo et présentation viennent de l’onglet Réglages ; les
            comités sont ceux ouverts aux demandes de participation ; les cartes, celles que leurs
            porteurs affichent et que vous n’avez pas masquées.
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-border bg-background p-4 sm:p-6">
          <PublicWorkspaceContent page={preview} titleLevel={2} logoSrc={logoSrc} />
        </div>
      </section>
    </>
  )
}

function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: FieldName
  label: string
  help: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`ws-page-${id}`}>{label}</Label>
      {children}
      <p id={`ws-page-${id}-help`} className="text-xs text-muted-foreground">
        {help}
      </p>
      <div aria-live="assertive">
        {error && (
          <p id={`ws-page-${id}-error`} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

function invalid(field: FieldName, errors: Errors) {
  const error = errors[field]
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error
      ? `ws-page-${field}-error ws-page-${field}-help`
      : `ws-page-${field}-help`,
  }
}

function focusFirstError(errors: Errors) {
  const first = FIELDS.find((field) => errors[field])
  if (first) document.getElementById(`ws-page-${first}`)?.focus()
}

function fieldErrorsOf(err: ApiError | undefined): Errors {
  const found: Errors = {}
  if (err?.status === 400 && Array.isArray(err.details)) {
    for (const detail of err.details as Array<{ path?: unknown[]; message?: string }>) {
      const field = detail.path?.[0]
      if (isField(field) && detail.message) found[field] ??= detail.message
    }
  }
  return found
}
