import { Link, Navigate, useParams } from 'react-router-dom'
import { useCurrentUser } from '@/features/current-user/context'
import { FormEditor } from '@/features/form-builder/components/FormEditor'
import { CONFLUENT_FORMS } from '@/features/form-builder/place'

// Confluent's own forms, for its administrators.
export default function AdminFormEditorRoute() {
  const me = useCurrentUser()
  const { formId } = useParams<{ formId: string }>()
  if (me.role !== 'admin') return <Navigate to="/dashboard" replace />
  if (!formId) return <Navigate to="/admin/formulaires" replace />
  return (
    <FormEditor
      key={formId}
      place={CONFLUENT_FORMS}
      formId={formId}
      trail={(name) => (
        <nav aria-label="Fil d’Ariane" className="text-xs text-muted-foreground">
          <Link to="/admin" className="hover:underline">
            Admin
          </Link>
          {' / '}
          <Link to="/admin/formulaires" className="hover:underline">
            Formulaires
          </Link>
          {' / '}
          <span className="text-foreground">{name}</span>
        </nav>
      )}
    />
  )
}
