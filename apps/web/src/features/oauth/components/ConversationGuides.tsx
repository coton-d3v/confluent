import { listConversationGuides, type ConversationGuide } from '@/features/oauth/api'
import { useAsync } from '@/lib/useAsync'
import { CopyButton } from './CopyButton'

// E04.10: the guides this account can follow with a connected assistant, as the API serves them
// (the same text as the MCP prompts). Nothing is shown to an account without a guide.
export function ConversationGuides() {
  const { data, isLoading, error } = useAsync(() => listConversationGuides(), [])
  if (isLoading || (data && data.length === 0)) return null
  return (
    <section className="mt-10 max-w-2xl" aria-labelledby="guides-title">
      <h2 id="guides-title" className="font-heading text-xl font-semibold text-foreground">
        Guides de conversation
      </h2>
      {error || !data ? (
        <p className="mt-4 text-sm text-destructive">Impossible de charger les guides.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Des parcours pas à pas à suivre avec votre assistant connecté à Confluent. Un guide ne
            donne aucun droit supplémentaire : rien n’est soumis ni publié sans votre demande
            explicite.
          </p>
          <ul role="list" className="mt-4 flex flex-col gap-4">
            {data.map((guide) => (
              <GuideCard key={guide.id} guide={guide} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function GuideCard({ guide }: { guide: ConversationGuide }) {
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <h3 className="font-medium text-foreground">{guide.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{guide.description}</p>
      <dl className="mt-3 flex flex-col gap-3 text-sm">
        <div>
          <dt className="font-medium text-foreground">Dans Claude</dt>
          <dd className="mt-0.5 text-muted-foreground">
            Choisissez « {guide.title} » parmi les prompts du connecteur Confluent.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Dans ChatGPT ou un autre assistant</dt>
          <dd className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 text-sm wrap-anywhere text-foreground">
              {guide.request}
            </code>
            <CopyButton text={guide.request} label={`Copier la demande « ${guide.title} »`} />
          </dd>
        </div>
      </dl>
      <details className="group mt-3">
        <summary className="inline-flex min-h-9 cursor-pointer items-center text-sm text-muted-foreground hover:text-foreground">
          Voir le texte complet du guide
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            À coller tel quel dans une conversation si votre assistant ne trouve pas le guide.
          </p>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-sans text-sm whitespace-pre-wrap text-foreground">
            {guide.text}
          </pre>
          <div>
            <CopyButton text={guide.text} label={`Copier le guide « ${guide.title} »`}>
              Copier le guide
            </CopyButton>
          </div>
        </div>
      </details>
    </li>
  )
}
