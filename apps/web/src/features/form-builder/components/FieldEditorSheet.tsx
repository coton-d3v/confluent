import type { ReactNode } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  accessLevelSchema,
  fieldTypeSchema,
  type QuestionnaireField,
  type QuestionnaireSection,
} from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { ACCESS_LEVEL_LABELS, FIELD_TYPE_LABELS } from '../labels'

const fieldFormSchema = z.object({
  sectionId: z.string().min(1),
  label: z.string().trim().min(1, 'Le libellé est obligatoire.').max(500),
  key: z.union([
    z.literal(''),
    z
      .string()
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/, 'Minuscules, chiffres et « _ », en commençant par une lettre.'),
  ]),
  helpText: z.string().max(2000),
  fieldType: fieldTypeSchema,
  required: z.boolean(),
  minAccessLevel: accessLevelSchema,
  // `key` is absent for a choice added here: the API derives it from the label.
  choices: z.array(
    z.object({
      key: z.string().optional(),
      label: z.string().trim().min(1, 'Libellé du choix obligatoire.').max(500),
    }),
  ),
})

export type FieldFormValues = z.infer<typeof fieldFormSchema>

export interface FieldEditorRequest {
  // `null`: a new field, added at the end of `sectionId`.
  field: QuestionnaireField | null
  sectionId: string
}

export function FieldEditorSheet({
  request,
  sections,
  onClose,
  onSubmit,
}: {
  request: FieldEditorRequest | null
  sections: QuestionnaireSection[]
  onClose: () => void
  // Resolves to true when saved (the sheet then closes).
  onSubmit: (values: FieldFormValues, field: QuestionnaireField | null) => Promise<boolean>
}) {
  return (
    <Sheet open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto duration-150 sm:max-w-md">
        {request && (
          <FieldForm
            key={request.field?.id ?? `new-${request.sectionId}`}
            request={request}
            sections={sections}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function initialValues({ field, sectionId }: FieldEditorRequest): FieldFormValues {
  return {
    sectionId: field?.sectionId ?? sectionId,
    label: field?.label ?? '',
    key: field?.key ?? '',
    helpText: field?.helpText ?? '',
    fieldType: field?.fieldType ?? 'text',
    required: field?.required ?? false,
    // E03.07: a new field is only readable through a full share until someone decides otherwise.
    minAccessLevel: field?.minAccessLevel ?? 'complet',
    choices: field?.choices.map((c) => ({ key: c.key, label: c.label })) ?? [],
  }
}

function FieldForm({
  request,
  sections,
  onClose,
  onSubmit,
}: {
  request: FieldEditorRequest
  sections: QuestionnaireSection[]
  onClose: () => void
  onSubmit: (values: FieldFormValues, field: QuestionnaireField | null) => Promise<boolean>
}) {
  const isNew = request.field === null
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FieldFormValues>({
    resolver: zodResolver(fieldFormSchema),
    defaultValues: initialValues(request),
  })
  const choices = useFieldArray({ control, name: 'choices' })
  const fieldType = useWatch({ control, name: 'fieldType' })

  const submit = handleSubmit(async (values) => {
    if (await onSubmit(values, request.field)) onClose()
  })

  return (
    <>
      <SheetHeader>
        <SheetTitle>{isNew ? 'Nouveau champ' : 'Modifier le champ'}</SheetTitle>
        <SheetDescription>
          Les modifications s’appliquent au brouillon ; les dossiers existants gardent leur version.
        </SheetDescription>
      </SheetHeader>
      <Separator />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 px-4 py-3">
        <FormRow id="field-label" label="Libellé" error={errors.label?.message}>
          <Input id="field-label" autoFocus {...register('label')} />
        </FormRow>

        <FormRow id="field-help" label="Aide (facultatif)" error={errors.helpText?.message}>
          <Textarea id="field-help" rows={2} {...register('helpText')} />
        </FormRow>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow id="field-type" label="Type">
            <NativeSelect id="field-type" {...register('fieldType')}>
              {fieldTypeSchema.options.map((type) => (
                <option key={type} value={type}>
                  {FIELD_TYPE_LABELS[type]}
                </option>
              ))}
            </NativeSelect>
          </FormRow>
          <FormRow id="field-section" label="Section">
            <NativeSelect id="field-section" {...register('sectionId')}>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </NativeSelect>
          </FormRow>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" {...register('required')} />
          Réponse obligatoire
        </label>

        <FormRow id="field-level" label="Lisible par un financeur avec un partage">
          <NativeSelect id="field-level" {...register('minAccessLevel')}>
            {accessLevelSchema.options.map((level) => (
              <option key={level} value={level}>
                {ACCESS_LEVEL_LABELS[level]}
              </option>
            ))}
          </NativeSelect>
        </FormRow>

        {fieldType === 'select' && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Choix</legend>
            {choices.fields.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Une liste doit avoir au moins un choix pour être publiée.
              </p>
            )}
            <ol className="flex flex-col gap-2">
              {choices.fields.map((choice, index) => (
                <li key={choice.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label={`Choix ${index + 1}`}
                      aria-invalid={errors.choices?.[index]?.label ? 'true' : undefined}
                      {...register(`choices.${index}.label`)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Monter le choix ${index + 1}`}
                      disabled={index === 0}
                      onClick={() => choices.move(index, index - 1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Descendre le choix ${index + 1}`}
                      disabled={index === choices.fields.length - 1}
                      onClick={() => choices.move(index, index + 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Retirer le choix ${index + 1}`}
                      onClick={() => choices.remove(index)}
                    >
                      ×
                    </Button>
                  </div>
                  {choice.key && (
                    <p className="text-[11px] text-muted-foreground">
                      Clé <code>{choice.key}</code> conservée : renommer ce choix ne change ni les
                      réponses ni la classification.
                    </p>
                  )}
                  {errors.choices?.[index]?.label && (
                    <p className="text-xs text-destructive">
                      {errors.choices[index]?.label?.message}
                    </p>
                  )}
                </li>
              ))}
            </ol>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => choices.append({ label: '' })}
            >
              Ajouter un choix
            </Button>
          </fieldset>
        )}

        {isNew ? (
          <FormRow
            id="field-key"
            label="Clé technique (facultatif)"
            hint="Dérivée du libellé si vide. Elle ne doit plus changer une fois publiée."
            error={errors.key?.message}
          >
            <Input id="field-key" className="font-mono" {...register('key')} />
          </FormRow>
        ) : (
          <p className="text-xs text-muted-foreground">
            Clé technique : <code>{request.field?.key}</code> (stable, lue par la classification et
            les intégrations).
          </p>
        )}

        <SheetFooter className="flex-col gap-2 px-0 sm:flex-row-reverse sm:justify-start">
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? 'Enregistrement…' : isNew ? 'Ajouter le champ' : 'Enregistrer'}
          </Button>
          <SheetClose render={<Button type="button" variant="outline" size="lg" />}>
            Annuler
          </SheetClose>
        </SheetFooter>
      </form>
    </>
  )
}

function FormRow({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
