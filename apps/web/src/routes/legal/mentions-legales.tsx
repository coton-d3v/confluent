import { LEGAL_INFO } from '@/features/legal/legal-info'
import { LegalPage, LegalSection } from './LegalPage'

export default function MentionsLegalesRoute() {
  const { publisher, host, founders } = LEGAL_INFO
  return (
    <LegalPage title="Mentions légales">
      <LegalSection title="Qui sommes-nous">
        <p>
          Confluent est une plateforme qui permet aux entreprises innovantes de constituer leur
          dossier une seule fois, puis de le présenter aux structures d&apos;accompagnement et aux
          financeurs de leur choix, en gardant la main sur qui y accède. Les données sont pensées
          pour être lisibles par les outils d&apos;intelligence artificielle que chacun utilise.
        </p>
        <ul className="flex flex-col gap-1">
          {founders.map((f) => (
            <li key={f.name}>
              <span className="font-medium">{f.name}</span> — {f.role}
            </li>
          ))}
        </ul>
      </LegalSection>

      <LegalSection title="Éditeur du site">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Raison sociale</dt>
          <dd>{publisher.name}</dd>
          <dt className="text-muted-foreground">Forme juridique</dt>
          <dd>{publisher.legalForm}</dd>
          <dt className="text-muted-foreground">Immatriculation</dt>
          <dd>{publisher.registration}</dd>
          <dt className="text-muted-foreground">Siège</dt>
          <dd>{publisher.address}</dd>
          <dt className="text-muted-foreground">Contact</dt>
          <dd>
            <a href={`mailto:${publisher.email}`} className="underline underline-offset-4">
              {publisher.email}
            </a>
          </dd>
          <dt className="text-muted-foreground">Directeur de la publication</dt>
          <dd>{publisher.publicationDirector}</dd>
        </dl>
      </LegalSection>

      <LegalSection title="Hébergement">
        <p>
          Le site et les données sont hébergés par {host.name}, {host.address}. Les données sont
          stockées en {host.location}.
        </p>
      </LegalSection>

      <LegalSection title="Propriété intellectuelle">
        <p>
          Les contenus déposés sur la plateforme (réponses, documents) restent la propriété des
          utilisateurs qui les ont déposés. La marque et le logo Confluent, ainsi que ceux des
          structures partenaires, appartiennent à leurs titulaires respectifs.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
