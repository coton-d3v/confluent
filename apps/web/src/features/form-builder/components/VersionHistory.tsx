import type { QuestionnaireVersion } from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { formatDate, VERSION_STATUS_LABELS } from '../labels'

const VARIANT = { draft: 'outline', published: 'default', archived: 'secondary' } as const

export function VersionHistory({ versions }: { versions: QuestionnaireVersion[] }) {
  return (
    <ul role="list" className="m-0 list-none divide-y divide-border rounded-lg border border-border bg-card p-0">
      {versions.map((v) => (
        <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span className="text-foreground">
            Version {v.version}
            {v.publishedAt && (
              <span className="ml-2 text-xs text-muted-foreground">
                publiée le {formatDate(v.publishedAt)}
              </span>
            )}
          </span>
          <Badge variant={VARIANT[v.status]}>{VERSION_STATUS_LABELS[v.status]}</Badge>
        </li>
      ))}
    </ul>
  )
}
