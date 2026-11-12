// A wall-clock date and time in a named IANA time zone (ROADMAP E08.01: a committee « at 14:00,
// Europe/Paris »), turned into the instant it designates — the same rule in the site (immediate
// feedback) and in the API (authoritative, with the time zone data of its runtime).
//
// Around a change of offset (summer time), a wall-clock time can designate no instant (skipped: the
// clocks jump from 02:00 to 03:00) or two (repeated: the clocks go back from 03:00 to 02:00). Both
// are reported, never silently shifted or picked: a committee announced to people in other zones
// must designate exactly one instant.

// A zone named the IANA way (`Europe/Paris`, `America/Argentina/Buenos_Aires`, `Etc/GMT-3`) or
// `UTC`. Fixed offsets (`+01:00`) and legacy abbreviations (`CET`, `EST5EDT`) are refused: they do
// not follow a place's summer time.
export const IANA_TIME_ZONE_PATTERN = /^(?:UTC|[A-Z][A-Za-z_-]+(?:\/[A-Za-z0-9_+-]+){1,2})$/
export const TIME_ZONE_MAX_LENGTH = 64

// What is typed may differ in case (`europe/paris`): the runtime gives the canonical name.
const TYPED_TIME_ZONE_PATTERN = new RegExp(IANA_TIME_ZONE_PATTERN.source, 'i')

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(zone, formatter)
  }
  return formatter
}

// The zone as the runtime names it (`europe/paris` → `Europe/Paris`), or null when it is not an IANA
// zone this runtime knows.
export function canonicalTimeZone(zone: string): string | null {
  if (zone.length > TIME_ZONE_MAX_LENGTH || !TYPED_TIME_ZONE_PATTERN.test(zone)) return null
  let canonical: string
  try {
    canonical = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone
  } catch {
    return null
  }
  return IANA_TIME_ZONE_PATTERN.test(canonical) ? canonical : null
}

// Minutes the zone's clocks are ahead of UTC at this instant (Paris in winter: 60).
export function zoneOffsetMinutes(instantMs: number, zone: string): number {
  const parts = formatterFor(zone).formatToParts(new Date(instantMs))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  )
  return Math.round((wall - Math.floor(instantMs / 1000) * 1000) / 60_000)
}

export type ZonedTimeResolution =
  | { kind: 'exact'; instant: Date }
  | { kind: 'skipped' }
  | { kind: 'repeated'; earlier: Date; later: Date }

const HOUR_MS = 3_600_000

// `date` AAAA-MM-JJ and `time` HH:MM as already validated, `zone` a canonical IANA zone. Every
// candidate instant is the wall time minus an offset the zone uses around it (a day before, at, a
// day after: zones change offset at most once a day), kept when the zone really uses that offset
// at that instant.
export function resolveZonedTime(date: string, time: string, zone: string): ZonedTimeResolution {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const offsets = new Set(
    [wall - 24 * HOUR_MS, wall, wall + 24 * HOUR_MS].map((t) => zoneOffsetMinutes(t, zone)),
  )
  const instants = [...offsets]
    .map((offset) => wall - offset * 60_000)
    .filter((t) => zoneOffsetMinutes(t, zone) === (wall - t) / 60_000)
    .sort((a, b) => a - b)
  if (instants.length === 0) return { kind: 'skipped' }
  if (instants.length === 1) return { kind: 'exact', instant: new Date(instants[0]) }
  return {
    kind: 'repeated',
    earlier: new Date(instants[0]),
    later: new Date(instants[instants.length - 1]),
  }
}
