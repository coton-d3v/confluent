import { Button } from '@/components/ui/button'
import { logout } from '@/features/auth/api'
import { ShareShell } from './ShareShell'

// Logged in, but not as the person the dossier was shared with: offer to switch account.
export function RecipientMismatchPage({ email }: { email: string }) {
  return (
    <ShareShell title="Lien destiné à un autre compte">
      <h1 className="font-heading text-2xl font-medium text-foreground">Lien destiné à un autre compte</h1>
      <p className="text-sm text-muted-foreground">
        Ce dossier a été partagé avec une autre adresse que celle de votre compte (
        <span className="font-medium text-foreground">{email}</span>). Déconnectez-vous puis
        connectez-vous avec l’adresse qui a reçu le partage.
      </p>
      <Button size="lg" variant="outline" className="h-11 w-full" onClick={() => void logout()}>
        Me déconnecter
      </Button>
    </ShareShell>
  )
}
