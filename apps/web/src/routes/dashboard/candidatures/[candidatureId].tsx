import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  CANDIDATURE_STATUS_LABELS,
  FINANCING_STATUS_LABELS,
  financingOpenToCommittees,
  missingRequiredAnswers,
  validateAnswerValue,
  type Candidature,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import {
  changeFinancingStatus,
  getCandidature,
  saveCandidatureAnswers,
  submitCandidature,
  withdrawCandidature,
} from '@/features/candidatures/api'
import { CandidatureFormFields } from '@/features/candidatures/components/CandidatureFormFields'
import { PoolPublicationPanel } from '@/features/candidatures/components/PoolPublicationPanel'
import { CandidateCommitteesPanel } from '@/features/committees/components/CandidateCommitteesPanel'
import { EligibilitiesPanel } from '@/features/eligibilities/components/EligibilitiesPanel'
import { FundingPlanPanel } from '@/features/funding-plans/components/FundingPlanPanel'
import { SupportPathPanel } from '@/features/support-paths/components/SupportPathPanel'
import {
  FinancingStatusBadge,
  FinancingStatusPanel,
} from '@/features/candidatures/components/FinancingStatusPanel'
import type { ApiError } from '@/lib/api-client'
import { stripNonPrintable } from '@/lib/sanitize'
import { useAsync } from '@/lib/useAsync'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

const failure = (err: unknown, fallback: string) => {
  const apiError = err as Partial<ApiError> | undefined
  return apiError?.status === undefined
    ? `${fallback} Vérifiez votre connexion puis réessayez.`
    : (apiError.message ?? fallback)
}

// The problems an API refusal names, by question: `{ fieldId, message }` (invalid answers) or
// `{ fieldId, label }` (required answers missing).
function fieldErrorsOf(err: unknown, required: string): Record<string, string> {
  const details = (err as Partial<ApiError> | undefined)?.details
  if (!Array.isArray(details)) return {}
  return Object.fromEntries(
    details.flatMap((d: { fieldId?: unknown; message?: unknown }) =>
      typeof d.fieldId === 'string'
        ? [[d.fieldId, typeof d.message === 'string' ? d.message : required]]
        : [],
    ),
  )
}

const REQUIRED = 'Réponse obligatoire pour envoyer la candidature.'

// ROADMAP E05.09: a candidature as its owner works on it — the structure's own form, saved apart
// from the company profile and read by that structure's conseillers only once sent.
export default function CandidatureRoute() {
  const { candidatureId = '' } = useParams()
  return <CandidaturePage key={candidatureId} candidatureId={candidatureId} />
}

function CandidaturePage({ candidatureId }: { candidatureId: string }) {
  const query = useAsync(() => getCandidature(candidatureId), [candidatureId])
  const [current, setCurrent] = useState<Candidature | null>(null)
  const candidature = current ?? query.data ?? null

  if (!candidature) {
    if (query.error) {
      const status = (query.error as ApiError).status
      return (
        <div className="flex flex-col items-start gap-2 pt-8">
          <title>Candidature introuvable · Confluent</title>
          <p role="alert" className="text-sm text-foreground">
            {status === 404 || status === 400
              ? 'Cette candidature est introuvable, ou elle n’est pas la vôtre.'
              : 'Impossible de charger la candidature. Réessayez plus tard.'}
          </p>
          <Link to="/dashboard" className="text-sm text-foreground underline underline-offset-4">
            Retour à mes dossiers
          </Link>
        </div>
      )
    }
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }
  return <CandidatureEditor candidature={candidature} onChange={setCurrent} />
}

