import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COMMITTEE_LIMITS,
  COMMITTEE_SHARED_FIELDS,
  COMMITTEE_STATUSES,
  COMMITTEE_STATUS_TRANSITIONS,
  canChangeCommitteeStatus,
  canReadCommittees,
  canonicalTimeZone,
  changeCommitteeStatusSchema,
  committeeStatusOf,
  createCommitteeSchema,
  normalizeMeetingUrl,
  resolveZonedTime,
  sharedCommitteeSchema,
  toSharedCommittee,
  updateCommitteeSchema,
  zoneOffsetMinutes,
  type Committee,
} from '@confluent/shared'

const exact = (date: string, time: string, zone: string) => {
  const resolved = resolveZonedTime(date, time, zone)
  if (resolved.kind !== 'exact') throw new Error(`${date} ${time} ${zone}: ${resolved.kind}`)
  return resolved.instant.toISOString()
}

const VALID = {
  name: 'Comité de juin',
  date: '2027-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
}

const messages = (result: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
  result.success ? [] : result.error!.issues.map((i) => i.message)

// ROADMAP E08.01: the rules of a committee shared by the site and the API — when (a wall-clock time
// in a named zone, exactly one instant), its fields, its statuses and who reads it.
describe('committee rules', () => {
  describe('time zones', () => {
    it('turns a wall-clock time into the instant it designates, with the offset in force that day', () => {
      // Paris: UTC+1 in winter, UTC+2 in summer — the same 14:00 is not the same UTC hour.
      expect(exact('2027-01-15', '14:00', 'Europe/Paris')).toBe('2027-01-15T13:00:00.000Z')
      expect(exact('2027-07-15', '14:00', 'Europe/Paris')).toBe('2027-07-15T12:00:00.000Z')
      expect(exact('2027-01-15', '14:00', 'UTC')).toBe('2027-01-15T14:00:00.000Z')
      // Overseas France and zones without summer time.
      expect(exact('2027-01-15', '14:00', 'Indian/Reunion')).toBe('2027-01-15T10:00:00.000Z')
      expect(exact('2027-01-15', '14:00', 'America/Cayenne')).toBe('2027-01-15T17:00:00.000Z')
      expect(exact('2027-01-15', '14:00', 'Pacific/Noumea')).toBe('2027-01-15T03:00:00.000Z')
      expect(exact('2027-01-15', '14:00', 'Asia/Kolkata')).toBe('2027-01-15T08:30:00.000Z')
      expect(exact('2027-03-28', '02:30', 'Asia/Tokyo')).toBe('2027-03-27T17:30:00.000Z')
      // The extremes, across the date line: UTC+14 and UTC−12.
      expect(exact('2027-01-01', '00:00', 'Pacific/Kiritimati')).toBe('2026-12-31T10:00:00.000Z')
      expect(exact('2027-01-01', '00:00', 'Etc/GMT+12')).toBe('2027-01-01T12:00:00.000Z')
      // Southern hemisphere: summer time in January.
      expect(exact('2027-01-15', '14:00', 'Australia/Sydney')).toBe('2027-01-15T03:00:00.000Z')
      expect(exact('2027-07-15', '14:00', 'Australia/Sydney')).toBe('2027-07-15T04:00:00.000Z')
      expect(zoneOffsetMinutes(Date.parse('2027-07-15T12:00:00Z'), 'Europe/Paris')).toBe(120)
    })

    it('reports a time skipped by the start of summer time, never shifting it', () => {
      for (const [date, time, zone] of [
        ['2027-03-28', '02:00', 'Europe/Paris'],
        ['2027-03-28', '02:30', 'Europe/Paris'],
        ['2027-03-28', '02:59', 'Europe/Paris'],
        ['2027-03-14', '02:30', 'America/New_York'],
        ['2026-10-04', '02:30', 'Australia/Sydney'],
        // Lord Howe moves by half an hour.
        ['2026-10-04', '02:15', 'Australia/Lord_Howe'],
      ]) {
        expect([date, time, zone, resolveZonedTime(date, time, zone).kind]).toEqual([
          date,
          time,
          zone,
          'skipped',
        ])
      }
      // The minutes around the gap exist.
      expect(exact('2027-03-28', '01:59', 'Europe/Paris')).toBe('2027-03-28T00:59:00.000Z')
      expect(exact('2027-03-28', '03:00', 'Europe/Paris')).toBe('2027-03-28T01:00:00.000Z')
    })

    it('reports a time repeated by the end of summer time, with both instants, never picking one', () => {
      expect(resolveZonedTime('2026-10-25', '02:30', 'Europe/Paris')).toEqual({
        kind: 'repeated',
        earlier: new Date('2026-10-25T00:30:00.000Z'),
        later: new Date('2026-10-25T01:30:00.000Z'),
      })
      expect(resolveZonedTime('2026-10-25', '02:00', 'Europe/Paris').kind).toBe('repeated')
      expect(resolveZonedTime('2026-11-01', '01:30', 'America/New_York')).toEqual({
        kind: 'repeated',
        earlier: new Date('2026-11-01T05:30:00.000Z'),
        later: new Date('2026-11-01T06:30:00.000Z'),
      })
      expect(resolveZonedTime('2027-04-04', '02:30', 'Australia/Sydney').kind).toBe('repeated')
      expect(resolveZonedTime('2027-04-04', '01:45', 'Australia/Lord_Howe').kind).toBe('repeated')
      // The minutes around it designate one instant.
      expect(exact('2026-10-25', '01:59', 'Europe/Paris')).toBe('2026-10-24T23:59:00.000Z')
      expect(exact('2026-10-25', '03:00', 'Europe/Paris')).toBe('2026-10-25T02:00:00.000Z')
    })

    it('accepts IANA zones only, under the runtime’s canonical name', () => {
      expect(canonicalTimeZone('Europe/Paris')).toBe('Europe/Paris')
      expect(canonicalTimeZone('europe/paris')).toBe('Europe/Paris')
      expect(canonicalTimeZone('utc')).toBe('UTC')
      // Three segments; the runtime may prefer an older alias (`America/Buenos_Aires`).
      expect(canonicalTimeZone('America/Argentina/Ushuaia')).toBe('America/Argentina/Ushuaia')
      expect(canonicalTimeZone('America/Argentina/Buenos_Aires')).toMatch(/^America\//)
      expect(canonicalTimeZone('Etc/GMT-3')).toBe('Etc/GMT-3')
      // Fixed offsets, abbreviations, unknown places, paths and oversized names: refused, even when
      // the runtime would accept them (it reads `CET` as Brussels, `+01:00` as a fixed offset).
      for (const zone of [
        '',
        '+01:00',
        'UTC+1',
        'CET',
        'GMT',
        'EST5EDT',
        'Paris',
        'Mars/Olympus_Mons',
        'Europe/Paris ',
        'Europe/../Paris',
        'Europe/Paris/Nord',
        `Europe/${'P'.repeat(64)}`,
        '<script>',
      ]) {
        expect([zone, canonicalTimeZone(zone)]).toEqual([zone, null])
      }
    })
  })

  describe('fields', () => {
    it('accepts a committee as a manager types it, trimmed, with optional place, link and information', () => {
      const parsed = createCommitteeSchema.parse({
        name: '  Comité   de juin ',
        date: '2027-06-10',
        time: '09:05',
        timeZone: 'europe/paris',
        location: ' CCI Touraine,   salle 2 ',
        meetingUrl: ' https://Visio.Example.org/j/123?pwd=abc ',
        internalNotes: '  Ordre du jour :\r\n\r\n\r\n1. Pitchs  \n2. Délibération ',
      })
      expect(parsed).toEqual({
        name: 'Comité de juin',
        date: '2027-06-10',
        time: '09:05',
        timeZone: 'Europe/Paris',
        location: 'CCI Touraine, salle 2',
        meetingUrl: 'https://visio.example.org/j/123?pwd=abc',
        internalNotes: 'Ordre du jour :\n\n1. Pitchs\n2. Délibération',
      })
      expect(
        createCommitteeSchema.parse({
          ...VALID,
          location: ' ',
          meetingUrl: '',
          internalNotes: '',
          sharedInfo: ' \n ',
        }),
      ).toEqual({
        ...VALID,
        location: null,
        meetingUrl: null,
        internalNotes: null,
        sharedInfo: null,
      })
      // The shared information: plain paragraphs, like the notes, and apart from them.
      expect(
        createCommitteeSchema.parse({
          ...VALID,
          internalNotes: 'Dossier Biosensio fragile',
          sharedInfo: '  Accueil à 13 h 45 :\r\n\r\n\r\n10 min   de pitch ',
        }),
      ).toEqual({
        ...VALID,
        internalNotes: 'Dossier Biosensio fragile',
        sharedInfo: 'Accueil à 13 h 45 :\n\n10 min de pitch',
      })
      expect(createCommitteeSchema.parse(VALID)).toEqual(VALID)
    })

    it('refuses what is not a committee', () => {
      const refused = (input: Record<string, unknown>) =>
        expect([input, createCommitteeSchema.safeParse({ ...VALID, ...input }).success]).toEqual([
          input,
          false,
        ])
      for (const input of [
        { name: '' },
        { name: '   ' },
        { name: 'x'.repeat(COMMITTEE_LIMITS.name + 1) },
        { name: undefined },
        { date: '2027-02-30' },
        { date: '10/06/2027' },
        { date: '1999-12-31' },
        { date: '2100-01-01' },
        { time: '24:00' },
        { time: '9:00' },
        { time: '14:00:00' },
        { time: '14h00' },
        { timeZone: '+02:00' },
        { timeZone: 'CET' },
        { timeZone: 'Atlantis/Capital' },
        { timeZone: undefined },
        { location: 'x'.repeat(COMMITTEE_LIMITS.location + 1) },
        { meetingUrl: 'http://visio.example.org/j/1' },
        { meetingUrl: 'javascript:alert(1)' },
        { meetingUrl: 'https://user:pass@visio.example.org/' },
        { meetingUrl: 'https://visio.example.org/a b' },
        { meetingUrl: 'https://localhost/room' },
        { meetingUrl: 'visio.example.org/j/1' },
        { meetingUrl: `https://visio.example.org/${'a'.repeat(COMMITTEE_LIMITS.meetingUrl)}` },
        { internalNotes: 'Voir <b>ceci</b>' },
        { internalNotes: 'x'.repeat(COMMITTEE_LIMITS.internalNotes + 1) },
        { sharedInfo: 'Voir <a href="x">ceci</a>' },
        { sharedInfo: 'x'.repeat(COMMITTEE_LIMITS.sharedInfo + 1) },
        { sharedInfo: 12 },
        { status: 'held' },
        { workspaceId: 'x' },
      ]) {
        refused(input)
      }
      expect(normalizeMeetingUrl('https://meet.example.org/abc-def')).toBe(
        'https://meet.example.org/abc-def',
      )
    })

    it('refuses a time skipped or repeated in its zone, on the time, saying why', () => {
      const skipped = createCommitteeSchema.safeParse({
        ...VALID,
        date: '2027-03-28',
        time: '02:30',
      })
      expect(skipped.success).toBe(false)
      expect(skipped.error!.issues).toEqual([
        expect.objectContaining({
          path: ['time'],
          message: expect.stringContaining('passage à l’heure d’été'),
        }),
      ])
      const repeated = updateCommitteeSchema.safeParse({
        ...VALID,
        date: '2026-10-25',
        time: '02:30',
        version: 1,
      })
      expect(messages(repeated)).toEqual([expect.stringContaining('retour à l’heure d’hiver')])
      // The same wall-clock time in a zone without summer time is fine.
      expect(
        createCommitteeSchema.safeParse({
          ...VALID,
          date: '2027-03-28',
          time: '02:30',
          timeZone: 'Asia/Tokyo',
        }).success,
      ).toBe(true)
      // An invalid part reports its own issue, without a schedule issue on top.
      expect(messages(createCommitteeSchema.safeParse({ ...VALID, date: '2027-02-30' }))).toEqual([
        'Indiquez une date valide (AAAA-MM-JJ).',
      ])
    })

    it('edits from a version and changes a status from a version', () => {
      expect(updateCommitteeSchema.safeParse(VALID).success).toBe(false)
      expect(updateCommitteeSchema.safeParse({ ...VALID, version: 0 }).success).toBe(false)
      expect(updateCommitteeSchema.parse({ ...VALID, version: 3 })).toEqual({
        ...VALID,
        version: 3,
      })
      // Absent shared information stays absent (kept by the API); null or blank removes it.
      expect('sharedInfo' in updateCommitteeSchema.parse({ ...VALID, version: 3 })).toBe(false)
      expect(updateCommitteeSchema.parse({ ...VALID, sharedInfo: null, version: 3 })).toEqual({
        ...VALID,
        sharedInfo: null,
        version: 3,
      })
      expect(updateCommitteeSchema.parse({ ...VALID, sharedInfo: '', version: 3 })).toEqual({
        ...VALID,
        sharedInfo: null,
        version: 3,
      })
      expect(changeCommitteeStatusSchema.safeParse({ status: 'cancelled' }).success).toBe(false)
      expect(changeCommitteeStatusSchema.safeParse({ status: 'deleted', version: 1 }).success).toBe(
        false,
      )
      expect(changeCommitteeStatusSchema.parse({ status: 'held', version: 2 })).toEqual({
        status: 'held',
        version: 2,
      })
    })
  })

  describe('statuses', () => {
    it('cancels or holds a planned committee, and puts a cancelled or held one back to planned only', () => {
      const allowed = COMMITTEE_STATUSES.flatMap((from) =>
        COMMITTEE_STATUSES.filter((to) => canChangeCommitteeStatus(from, to)).map(
          (to) => `${from}→${to}`,
        ),
      )
      expect(allowed).toEqual([
        'planned→held',
        'planned→cancelled',
        'held→planned',
        'cancelled→planned',
      ])
      expect(canChangeCommitteeStatus('archived', 'planned')).toBe(false)
      expect(committeeStatusOf('archived')).toBe('cancelled')
      expect(Object.keys(COMMITTEE_STATUS_TRANSITIONS)).toEqual([...COMMITTEE_STATUSES])
    })

    it('keeps the migration’s CHECK equal to the closed statuses and limits', () => {
      const sql = readFileSync(
        join(__dirname, '../../../prisma/migrations/20261201000000_committees/migration.sql'),
        'utf8',
      )
      expect(sql).toContain(`"status" IN (${COMMITTEE_STATUSES.map((s) => `'${s}'`).join(', ')})`)
      expect(sql).toContain(`char_length("name") BETWEEN 1 AND ${COMMITTEE_LIMITS.name}`)
      expect(sql).toContain(`char_length("location") BETWEEN 1 AND ${COMMITTEE_LIMITS.location}`)
      expect(sql).toContain(`char_length("meeting_url") <= ${COMMITTEE_LIMITS.meetingUrl}`)
      expect(sql).toContain(
        `char_length("internal_notes") BETWEEN 1 AND ${COMMITTEE_LIMITS.internalNotes}`,
      )
      expect(sql).toContain(`TIMESTAMP '${COMMITTEE_LIMITS.firstYear}-01-01 00:00:00'`)
      expect(sql).toContain(`TIMESTAMP '${COMMITTEE_LIMITS.lastYear + 1}-01-01 00:00:00'`)
      const shared = readFileSync(
        join(
          __dirname,
          '../../../prisma/migrations/20261202000000_committee_shared_info/migration.sql',
        ),
        'utf8',
      )
      expect(shared).toContain(
        `char_length("shared_info") BETWEEN 1 AND ${COMMITTEE_LIMITS.sharedInfo}`,
      )
    })
  })

  describe('shared view (E08.02)', () => {
    const COMMITTEE: Committee = {
      id: '6f1c2a8e-0000-4000-8000-000000000001',
      workspaceId: '6f1c2a8e-0000-4000-8000-000000000002',
      name: 'Comité de juin',
      date: '2027-06-10',
      time: '14:00',
      timeZone: 'Europe/Paris',
      startsAt: '2027-06-10T12:00:00.000Z',
      location: 'CCI Touraine, salle 2',
      meetingUrl: 'https://visio.example.org/j/123',
      status: 'planned',
      internalNotes: 'NOTE-INTERNE Biosensio : trésorerie fragile',
      sharedInfo: 'Accueil à 13 h 45, 10 minutes de pitch.',
      participationRequestsOpen: true,
      version: 7,
      createdAt: '2027-01-02T03:04:05.000Z',
      updatedAt: '2027-02-03T04:05:06.000Z',
    }

    it('gives candidates and investors the name, when, where, status and shared information — never the internal notes', () => {
      const shared = toSharedCommittee(COMMITTEE)
      expect(shared).toEqual({
        id: COMMITTEE.id,
        name: 'Comité de juin',
        date: '2027-06-10',
        time: '14:00',
        timeZone: 'Europe/Paris',
        startsAt: '2027-06-10T12:00:00.000Z',
        location: 'CCI Touraine, salle 2',
        meetingUrl: 'https://visio.example.org/j/123',
        status: 'planned',
        sharedInfo: 'Accueil à 13 h 45, 10 minutes de pitch.',
      })
      expect(JSON.stringify(shared)).not.toContain('NOTE-INTERNE')
      expect(Object.keys(shared)).toEqual([...COMMITTEE_SHARED_FIELDS])
      expect(sharedCommitteeSchema.parse(shared)).toEqual(shared)
    })

    it('copies named fields only: whatever else a committee holds stays out, and the contract refuses it', () => {
      const widened = { ...COMMITTEE, juryNotes: 'NOTE-JURY', scores: [12, 15] }
      expect(JSON.stringify(toSharedCommittee(widened))).not.toMatch(/NOTE-|scores/)
      for (const extra of [
        { internalNotes: 'x' },
        { version: 1 },
        { workspaceId: COMMITTEE.workspaceId },
        { createdAt: COMMITTEE.createdAt },
      ]) {
        expect(
          sharedCommitteeSchema.safeParse({ ...toSharedCommittee(COMMITTEE), ...extra }).success,
        ).toBe(false)
      }
      expect(COMMITTEE_SHARED_FIELDS).not.toContain('internalNotes')
    })
  })

  describe('readers', () => {
    it('lets the workspace’s conseillers and Confluent administrators read its committees, nobody else', () => {
      expect(canReadCommittees({ role: 'admin' }, null)).toBe(true)
      expect(canReadCommittees({ role: 'financeur' }, { role: 'conseiller' })).toBe(true)
      expect(canReadCommittees({ role: 'financeur' }, { role: 'investisseur' })).toBe(false)
      expect(canReadCommittees({ role: 'financeur' }, { role: 'observateur' })).toBe(false)
      expect(canReadCommittees({ role: 'entrepreneur' }, null)).toBe(false)
      expect(canReadCommittees({ role: 'financeur' }, null)).toBe(false)
    })
  })
})
