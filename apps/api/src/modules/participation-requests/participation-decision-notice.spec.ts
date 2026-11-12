import { participationDecisionNotice } from '@confluent/shared'

// Code review R68: what a manager is told never announces an email that did not leave — in
// particular for an acceptance repeated from a stale screen after the first attempt failed.
describe('participationDecisionNotice', () => {
  const answer = (
    invitationEmailSent: boolean | null,
    invitationEmail: 'to_send' | 'sent' | 'failed' | null,
  ) => ({ invitationEmailSent, request: { invitationEmail } })

  it('says what this acceptance did with the email', () => {
    expect(participationDecisionNotice('Diane', 'accepted', answer(true, 'sent'))).toEqual({
      tone: 'success',
      text: 'Demande de Diane acceptée : la personne est prévenue par email.',
    })
    expect(participationDecisionNotice('Diane', 'accepted', answer(false, 'failed'))).toMatchObject(
      {
        tone: 'warning',
        text: expect.stringContaining('l’email n’a pas pu partir'),
      },
    )
  })

  it('reads the recorded email for an acceptance already taken, never claiming one was sent', () => {
    const failed = participationDecisionNotice('Diane', 'accepted', answer(null, 'failed'))
    expect(failed.tone).toBe('warning')
    expect(failed.text).toContain('était déjà acceptée')
    expect(failed.text).toContain('l’email n’a pas pu partir')
    expect(failed.text).not.toContain('est prévenue')
    const pending = participationDecisionNotice('Diane', 'accepted', answer(null, 'to_send'))
    expect(pending).toEqual({
      tone: 'info',
      text: 'La demande de Diane était déjà acceptée ; l’envoi de l’email n’est pas confirmé.',
    })
    expect(participationDecisionNotice('Diane', 'accepted', answer(null, null)).text).not.toMatch(
      /prévenue/,
    )
    expect(participationDecisionNotice('Diane', 'accepted', answer(null, 'sent'))).toEqual({
      tone: 'info',
      text: 'La demande de Diane était déjà acceptée ; la personne a été prévenue par email.',
    })
  })

  it('announces a refusal without any email', () => {
    expect(participationDecisionNotice('Diane', 'refused', answer(null, null))).toEqual({
      tone: 'success',
      text: 'Demande de Diane refusée.',
    })
  })
})