function CandidatureEditor({
  candidature,
  onChange,
}: {
  candidature: Candidature
  onChange: (next: Candidature) => void
}) {
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { workspace, dossier, form } = candidature
  const saved = Object.fromEntries(candidature.answers.map((a) => [a.fieldId, a.value]))
  const [values, setValues] = useState<Record<string, string>>(saved)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const submitted = candidature.status === 'submitted'
  const dossierPath = `/dashboard/dossiers/view/${encodeURIComponent(dossier.slug)}`

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // The answers that differ from what is saved, cleaned like the profile's; problems found here
  // with the same rules as the API.
  function changes() {
    const problems: Record<string, string> = {}
    const answers = form.fields.flatMap((field) => {
      const raw = values[field.id] ?? ''
      const value = stripNonPrintable(raw, { multiline: field.fieldType === 'textarea' }).trim()
      if (value === (saved[field.id] ?? '')) return []
      const problem = validateAnswerValue(field, value)
      if (problem) problems[field.id] = problem
      return [{ fieldId: field.id, value }]
    })
    return { answers, problems }
  }

  async function save(): Promise<boolean> {
    const { answers, problems } = changes()
    setErrors(problems)
    if (Object.keys(problems).length > 0) {
      toast.error('Corrigez les réponses signalées avant d’enregistrer.')
      return false
    }
    if (answers.length === 0) return true
    try {
      await saveCandidatureAnswers(candidature.id, answers)
      onChange(await getCandidature(candidature.id))
      return true
    } catch (err) {
      setErrors(fieldErrorsOf(err, REQUIRED))
      toast.error(failure(err, 'Les réponses n’ont pas pu être enregistrées.'))
      return false
    }
  }

  async function handleSave() {
    setBusy(true)
    if (await save()) toast.success('Réponses enregistrées.')
    setBusy(false)
  }

  async function handleSubmit() {
    const missing = missingRequiredAnswers(form.fields, values, new Set())
    if (missing.length > 0) {
      setErrors(Object.fromEntries(missing.map((f) => [f.id, REQUIRED])))
      toast.error(`${missing.length} réponse(s) obligatoire(s) manquante(s).`)
      return
    }
    setBusy(true)
    if (await save()) {
      try {
        onChange(await submitCandidature(candidature.id))
        toast.success(`Candidature envoyée à ${workspace.name}.`)
      } catch (err) {
        setErrors(fieldErrorsOf(err, REQUIRED))
        toast.error(failure(err, 'La candidature n’a pas pu être envoyée.'))
      }
    }
    setBusy(false)
  }

  // A draft only: once sent, the structure follows the candidature and keeps it (E06.01).
  function askWithdraw() {
    setConfirm({
      title: 'Retirer la candidature ?',
      description:
        'Vos réponses au formulaire de la structure, le plan de financement et les dispositifs préparés pour elle seront supprimés ; le profil de l’entreprise et la demande ne changent pas.',
      confirmLabel: 'Retirer',
      onConfirm: () => {
        setBusy(true)
        withdrawCandidature(candidature.id).then(
          () => {
            toast.success('Candidature retirée.')
            void navigate(`${dossierPath}?tab=candidatures`)
          },
          (err: unknown) => {
            toast.error(failure(err, 'La candidature n’a pas pu être retirée.'))
            setBusy(false)
          },
        )
      },
    })
  }

  return (
    <>
      <title>{`Candidature · ${workspace.name} · Confluent`}</title>
      <nav aria-label="Fil d’Ariane" className="wrap-anywhere text-xs text-muted-foreground">
        <Link to="/dashboard" className="hover:underline">
          Mes dossiers
        </Link>
        {' / '}
        <Link to={`${dossierPath}?tab=candidatures`} className="hover:underline">
          {dossier.name}
        </Link>
        {' / '}
        <span className="text-foreground">{workspace.name}</span>
      </nav>

      <header className="mt-4 flex max-w-3xl flex-col gap-2">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="wrap-anywhere font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
        >
          Candidature auprès de {workspace.name}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {submitted ? (
            <FinancingStatusBadge status={candidature.financingStatus} />
          ) : (
            <Badge variant="outline">{CANDIDATURE_STATUS_LABELS[candidature.status]}</Badge>
          )}
          {workspace.programName && <span className="wrap-anywhere">{workspace.programName}</span>}
          <span>
            {candidature.submittedAt
              ? `Envoyée le ${dateFr(candidature.submittedAt)}`
              : 'La structure ne voit rien avant l’envoi.'}
          </span>
        </div>
      </header>

      <div className="mt-6 flex max-w-3xl flex-col gap-6">
        {submitted && (
          <FinancingStatusPanel
            actor="owner"
            status={candidature.financingStatus}
            changedAt={candidature.financingStatusChangedAt}
            history={candidature.statusHistory}
            describeBy={(change) => (change.by === 'owner' ? 'par vous' : `par ${workspace.name}`)}
            intro={`Où en est votre demande auprès de ${workspace.name}. La structure indique le passage en comité, le financement ou le refus ; vous pouvez abandonner la demande auprès d’elle, puis la reprendre.`}
            confirmText={() =>
              `${workspace.name} verra que vous abandonnez votre demande auprès d’elle ; elle garde votre candidature. Vous pourrez la reprendre ensuite.`
            }
            onTransition={async (to) => {
              onChange(
                await changeFinancingStatus(candidature.id, {
                  from: candidature.financingStatus,
                  to,
                }),
              )
            }}
            onStale={() => {
              void getCandidature(candidature.id).then(onChange, () => undefined)
            }}
          />
        )}

        {submitted && (
          <CandidateCommitteesPanel
            candidatureId={candidature.id}
            workspaceName={workspace.name}
            canBringRequest={
              financingOpenToCommittees(candidature.financingStatus) &&
              dossier.publicationStatus !== 'archived'
            }
            closedReason={
              dossier.publicationStatus === 'archived'
                ? 'La demande est archivée : désarchivez-la pour la présenter à un comité. Vous pouvez toujours retirer une participation.'
                : `La demande est « ${FINANCING_STATUS_LABELS[candidature.financingStatus]} » auprès de ${workspace.name} : elle n’est plus présentée en comité. Vous pouvez toujours retirer une participation.`
            }
          />
        )}

        {submitted && (
          <PoolPublicationPanel
            candidature={candidature}
            onChange={onChange}
            onStale={() => {
              void getCandidature(candidature.id).then(onChange, () => undefined)
            }}
          />
        )}

        <SupportPathPanel
          scope={{ side: 'owner', candidatureId: candidature.id }}
          intro={
            submitted
              ? `Les étapes par lesquelles ${workspace.name} accompagne votre demande, et celles que la structure a validées. Ni les autres structures, ni les investisseurs, ni les personnes avec qui vous partagez la demande ne les voient.`
              : `Les étapes par lesquelles ${workspace.name} accompagnera votre demande une fois la candidature envoyée ; ses conseillers les valideront au fil de l’accompagnement.`
          }
        />

        <FundingPlanPanel
          scope={{ side: 'owner', candidatureId: candidature.id }}
          intro={
            submitted
              ? `Vos sources de financement pour cette demande, réparties selon les sources proposées par ${workspace.name}. Vous et ses conseillers pouvez compléter ce plan ; ni les autres structures, ni les investisseurs, ni les personnes avec qui vous partagez la demande ne le voient.`
              : `Préparez vos sources de financement pour cette demande, réparties selon les sources proposées par ${workspace.name}. Ses conseillers verront ce plan, et pourront le compléter, une fois la candidature envoyée ; ni les autres structures, ni les investisseurs, ni les personnes avec qui vous partagez la demande ne le voient.`
          }
          describeSide={(side) => (side === 'owner' ? 'par vous' : `par ${workspace.name}`)}
          noObjective={
            <>
              Le montant recherché de la demande n’est pas indiqué : sans lui, le reste à financer
              ne peut pas être calculé.{' '}
              <Link to={`${dossierPath}?tab=demande`} className="underline underline-offset-4">
                Indiquer le montant recherché
              </Link>
            </>
          }
        />

        <EligibilitiesPanel
          scope={{ side: 'owner', candidatureId: candidature.id }}
          intro={
            submitted
              ? `Les dispositifs proposés par ${workspace.name} auxquels votre entreprise se déclare éligible pour cette demande. Ses conseillers les voient, peuvent en indiquer et les marquer vérifiés ; ni les autres structures, ni les investisseurs, ni les personnes avec qui vous partagez la demande ne les voient.`
              : `Indiquez les dispositifs proposés par ${workspace.name} auxquels votre entreprise se déclare éligible. Ses conseillers les verront une fois la candidature envoyée ; ni les autres structures, ni les investisseurs, ni les personnes avec qui vous partagez la demande ne les voient.`
          }
          describeSide={(side) => (side === 'owner' ? 'par vous' : `par ${workspace.name}`)}
        />

        <section
          aria-label="Ce que la structure reçoit"
          className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground"
        >
          <p>
            Une fois envoyée, les conseillers de {workspace.name} lisent la présentation de la
            demande « {dossier.name} », le profil de l’entreprise tel que vous l’avez renseigné
            (sans les pièces jointes), le plan de financement et les dispositifs ci-dessus et vos
            réponses ci-dessous.
          </p>
          <p className="mt-2 text-muted-foreground">
            Ces réponses sont propres à cette candidature : ni les autres structures, ni les
            personnes avec qui vous partagez la demande ne les voient.
          </p>
        </section>

        {!dossier.profileSubmitted && (
          <p
            role="status"
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          >
            Le profil de l’entreprise n’est pas encore soumis pour cette demande : vous pouvez
            préparer vos réponses, puis{' '}
            <Link to={dossierPath} className="underline underline-offset-4">
              terminer le profil
            </Link>{' '}
            avant d’envoyer la candidature.
          </p>
        )}

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void handleSave()
          }}
          className="flex flex-col gap-6"
          aria-label={`Formulaire de ${workspace.name}`}
        >
          <div>
            <h2 className="font-heading text-lg font-semibold text-foreground">{form.name}</h2>
            <p className="text-xs text-muted-foreground">Version {form.version.version}</p>
          </div>
          <CandidatureFormFields
            sections={form.sections}
            fields={form.fields}
            values={values}
            errors={errors}
            disabled={busy}
            onChange={(fieldId, value) => {
              setValues((prev) => ({ ...prev, [fieldId]: value }))
              setErrors((prev) => {
                const next = { ...prev }
                delete next[fieldId]
                return next
              })
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant={submitted ? 'default' : 'outline'} disabled={busy}>
              {submitted ? 'Enregistrer les corrections' : 'Enregistrer le brouillon'}
            </Button>
            {!submitted && (
              <Button
                type="button"
                disabled={busy || !dossier.profileSubmitted}
                title={
                  dossier.profileSubmitted
                    ? undefined
                    : 'Soumettez d’abord le profil de l’entreprise pour cette demande.'
                }
                onClick={() => void handleSubmit()}
              >
                Envoyer à {workspace.name}
              </Button>
            )}
            {!submitted && (
              <Button type="button" variant="ghost" disabled={busy} onClick={askWithdraw}>
                Retirer la candidature
              </Button>
            )}
          </div>
        </form>
      </div>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}
