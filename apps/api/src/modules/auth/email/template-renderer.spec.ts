import { committeeMomentLine, participationSessionLines } from './nodemailer.transport'
import { clearCacheForTesting, render, templateString } from './template-renderer'

describe('template-renderer', () => {
  beforeEach(() => {
    clearCacheForTesting()
  })

  it('renders magic-link with subject + html + text from fr.json + dynamic vars', () => {
    const result = render('magic-link', 'fr', {
      magicLinkUrl: 'https://confluent.example/auth/verify?token=abc',
    })
    expect(result.subject).toBe('Votre lien de connexion Confluent')
    expect(result.html).toContain('https://confluent.example/auth/verify?token=abc')
    expect(result.html).toContain('Votre lien de connexion')
    expect(result.html).toContain('Se connecter')
    expect(result.text).toContain('https://confluent.example/auth/verify?token=abc')
    expect(result.text).not.toContain('<')
  })

  it('renders share-invite with the dossier name', () => {
    const result = render('share-invite', 'fr', {
      dossierName: 'Biosensio',
      shareUrl: 'https://confluent.example/share/xyz',
    })
    expect(result.subject).toBe('Un dossier vous est partagé sur Confluent')
    expect(result.html).toContain('Biosensio')
    expect(result.html).toContain('https://confluent.example/share/xyz')
  })

  it('renders workspace-invite with the workspace, the role and the sign-in page', () => {
    const result = render('workspace-invite', 'fr', {
      workspaceName: 'CCI <Touraine>',
      roleLabel: 'conseiller, gestionnaire du workspace',
      signInUrl: 'https://confluent.example/auth',
    })
    expect(result.subject).toBe('Vous êtes invité à rejoindre un workspace sur Confluent')
    expect(result.html).toContain('CCI &lt;Touraine&gt;')
    expect(result.html).toContain('Votre rôle : conseiller, gestionnaire du workspace')
    expect(result.html).toContain('href="https://confluent.example/auth"')
    expect(result.html).toContain('Se connecter à Confluent')
    expect(result.text).toContain('CCI <Touraine>')
    expect(result.text).toContain('Se connecter à Confluent : https://confluent.example/auth')
  })

  it('renders the offer of a prepared company (E05.08), escaped, with the sentence chosen for the account', () => {
    const vars = {
      companyName: 'Bio<sensio>',
      workspaceName: 'CCI Touraine',
      fromLabel: 'Marie Dupont (marie@cci.fr)',
      expiresOn: '11 décembre 2026',
      invitationsUrl: 'https://confluent.example/dashboard/propositions',
    }
    const created = render('company-transfer-invite', 'fr', {
      ...vars,
      accountLine: templateString('company-transfer-invite', 'fr', 'accountCreated'),
    })
    expect(created.subject).toBe('Une entreprise a été préparée pour vous sur Confluent')
    expect(created.html).toContain('Bio&lt;sensio&gt;')
    expect(created.html).toContain('href="https://confluent.example/dashboard/propositions"')
    expect(created.text).toContain('Préparée par Marie Dupont (marie@cci.fr), pour CCI Touraine.')
    expect(created.text).toContain('Un compte Confluent a été ouvert à cette adresse')
    const existing = render('company-transfer-invite', 'fr', {
      ...vars,
      accountLine: templateString('company-transfer-invite', 'fr', 'accountExisting'),
    })
    expect(existing.text).toContain('rattachée à votre compte Confluent existant')
    expect(() => templateString('company-transfer-invite', 'fr', 'nope')).toThrow(/Missing/)
  })

  it('escapes HTML in dynamic variables (XSS-safe)', () => {
    const result = render('share-invite', 'fr', {
      dossierName: "<script>alert('xss')</script>",
      shareUrl: 'https://confluent.example/share/xyz',
    })
    expect(result.html).not.toContain('<script>alert')
    expect(result.html).toContain('&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;')
  })

  it('does not HTML-escape variables in the text/plain version', () => {
    const result = render('share-invite', 'fr', {
      dossierName: 'A & B Capital',
      shareUrl: 'https://confluent.example/share/xyz',
    })
    expect(result.text).toContain('A & B Capital')
    expect(result.text).not.toContain('&amp;')
  })

  it('renders an accepted participation request (E08.05): the sessions by name and when, escaped, one per line', () => {
    const sessions = participationSessionLines([
      {
        name: 'Comité <juin>',
        date: '2099-06-10',
        time: '14:00',
        timeZone: 'Europe/Paris',
        status: 'planned',
      },
      {
        name: 'Comité de juillet',
        date: '2099-07-10',
        time: '09:30',
        timeZone: 'America/New_York',
        status: 'cancelled',
      },
    ])
    expect(sessions).toBe(
      '• Comité <juin> — mercredi 10 juin 2099 à 14:00 (Europe/Paris)\n' +
        '• Comité de juillet — vendredi 10 juillet 2099 à 09:30 (America/New_York) (annulée)',
    )
    const result = render('participation-accepted', 'fr', {
      workspaceName: 'CCI <Touraine>',
      sessions,
      accountLine: templateString('participation-accepted', 'fr', 'accountCreated'),
      signInUrl: 'https://confluent.example/auth',
    })
    expect(result.subject).toBe('Votre demande de participation a été acceptée')
    expect(result.html).toContain('CCI &lt;Touraine&gt;')
    expect(result.html).toContain('Comité &lt;juin&gt; — mercredi 10 juin 2099 à 14:00')
    expect(result.html).toContain('white-space:pre-line;')
    expect(result.html).toContain('href="https://confluent.example/auth"')
    expect(result.html).toContain('comme investisseur')
    expect(result.text).toContain('• Comité de juillet — vendredi 10 juillet 2099 à 09:30')
    expect(result.text).toContain('Se connecter à Confluent : https://confluent.example/auth')
    for (const key of ['membershipCreated', 'alreadyMember']) {
      expect(templateString('participation-accepted', 'fr', key)).toMatch(/workspace/)
    }
  })

  it('renders a committee change (E08.06): the committee by name and when, escaped, the previous date on its own line', () => {
    expect(
      committeeMomentLine({ date: '2099-06-11', time: '09:30', timeZone: 'Europe/Paris' }),
    ).toBe('jeudi 11 juin 2099 à 09:30 (Europe/Paris)')
    const result = render('committee-changed', 'fr', {
      title: templateString('committee-changed', 'fr', 'titleRescheduled'),
      body: templateString('committee-changed', 'fr', 'bodyRescheduled'),
      workspaceName: 'CCI <Touraine>',
      committeeName: 'Comité <juin>',
      when: 'Nouvelle date : jeudi 11 juin 2099 à 09:30 (Europe/Paris)\nDate précédente : mercredi 10 juin 2099 à 14:00 (Europe/Paris)',
      audienceLine: templateString('committee-changed', 'fr', 'participantLine'),
      signInUrl: 'https://confluent.example/auth',
    })
    expect(result.html).toContain('CCI &lt;Touraine&gt;')
    expect(result.html).toContain('Comité &lt;juin&gt;')
    expect(result.html).toContain('white-space:pre-line;')
    expect(result.html).toContain('href="https://confluent.example/auth"')
    expect(result.text).toContain('Nouvelle date pour un comité')
    expect(result.text).toContain('Date précédente : mercredi 10 juin 2099 à 14:00')
    expect(result.text).toContain('Se connecter à Confluent : https://confluent.example/auth')
    for (const kind of ['Rescheduled', 'Cancelled', 'Restored']) {
      for (const key of ['subject', 'title', 'body', 'when']) {
        expect(templateString('committee-changed', 'fr', `${key}${kind}`)).not.toBe('')
      }
    }
    expect(templateString('committee-changed', 'fr', 'entrepreneurLine')).toContain('demande')
  })

  it('throws an explicit error when a referenced variable is missing', () => {
    const renderWithMissingVar = () => {
      // Force a fake template by clearing & calling with an invalid combination.
      // We rely on actual missing keys: use the real templates but break the i18n file? Simpler:
      // call render() with a template name and an empty vars object — TypeScript prevents this
      // at compile-time, so we cast to bypass.
      return render(
        'magic-link',
        'fr',
        // intentionally missing magicLinkUrl
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
      )
    }
    expect(renderWithMissingVar).toThrow(/Missing email template variable: \{\{magicLinkUrl\}\}/)
  })
})
