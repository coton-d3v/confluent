import { useEffect, useRef } from 'react'
import { Navigate } from 'react-router-dom'
import { useCurrentUser } from '@/features/current-user/context'
import { FormsList } from '@/features/form-builder/components/FormsList'
import { CONFLUENT_FORMS } from '@/features/form-builder/place'

// Confluent's own forms, for its administrators.
export default function AdminFormsRoute() {
  const me = useCurrentUser()
  if (me.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <AdminFormsList />
}

function AdminFormsList() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])
  return (
    <>
      <title>Formulaires · Confluent</title>
      <FormsList
        place={CONFLUENT_FORMS}
        title={
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
          >
            Formulaires
          </h1>
        }
      />
    </>
  )
}
