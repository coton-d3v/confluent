import { LEGAL_INFO } from '@/features/legal/legal-info'
import { LegalPage, LegalSection } from './LegalPage'

export default function ConfidentialiteRoute() {
  const contact = LEGAL_INFO.privacyContact
  return (
    <LegalPage title="Politique de confidentialité">
      <LegalSection title="Notre principe">
        <p>
          Vos données vous appartiennent. Vous décidez qui peut consulter votre dossier, vous voyez
          qui l&apos;a consulté, et vous pouvez retirer un accès à tout moment. Nous ne vendons
          aucune donnée.
        </p>
      </LegalSection>

      <LegalSection title="Responsable du traitement">
        <p>
          {LEGAL_INFO.publisher.name} — contact :{' '}
          <a href={`mailto:${contact}`} className="underline underline-offset-4">
            {contact}
          </a>
        </p>
      </LegalSection>

      <LegalSection title="Données collectées">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>Compte : adresse email, prénom, nom, rôle.</li>
          <li>
            Dossier : réponses au questionnaire, documents déposés et leur historique de versions.
          </li>
          <li>
            Partages : adresse email des destinataires que vous invitez, date de création et de
            révocation des accès.
          </li>
          <li>
            Journal d&apos;activité : connexions, consultations d&apos;un dossier partagé (date,
            adresse IP, navigateur), actions des administrateurs sur votre dossier.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Pourquoi nous les utilisons">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>Vous permettre de constituer et de partager votre dossier (exécution du service).</li>
          <li>
            Vous montrer qui a consulté votre dossier et sécuriser les accès (intérêt légitime :
            traçabilité et prévention des abus).
          </li>
          <li>Vous envoyer les emails nécessaires au service : lien de connexion, invitations.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Qui peut y accéder">
        <p>
          Uniquement les personnes à qui vous avez donné accès, et les administrateurs de la
          plateforme. Chaque intervention d&apos;un administrateur sur votre dossier est
          enregistrée et visible par vous.
        </p>
        <p>
          Nos sous-traitants techniques : l&apos;hébergeur ({LEGAL_INFO.host.name}), le service
          d&apos;envoi d&apos;emails Brevo (France) et le service de stockage des documents.
        </p>
      </LegalSection>

      <LegalSection title="Durée de conservation">
        <p>
          Vos données sont conservées tant que votre compte est actif. À la suppression de votre
          compte, votre dossier, vos documents et vos accès sont supprimés. Le journal des accès
          et des actions peut être conservé jusqu&apos;à un an pour des raisons de sécurité.
        </p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          Nous n&apos;utilisons qu&apos;un seul cookie, strictement nécessaire pour garder votre
          session ouverte. Aucun cookie publicitaire ou de mesure d&apos;audience.
        </p>
      </LegalSection>

      <LegalSection title="Vos droits">
        <p>
          Vous pouvez à tout moment accéder à vos données, les corriger, les exporter ou demander
          leur suppression, en écrivant à{' '}
          <a href={`mailto:${contact}`} className="underline underline-offset-4">
            {contact}
          </a>
          . Vous pouvez aussi saisir la CNIL (
          <a
            href="https://www.cnil.fr"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            cnil.fr
          </a>
          ).
        </p>
      </LegalSection>
    </LegalPage>
  )
}
