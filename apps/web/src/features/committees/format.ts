import { canonicalTimeZone, type Committee } from '@confluent/shared'

// How a committee's moment reads (ROADMAP E08.01): in the committee's own time zone, named, as the
// manager typed it — never converted silently into the reader's zone. The offset is the one the API
// derived (`startsAt`), so the site's own time zone data never contradicts it.

const DAY = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

// « jeudi 10 juin 2027 »
export function committeeDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return DAY.format(new Date(Date.UTC(year, month - 1, day)))
}

// « 14 h 00 »
export const committeeHour = (time: string) => time.replace(':', ' h ')

// « UTC+2 », « UTC−3 », « UTC+5:30 », « UTC »
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return 'UTC'
  const sign = minutes > 0 ? '+' : '−'
  const abs = Math.abs(minutes)
  const hours = Math.floor(abs / 60)
  const rest = abs % 60
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
}

// The offset in force at the committee, from what the API stored.
export function committeeOffset(committee: Pick<Committee, 'date' | 'time' | 'startsAt'>): number {
  const wall = Date.parse(`${committee.date}T${committee.time}:00.000Z`)
  return Math.round((wall - Date.parse(committee.startsAt)) / 60_000)
}

// « Europe/Paris (UTC+2) »
export function committeeZone(
  committee: Pick<Committee, 'date' | 'time' | 'startsAt' | 'timeZone'>,
) {
  return `${committee.timeZone.replace(/_/g, ' ')} (${offsetLabel(committeeOffset(committee))})`
}

// « jeudi 10 juin 2027 à 14 h 00 »
export const committeeWhen = (committee: Pick<Committee, 'date' | 'time'>) =>
  `${committeeDay(committee.date)} à ${committeeHour(committee.time)}`

// The reader's own zone, when the browser names one the IANA way.
export function browserTimeZone(): string | null {
  try {
    return canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  } catch {
    return null
  }
}

// The same instant at the reader's, when their zone is another one: « mercredi 9 juin 2027 à
// 08 h 00 ». Null when the zones are the same or the browser's is unknown.
export function readerWhen(committee: Pick<Committee, 'startsAt' | 'timeZone'>): {
  when: string
  zone: string
} | null {
  const zone = browserTimeZone()
  if (!zone || zone === committee.timeZone) return null
  const instant = new Date(committee.startsAt)
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value
  const day = `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`
  // Same wall clock in both zones (e.g. Paris and Brussels): nothing to add.
  const sameWall = wallClockAt(instant, zone) === wallClockAt(instant, committee.timeZone)
  if (sameWall) return null
  return { when: `${day} à ${part('hour')} h ${part('minute')}`, zone: zone.replace(/_/g, ' ') }
}

function wallClockAt(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).format(instant)
}

// The zones offered first: France and its overseas territories, then neighbours.
export const COMMON_TIME_ZONES = [
  'Europe/Paris',
  'America/Guadeloupe',
  'America/Martinique',
  'America/Cayenne',
  'Indian/Reunion',
  'Indian/Mayotte',
  'America/Miquelon',
  'Pacific/Noumea',
  'Pacific/Tahiti',
  'Pacific/Wallis',
  'Europe/Brussels',
  'Europe/Luxembourg',
  'Europe/Zurich',
  'Europe/London',
  'America/Toronto',
  'Africa/Casablanca',
  'Africa/Dakar',
  'Africa/Abidjan',
  'UTC',
]

// Every IANA zone the browser knows (the API checks again with its own data).
export function otherTimeZones(): string[] {
  let all: string[] = []
  try {
    all = Intl.supportedValuesOf('timeZone')
  } catch {
    all = []
  }
  return all.filter((z) => canonicalTimeZone(z) !== null && !COMMON_TIME_ZONES.includes(z))
}

// Planned and still to come.
export const isUpcoming = (committee: Committee, now: number) =>
  committee.status === 'planned' && Date.parse(committee.startsAt) > now

// A planned committee whose start has passed: to be marked held, or cancelled.
export const isOverdue = (committee: Committee, now: number) =>
  committee.status === 'planned' && Date.parse(committee.startsAt) <= now

export function placeLine(committee: Pick<Committee, 'location' | 'meetingUrl'>): string {
  if (committee.location && committee.meetingUrl) return `${committee.location} · et en ligne`
  if (committee.location) return committee.location
  if (committee.meetingUrl) return 'En ligne'
  return 'Lieu à préciser'
}
