import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LoaderCircleIcon } from 'lucide-react'
import {
  ENTREPRENEUR_ACCESS_FORM_TIMING,
  ENTREPRENEUR_ACCESS_HONEYPOT_FIELD,
  ENTREPRENEUR_ACCESS_REQUEST_LIMITS,
  createEntrepreneurAccessRequestSchema,
  type EntrepreneurAccessForm,
} from '@confluent/shared'
import { PublicShell } from '@/components/confluent/PublicShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  getEntrepreneurAccessForm,
  sendEntrepreneurAccessRequest,
} from '@/features/entrepreneur-access/api'
import type { ApiError } from '@/lib/api-client'

type FieldName = 'name' | 'companyName' | 'email' | 'message'
type Errors = Partial<Record<FieldName, string>>
const FIELDS: FieldName[] = ['name', 'companyName', 'email', 'message']
const isField = (key: unknown): key is FieldName => FIELDS.includes(key as FieldName)

type Loaded = { form: EntrepreneurAccessForm; receivedAt: number }

// ROADMAP E09.05: a workspace's public access request form — an entrepreneur without a Confluent
// account asks the structure for access to its candidature path. Offered only while its public page
// shows how to apply. Sent, the request waits for the structure's decision: no account, no access, no
// email until then, which the page says before anything is typed. Confluent opens no general sign-up.
// Not indexed by search engines.
export default function EntrepreneurAccessRoute() {
  const { slug = '' } = useParams()
  return <EntrepreneurAccessPage key={slug} slug={slug} />
}

