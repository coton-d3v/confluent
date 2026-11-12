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
          <li>
            Applications d&apos;IA connectées : nom de l&apos;application, permissions accordées,
            dates d&apos;autorisation et de dernière utilisation, et journal de ses appels (outil
            utilisé, dossier concerné, résultat).
          </li>
          <li>
            Demandes de participation à un comité, envoyées sans compte depuis le formulaire public
            d&apos;une structure : nom, organisation, adresse email, message et sessions choisies.
          </li>
          <li>
            Demandes d&apos;accès au parcours de candidature d&apos;une structure, envoyées sans
            compte depuis sa page publique : nom, nom de l&apos;entreprise ou du projet, adresse
            email et message.
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
          <li>
            Transmettre vos dossiers aux applications d&apos;IA que vous connectez vous-même, à
            votre demande et dans les limites que vous accordez (exécution du service).
          </li>
          <li>
            Transmettre une demande de participation à un comité à la seule structure concernée, qui
            l&apos;étudie ; aucun compte n&apos;est créé et aucun email n&apos;est envoyé avant
            qu&apos;elle l&apos;accepte (mesures prises à votre demande).
          </li>
          <li>
            Transmettre une demande d&apos;accès au parcours de candidature à la seule structure
            concernée, qui l&apos;étudie ; aucun compte n&apos;est créé et aucun email n&apos;est
            envoyé avant qu&apos;elle l&apos;accepte. Acceptée, elle ouvre un compte de porteur de
            projet à votre adresse (ou garde votre compte existant) et vous invite par email à
            présenter votre demande (mesures prises à votre demande).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Qui peut y accéder">
        <p>
          Uniquement les personnes à qui vous avez donné accès, les applications d&apos;IA que vous
          avez autorisées (voir ci-dessous), et les administrateurs de la plateforme. Chaque
          intervention d&apos;un administrateur sur votre dossier est enregistrée et visible par
          vous.
        </p>
        <p>
          Nos sous-traitants techniques : l&apos;hébergeur ({LEGAL_INFO.host.name}), le service
          d&apos;envoi d&apos;emails Brevo (France) et le service de stockage des documents.
        </p>
      </LegalSection>

      <LegalSection title="Applications d’IA connectées">
        <p>
          Vous pouvez connecter une application d&apos;intelligence artificielle (par exemple Claude
          ou ChatGPT) à votre compte. Rien ne lui est transmis sans votre consentement explicite,
          donné sur un écran de Confluent qui indique l&apos;application et les permissions
          demandées.
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Ce qui lui est transmis : votre profil (email, prénom, nom, rôle), la liste des dossiers
            auxquels vous avez accès, leurs questions et réponses, et leur classification. Pour un
            dossier qui vous est partagé, seulement ce que le niveau du partage vous permet de voir.
            Les documents déposés ne lui sont pas transmis.
          </li>
          <li>
            Ce qu&apos;elle peut faire : lire seulement, ou lire et modifier les réponses de vos
            propres dossiers, selon votre choix. L&apos;autorisation dure au plus 90 jours.
          </li>
          <li>
            L&apos;application est éditée par un tiers, qui traite les informations reçues selon ses
            propres conditions et peut les héberger hors de France ou de l&apos;Union européenne.
            Ce n&apos;est pas un sous-traitant de Confluent : c&apos;est vous qui choisissez de lui
            transmettre vos données.
          </li>
          <li>
            Vous pouvez révoquer une application à tout moment depuis la page « Applications IA ».
            La révocation arrête immédiatement tout nouvel accès ; elle ne supprime pas ce que
            l&apos;application a déjà reçu, qui reste soumis aux conditions de son éditeur.
          </li>
        </ul>
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
