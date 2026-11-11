import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { FormVersionStructure, QuestionnaireField } from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import type { ApiError } from '@/lib/api-client'
import { toCreateInput, toUpdateInput } from '../field-input'
import { formatDate, USAGE_LABELS } from '../labels'
import { moveId } from '../move'
import type { FormsPlace } from '../place'
import { errorMessage, useFormEditor } from '../useFormEditor'
import { DraftProblems } from './DraftProblems'
import { FieldEditorSheet, type FieldEditorRequest, type FieldFormValues } from './FieldEditorSheet'
import { FormPreview } from './FormPreview'
import { InlineTextEdit } from './InlineTextEdit'
import { NameSheet, type NameRequest } from './NameSheet'
import { SectionBlock, type SectionActions } from './SectionBlock'
import { VersionHistory } from './VersionHistory'

// The form builder of one form (E03.02, E03.03, E03.08), wherever its forms are designed: Confluent's
// own, or a workspace's (E05.09, `place`). `trail`: the breadcrumb that leads to it. The API decides
// at each request who may design which form.
export function FormEditor({
  place,
  formId,
  trail,
  onForbidden,
}: {
  place: FormsPlace
  formId: string
  trail: (formName: string) => ReactNode
  // Shown instead of the editor when the API refuses the account (403).
  onForbidden?: ReactNode
}) {
  const navigate = useNavigate()
  const { api, texts } = place
  const { data, error, stale, busy, run, refresh } = useFormEditor(api, formId)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [nameRequest, setNameRequest] = useState<NameRequest | null>(null)
  const [fieldRequest, setFieldRequest] = useState<FieldEditorRequest | null>(null)
  // The draft revision shown on screen, read when a change is sent rather than when a sheet or a
  // dialog was opened: a retry after « modifié entre-temps » uses the refreshed revision (R30).
  const revisionRef = useRef<string | undefined>(undefined)
  const shownRevision = data?.structure?.form.draft?.updatedAt
  useEffect(() => {
    revisionRef.current = shownRevision
  }, [shownRevision])
  const currentRevision = () => revisionRef.current

  if (!data) {
    if (error) {
      if ((error as ApiError).status === 403 && onForbidden) return <>{onForbidden}</>
      const notFound = (error as ApiError).status === 404 || (error as ApiError).status === 400
      return (
        <p className="pt-8 text-sm text-destructive">
          {notFound ? 'Formulaire introuvable.' : 'Impossible de charger le formulaire.'}
        </p>
      )
    }
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }

  const { detail, structure } = data
  const archived = detail.archivedAt !== null
  const draft = structure?.version.status === 'draft' ? structure : null

  function openDuplicate() {
    setNameRequest({
      title: 'Dupliquer le formulaire',
      description:
        'Le nouveau formulaire reprend la version publiée (mêmes clés de champs et de choix) dans un brouillon, sans affectation.',
      submitLabel: 'Dupliquer',
      fieldLabel: 'Nom du nouveau formulaire',
      initialName: `${detail.name} (copie)`,
      onSubmit: async (name) => {
        try {
          const copy = await api.duplicateForm(formId, name)
          toast.success('Formulaire dupliqué.')
          void navigate(place.editorPath(copy.id))
          return true
        } catch (err) {
          toast.error(errorMessage(err, 'Duplication impossible.'))
          return false
        }
      },
    })
  }

  function askAssign() {
    setConfirm({
      title: texts.assignTitle,
      description: `À partir de maintenant, ${texts.forNew} utiliseront la version ${detail.published?.version} de « ${detail.name} », à la place du formulaire actuel. ${texts.existingKeep}`,
      confirmLabel: 'Utiliser ce formulaire',
      onConfirm: () =>
        void run(
          () => api.assignFormUsage(formId, place.usage),
          `Ce formulaire est utilisé pour ${texts.forNew}.`,
        ),
    })
  }

  function askArchive() {
    setConfirm({
      title: 'Archiver ce formulaire ?',
      description:
        `Il ne pourra plus être modifié. Ses versions restent consultables et ${texts.answeredWithIt} ne changent pas.`,
      confirmLabel: 'Archiver',
      onConfirm: () => void run(() => api.archiveForm(formId), 'Formulaire archivé.'),
    })
  }

  return (
    <>
      <title>{`${detail.name} · Formulaires · Confluent`}</title>
      {trail(detail.name)}
      {stale && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
        >
          <span>L’affichage n’est peut-être plus à jour : la dernière lecture a échoué.</span>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
            Actualiser
          </Button>
        </div>
      )}

      <header className="mt-4 flex flex-col gap-3">
        <InlineTextEdit
          value={detail.name}
          label="nom du formulaire"
          disabled={busy || archived}
          onSave={(name) => run(() => api.renameForm(formId, name), 'Formulaire renommé.')}
        >
          <h1 className="truncate font-heading text-2xl font-semibold text-foreground md:text-[28px]">
            {detail.name}
          </h1>
        </InlineTextEdit>
        <div className="flex flex-wrap items-center gap-2">
          {detail.usage ? (
            <Badge>{USAGE_LABELS[detail.usage] ?? detail.usage}</Badge>
          ) : (
            <Badge variant="outline">Non affecté</Badge>
          )}
          {archived && <Badge variant="secondary">Archivé</Badge>}
          <span className="text-xs text-muted-foreground">
            {detail.published
              ? `Version ${detail.published.version} publiée le ${formatDate(detail.published.publishedAt)}`
              : 'Jamais publié'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {!detail.usage && !archived && (
            <Button
              type="button"
              size="sm"
              disabled={busy || !detail.published}
              title={
                detail.published ? undefined : 'Publiez une version avant d’affecter ce formulaire.'
              }
              onClick={askAssign}
            >
              {texts.assignAction}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={openDuplicate}>
            Dupliquer
          </Button>
          {archived ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => api.restoreForm(formId), 'Formulaire restauré.')}
            >
              Restaurer
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || detail.usage !== null}
              title={
                detail.usage !== null
                  ? 'Un formulaire affecté à un usage ne peut pas être archivé.'
                  : undefined
              }
              onClick={askArchive}
            >
              Archiver
            </Button>
          )}
        </div>
      </header>

      {draft ? (
        <DraftEditor
          place={place}
          formId={formId}
          draft={draft}
          publishedVersion={detail.published?.version ?? null}
          editable={!archived}
          busy={busy}
          run={run}
          onConfirm={setConfirm}
          onAskName={setNameRequest}
          onEditField={setFieldRequest}
          currentRevision={currentRevision}
        />
      ) : (
        <PublishedView
          existingKeep={texts.existingKeep}
          structure={structure}
          canOpenDraft={!archived}
          busy={busy}
          onOpenDraft={() => void run(() => api.createDraft(formId), 'Brouillon ouvert.')}
        />
      )}

      <section className="mt-10">
        <h2 className="font-heading text-lg font-semibold text-foreground">Versions</h2>
        <div className="mt-3">
          <VersionHistory versions={detail.versions} />
        </div>
      </section>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      <NameSheet request={nameRequest} onClose={() => setNameRequest(null)} />
      <FieldEditorSheet
        request={fieldRequest}
        workspaceForm={place.workspaceForm}
        sections={draft?.sections ?? []}
        onClose={() => setFieldRequest(null)}
        onSubmit={(values: FieldFormValues, field: QuestionnaireField | null) =>
          field
            ? run(() => api.updateField(formId, field.id, toUpdateInput(values), currentRevision()), 'Champ enregistré.')
            : run(() => api.addField(formId, toCreateInput(values), currentRevision()), 'Champ ajouté.')
        }
      />
    </>
  )
}