function EntrepreneurAccessPage({ slug }: { slug: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [values, setValues] = useState({ name: '', companyName: '', email: '', message: '' })
  const [trap, setTrap] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const sentRef = useRef<HTMLDivElement>(null)

  // (Re)loads the form and a fresh token; what was typed is kept.
  async function load(): Promise<void> {
    try {
      const form = await getEntrepreneurAccessForm(slug)
      setLoaded({ form, receivedAt: Date.now() })
      setLoadError(null)
    } catch (err) {
      setLoadError(err as ApiError)
    }
  }

  useEffect(() => {
    void load()
    // Loaded once per page (keyed by slug).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (state === 'sent') sentRef.current?.focus()
  }, [state])

  function set(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFailure(null)
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!loaded) return
    setFailure(null)
    const input = {
      ...values,
      formToken: loaded.form.formToken,
      ...(trap ? { [ENTREPRENEUR_ACCESS_HONEYPOT_FIELD]: trap } : {}),
    }
    const parsed = createEntrepreneurAccessRequestSchema.safeParse(input)
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
    setState('sending')
    try {
      // The API refuses a form sent sooner than this after the page gave it (anti-robot).
      const wait = loaded.receivedAt + ENTREPRENEUR_ACCESS_FORM_TIMING.minFillMs + 200 - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      await sendEntrepreneurAccessRequest(slug, input)
      setState('sent')
    } catch (err) {
      setState('idle')
      handleRefusal(err as ApiError)
    }
  }

  function handleRefusal(err: ApiError | undefined) {
    const details = err?.details
    if (err?.status === 400 && Array.isArray(details)) {
      const found: Errors = {}
      for (const d of details as Array<{ path?: unknown[]; message?: string }>) {
        const field = d.path?.[0]
        if (isField(field) && d.message) found[field] ??= d.message
      }
      if (Object.keys(found).length > 0) {
        setErrors(found)
        focusFirstError(found)
        return
      }
    }
    if (err?.status === 400) {
      // An expired form: a fresh token is read, what was typed is kept.
      void load()
      setFailure('Le formulaire a été rechargé : envoyez-le de nouveau.')
      return
    }
    if (err?.status === 404) {
      setLoadError(err)
      return
    }
    setFailure(
      err?.status === 429 || err?.status === 503
        ? err.message
        : 'Envoi impossible pour le moment. Réessayez dans quelques instants.',
    )
  }

  if (loadError) {
    return (
      <PublicShell title="Demande d’accès">
        <h1 className="font-heading text-2xl font-medium text-foreground">Demande d’accès</h1>
        <p
          role="alert"
          className="rounded-lg border border-border bg-card p-4 text-sm text-foreground"
        >
          {loadError.status === 404
            ? 'Aucune structure ne reçoit de demande d’accès à cette adresse. Vérifiez le lien reçu, ou contactez la structure qui vous l’a donné.'
            : 'Le formulaire est indisponible pour le moment. Réessayez dans quelques instants.'}
        </p>
        {loadError.status !== 404 && (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => void load()}
          >
            Réessayer
          </Button>
        )}
      </PublicShell>
    )
  }
  if (!loaded) {
    return (
      <PublicShell title="Demande d’accès">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </PublicShell>
    )
  }

  const { workspace } = loaded.form
  const structure = workspace.programName ?? workspace.name

  if (state === 'sent') {
    return (
      <PublicShell title={`Demande envoyée · ${structure}`}>
        <div
          ref={sentRef}
          tabIndex={-1}
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 focus-visible:outline-none"
        >
          <h1 className="font-heading text-xl font-medium text-foreground">Demande envoyée</h1>
          <p className="text-sm text-foreground">
            {workspace.name} a reçu votre demande. Elle sera étudiée par l’équipe de la structure :
            si elle est acceptée, vous recevrez une invitation par email à l’adresse indiquée, pour
            vous connecter et présenter votre demande de financement.
          </p>
          <p className="text-sm text-muted-foreground">
            Aucun compte n’a été créé et aucun email ne vous est envoyé pour l’instant. Si vous avez
            déjà fait une demande auprès de cette structure, elle reste celle qui sera étudiée.
          </p>
        </div>
      </PublicShell>
    )
  }

  const messageLength = values.message.length
  return (
    <PublicShell title={`Demande d’accès · ${structure}`}>
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground wrap-anywhere">{structure}</p>
        <h1 className="font-heading text-2xl font-medium text-foreground">
          Demander un accès pour candidater
        </h1>
        <p className="text-sm text-muted-foreground">
          Vous portez un projet et n’avez pas encore de compte Confluent : présentez-vous, la
          structure étudiera votre demande.
        </p>
      </header>

      <p className="text-sm text-foreground">
        Vous avez déjà un compte ?{' '}
        <Link to="/auth" className="underline underline-offset-4 hover:no-underline">
          Connectez-vous
        </Link>{' '}
        et présentez directement votre demande à {workspace.name}.
      </p>

      <section
        aria-labelledby="access-privacy-title"
        className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-4 text-sm"
      >
        <h2 id="access-privacy-title" className="font-medium text-foreground">
          Ce que deviennent vos informations
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
          <li>
            Votre nom, le nom de votre entreprise ou de votre projet, votre adresse email et votre
            message sont transmis à {workspace.name}, qui seul les lit, pour étudier votre demande.
          </li>
          <li>
            Envoyer ce formulaire ne crée aucun compte et ne donne accès à rien. Aucun email ne vous
            est envoyé à ce stade.
          </li>
          <li>
            Si la structure accepte votre demande, un compte de porteur de projet est ouvert à votre
            adresse et elle vous invite par email à présenter votre demande ; rien n’est créé à
            votre place. Sinon, elle ne vous donne aucun accès.
          </li>
        </ul>
        <p className="text-muted-foreground">
          En savoir plus :{' '}
          <Link to="/confidentialite" className="underline underline-offset-4">
            politique de confidentialité
          </Link>
          .
        </p>
      </section>

      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field id="name" label="Nom et prénom" required error={errors.name}>
          <Input
            id="access-name"
            autoComplete="name"
            value={values.name}
            maxLength={ENTREPRENEUR_ACCESS_REQUEST_LIMITS.name}
            onChange={(e) => set('name', e.target.value)}
            {...invalid('name', errors)}
          />
        </Field>
        <Field
          id="companyName"
          label="Entreprise ou projet"
          required
          error={errors.companyName}
          help="Le nom de votre entreprise, ou de votre projet s’il n’est pas encore immatriculé."
        >
          <Input
            id="access-companyName"
            autoComplete="organization"
            value={values.companyName}
            maxLength={ENTREPRENEUR_ACCESS_REQUEST_LIMITS.companyName}
            onChange={(e) => set('companyName', e.target.value)}
            {...invalid('companyName', errors)}
          />
        </Field>
        <Field
          id="email"
          label="Adresse email"
          required
          error={errors.email}
          help="Celle à laquelle la structure vous répondra, et qui servira à vous connecter."
        >
          <Input
            id="access-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={values.email}
            maxLength={ENTREPRENEUR_ACCESS_REQUEST_LIMITS.email}
            onChange={(e) => set('email', e.target.value)}
            {...invalid('email', errors)}
          />
        </Field>
        <Field
          id="message"
          label="Message"
          error={errors.message}
          help={`Facultatif : présentez votre projet et votre besoin. Texte simple, ${messageLength} / ${ENTREPRENEUR_ACCESS_REQUEST_LIMITS.message} caractères.`}
        >
          <Textarea
            id="access-message"
            rows={5}
            value={values.message}
            maxLength={ENTREPRENEUR_ACCESS_REQUEST_LIMITS.message}
            onChange={(e) => set('message', e.target.value)}
            {...invalid('message', errors)}
          />
        </Field>

        {/* Left empty by people: hidden from them and from assistive technologies, out of the tab
            order. Robots filling every field are set aside. */}
        <div
          aria-hidden="true"
          className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
        >
          <label htmlFor="access-website">Site web (ne pas remplir)</label>
          <input
            id="access-website"
            name={ENTREPRENEUR_ACCESS_HONEYPOT_FIELD}
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={trap}
            onChange={(e) => setTrap(e.target.value)}
          />
        </div>

        <div aria-live="assertive">
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
        </div>

        <Button
          type="submit"
          size="lg"
          className="h-11 w-full sm:w-auto"
          disabled={state === 'sending'}
        >
          {state === 'sending' ? (
            <>
              <LoaderCircleIcon
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Envoi…
            </>
          ) : (
            'Envoyer ma demande'
          )}
        </Button>
      </form>
    </PublicShell>
  )
}

function Field({
  id,
  label,
  required,
  help,
  error,
  children,
}: {
  id: FieldName
  label: string
  required?: boolean
  help?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`access-${id}`}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </Label>
      {children}
      {help && (
        <p id={`access-${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      <div aria-live="assertive">
        {error && (
          <p id={`access-${id}-error`} className="text-xs text-destructive">
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
    'aria-required': field === 'message' ? undefined : true,
    'aria-describedby':
      [error ? `access-${field}-error` : null, field === 'name' ? null : `access-${field}-help`]
        .filter(Boolean)
        .join(' ') || undefined,
  }
}

function focusFirstError(errors: Errors) {
  const first = FIELDS.find((field) => errors[field])
  if (first) document.getElementById(`access-${first}`)?.focus()
}
