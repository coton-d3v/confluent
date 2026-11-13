import { Link } from 'react-router-dom'
import { OAUTH_SCOPE_LABELS, OAUTH_SCOPES, RETENTION_RULES } from '@confluent/shared'
import { LEGAL_INFO } from '@/features/legal/legal-info'
import { LegalPage, LegalSection } from './LegalPage'

// E10.10: what each permission an AI application may be granted lets it read or do — the words of
// the consent screen.
const AI_PERMISSIONS = Object.values(OAUTH_SCOPES).map((scope) => OAUTH_SCOPE_LABELS[scope] ?? scope)

export default function ConfidentialiteRoute() {
  const contact = LEGAL_INFO.privacyContact
  return (
    <LegalPage title="Politique de confidentialité" updated="13 novembre 2026">
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
            adresse IP, navigateur), actions des administrateurs sur votre dossier, exports de vos
            données et demandes de suppression de compte.
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

      <LegalSection title="Applications d’IA connectées" id="applications-ia">
        <p>
          Vous pouvez connecter une application d&apos;intelligence artificielle (par exemple Claude
          ou ChatGPT) à votre compte. Rien ne lui est transmis sans votre consentement explicite,
          donné sur un écran de Confluent qui indique l&apos;application, si son identité est
          vérifiée ou seulement déclarée, le compte pour lequel elle agira, chaque permission
          demandée et la durée de l&apos;autorisation.
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Ce qui lui est transmis dépend des permissions que vous cochez, et toujours de vos
            droits : jamais plus que ce que le site vous montre. Pour une demande qui vous est
            partagée, seulement ce que le niveau du partage vous permet de voir. Avec la lecture de
            vos dossiers, le texte des documents déposés lui est transmis.
          </li>
          <li>
            L&apos;autorisation dure au plus 90 jours ; chaque accès vaut une heure et se renouvelle
            pendant 30 jours sans nouvel usage. Les permissions qui agissent en votre nom
            (soumettre, publier, partager, vous positionner…) ne sont jamais cochées d&apos;avance.
          </li>
          <li>
            L&apos;application est éditée par un tiers, qui traite les informations reçues selon ses
            propres conditions et peut les héberger hors de France ou de l&apos;Union européenne.
            Ce n&apos;est pas un sous-traitant de Confluent : c&apos;est vous qui choisissez de lui
            transmettre vos données.
          </li>
          <li>
            La page « Applications IA » montre ce que chaque application peut voir et sa dernière
            action. Vous pouvez la révoquer à tout moment : ses accès sont coupés immédiatement ;
            ce qu&apos;elle a déjà reçu reste soumis aux conditions de son éditeur.
          </li>
        </ul>
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer font-medium">
            Chaque permission, telle que l&apos;écran de consentement la décrit
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
            {AI_PERMISSIONS.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </details>
      </LegalSection>

      <LegalSection title="Durée de conservation" id="conservation">
        <ul className="flex flex-col gap-2">
          {RETENTION_RULES.map((r) => (
            <li key={r.data}>
              <span className="font-medium">{r.data} : </span>
              {r.rule}
            </li>
          ))}
        </ul>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          Nous n&apos;utilisons qu&apos;un seul cookie, strictement nécessaire pour garder votre
          session ouverte. Aucun cookie publicitaire ou de mesure d&apos;audience.
        </p>
      </LegalSection>

      <LegalSection title="Vos droits" id="vos-droits">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Accès et export : depuis{' '}
            <Link to="/compte" className="underline underline-offset-4">
              Mes données
            </Link>
            , téléchargez un fichier contenant votre compte, vos entreprises, demandes, réponses,
            partages, positionnements, notifications, applications connectées et votre propre
            activité (5 fois par heure au plus).
          </li>
          <li>Rectification : depuis votre profil et vos demandes, ou en nous écrivant.</li>
          <li>
            Suppression : depuis Mes données, demandez la suppression de votre compte ; un
            administrateur la traite. Elle n&apos;est faite que lorsque plus aucune de vos demandes
            n&apos;est partagée ni présentée à une structure (la page indique quoi retirer). Votre
            compte et tout ce qu&apos;il détient sont alors supprimés ; le journal garde la trace des
            actions passées sans plus vous nommer, et les structures conservent les notes et
            décisions qu&apos;elles ont prises. Un email vous le confirme.
          </li>
        </ul>
        <p>
          Pour toute autre demande, écrivez à{' '}
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
