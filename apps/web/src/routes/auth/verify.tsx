import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LoaderCircleIcon } from 'lucide-react'
import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
import { Button } from '@/components/ui/button'
import { verifyMagicLink } from '@/features/auth/api'
import { consumeReturnTo } from '@/features/auth/return-to'

type Status = 'pending' | 'error'

export default function AuthVerifyRoute() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>('pending')
  const started = useRef(false)

  useEffect(() => {
    // useRef survives StrictMode's double-mount; prevents consuming the token twice
    if (started.current) return
    started.current = true

    const token = params.get('token')
    if (!token) {
      setStatus('error')
      return
    }
    void (async () => {
      try {
        const user = await verifyMagicLink(token)
        // e.g. back to the OAuth consent screen that sent the user to log in
        const target = consumeReturnTo() ?? (user.role === 'admin' ? '/admin' : '/dashboard')
        navigate(target, { replace: true })
      } catch {
        setStatus('error')
      }
    })()
  }, [params, navigate])

  return (
    <>
      <title>Vérification · Confluent</title>
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-12">
        <ConfluentWordmark className="h-7 w-auto text-foreground" />
        {status === 'pending' ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <LoaderCircleIcon
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Vérification de votre lien…
          </div>
        ) : (
          <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
            <h1 className="font-heading text-2xl font-medium text-foreground">
              Lien invalide ou expiré
            </h1>
            <p className="text-sm text-muted-foreground">
              Le lien a peut-être expiré ou déjà été utilisé.
            </p>
            <Button size="lg" onClick={() => navigate('/auth', { replace: true })}>
              Demander un nouveau lien
            </Button>
          </div>
        )}
      </main>
    </>
  )
}