function PublishedView({
  existingKeep,
  structure,
  canOpenDraft,
  busy,
  onOpenDraft,
}: {
  existingKeep: string
  structure: FormVersionStructure | null
  canOpenDraft: boolean
  busy: boolean
  onOpenDraft: () => void
}) {
  return (
    <section className="mt-8 flex flex-col gap-4">
      <div className="flex flex-col items-start gap-3 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <p>
          La version publiée ne se modifie pas. Ouvrez un brouillon pour préparer la prochaine
          version. {existingKeep}
        </p>
        {canOpenDraft && (
          <Button type="button" size="sm" disabled={busy} onClick={onOpenDraft}>
            Ouvrir un brouillon
          </Button>
        )}
      </div>
      {structure &&
        structure.sections.map((section, i) => (
          <SectionBlock
            key={section.id}
            section={section}
            fields={structure.fields.filter((f) => f.sectionId === section.id)}
            position={i + 1}
            count={structure.sections.length}
            busy={busy}
          />
        ))}
    </section>
  )
}

function DraftEditor({
  place,
  formId,
  draft,
  publishedVersion,
  editable,
  busy,
  run,
  onConfirm,
  onAskName,
  onEditField,
  currentRevision,
}: {
  place: FormsPlace
  formId: string
  draft: FormVersionStructure
  publishedVersion: number | null
  editable: boolean
  busy: boolean
  run: (action: () => Promise<unknown>, success?: string) => Promise<boolean>
  onConfirm: (request: ConfirmRequest) => void
  onAskName: (request: NameRequest) => void
  onEditField: (request: FieldEditorRequest) => void
  currentRevision: () => string | undefined
}) {
  const { api, texts } = place
  const { version, sections, fields, problems } = draft
  const sectionIds = sections.map((s) => s.id)

  function askPublish() {
    onConfirm({
      title: `Publier la version ${version.version} ?`,
      description:
        publishedVersion === null
          ? 'Elle deviendra la version publiée de ce formulaire.'
          : `Elle remplacera la version ${publishedVersion} pour ${texts.forNew}. ${texts.existingKeep}`,
      confirmLabel: 'Publier',
      onConfirm: () =>
        void run(() => api.publishDraft(formId, currentRevision()), `Version ${version.version} publiée.`),
    })
  }

  function askDiscard() {
    onConfirm({
      title: 'Abandonner le brouillon ?',
      description: 'Toutes les modifications du brouillon seront perdues. La version publiée ne change pas.',
      confirmLabel: 'Abandonner',
      onConfirm: () => void run(() => api.discardDraft(formId, currentRevision()), 'Brouillon abandonné.'),
    })
  }

  function askAddSection() {
    onAskName({
      title: 'Nouvelle section',
      description: 'La section est ajoutée en dernière position.',
      submitLabel: 'Ajouter la section',
      fieldLabel: 'Titre de la section',
      initialName: '',
      onSubmit: (title) => run(() => api.addSection(formId, { title }, currentRevision()), 'Section ajoutée.'),
    })
  }

  const actionsFor = (sectionId: string, title: string): SectionActions => {
    const sectionFields = fields.filter((f) => f.sectionId === sectionId)
    return {
      rename: (next) => run(() => api.updateSection(formId, sectionId, { title: next }, currentRevision()), 'Section renommée.'),
      move: (step) => {
        const ids = moveId(sectionIds, sectionId, step)
        if (ids) void run(() => api.reorderSections(formId, ids, currentRevision()))
      },
      remove: () =>
        onConfirm({
          title: `Retirer la section « ${title} » ?`,
          description:
            sectionFields.length === 0
              ? 'La section est vide.'
              : `Ses ${sectionFields.length} champ(s) seront retirés du brouillon.`,
          confirmLabel: 'Retirer',
          onConfirm: () => void run(() => api.removeSection(formId, sectionId, currentRevision()), 'Section retirée.'),
        }),
      addField: () => onEditField({ field: null, sectionId }),
      editField: (field) => onEditField({ field, sectionId }),
      moveField: (field, step) => {
        const ids = moveId(
          sectionFields.map((f) => f.id),
          field.id,
          step,
        )
        if (ids) void run(() => api.reorderFields(formId, sectionId, ids, currentRevision()))
      },
      removeField: (field) =>
        onConfirm({
          title: `Retirer le champ « ${field.label} » ?`,
          description: 'Il est retiré du brouillon ; la version publiée ne change pas.',
          confirmLabel: 'Retirer',
          onConfirm: () => void run(() => api.removeField(formId, field.id, currentRevision()), 'Champ retiré.'),
        }),
    }
  }

  return (
    <section className="mt-8 flex flex-col gap-4" aria-label={`Brouillon de la version ${version.version}`}>
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h2 className="font-heading text-xl font-semibold text-foreground">
            Brouillon — version {version.version}
          </h2>
          <p className="text-xs text-muted-foreground">
            {sections.length} section(s) · {fields.length} champ(s)
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={askDiscard}>
              Abandonner le brouillon
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || problems.length > 0}
              onClick={askPublish}
            >
              Publier la version {version.version}
            </Button>
          </div>
        )}
      </div>

      <DraftProblems problems={problems} />

      <Tabs defaultValue="structure">
        <TabsList>
          <TabsTrigger value="structure">Structure</TabsTrigger>
          <TabsTrigger value="preview">Aperçu</TabsTrigger>
        </TabsList>
        <TabsContent value="structure" className="mt-4 flex flex-col gap-4">
          {sections.map((section, i) => (
            <SectionBlock
              key={section.id}
              section={section}
              fields={fields.filter((f) => f.sectionId === section.id)}
              position={i + 1}
              count={sections.length}
              busy={busy}
              actions={editable ? actionsFor(section.id, section.title) : undefined}
            />
          ))}
          {editable && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={busy}
              onClick={askAddSection}
            >
              + Ajouter une section
            </Button>
          )}
        </TabsContent>
        <TabsContent value="preview" className="mt-4">
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">Le brouillon ne contient encore aucun champ.</p>
          ) : (
            <FormPreview structure={draft} />
          )}
        </TabsContent>
      </Tabs>
    </section>
  )
}
