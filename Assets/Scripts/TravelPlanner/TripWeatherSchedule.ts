/**
 * Departure / stay / return weather for packing.
 * Live AccuWeather covers about five days at the measured city.
 * Other cities and later dates use a seasonal note, not a made-up daily number.
 */

import { TripDraft } from './TripTypes'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const TYPICAL = [
  'cold, often near freezing — coat and warm layers',
  'cold to chilly — coat',
  'cool and changeable — jacket',
  'mild — light jacket',
  'mild to warm — layers you can remove',
  'warm — breathable clothes',
  'hot — light clothes, sun protection',
  'hot — light clothes, sun protection',
  'warm, cooling at night — light layer',
  'mild and changeable — light jacket',
  'cool — jacket',
  'cold — coat and warm layers',
]

export function buildTripWeatherSchedule(
  draft: TripDraft | null,
  homeCity: string,
  measuredDays: string[],
): string {
  const home = homeCity && homeCity.trim().length > 0 ? homeCity.trim() : 'here'
  const from = draft && draft.departureCity.trim().length > 0 ? draft.departureCity.trim() : home
  const to = draft && draft.destinationCity.trim().length > 0 ? draft.destinationCity.trim() : ''
  const depart = draft ? draft.departureDateTime.trim() : ''
  const ret = draft ? draft.arrivalDateTime.trim() : ''

  if (!draft || (from.length === 0 && to.length === 0 && depart.length === 0)) {
    const now = measuredDays.length > 0 ? measuredDays[0] : 'Forecast loading'
    return `${home}\n${now}`
  }

  const lines: string[] = []
  lines.push(`Depart ${depart.length > 0 ? depart : '—'} · ${from}`)
  lines.push(lineFor(from, home, depart, measuredDays))
  if (to.length > 0) {
    lines.push(`Stay · ${to}`)
    lines.push(stayLine(to, home, depart, ret, measuredDays))
  }
  lines.push(`Return ${ret.length > 0 ? ret : '—'} · ${from}`)
  lines.push(lineFor(from, home, ret, measuredDays))
  return lines.join('\n')
}

export function buildWhatToPack(draft: TripDraft | null, schedule: string): string {
  const purpose = draft && draft.purpose ? draft.purpose : 'leisure'
  const flying = isLikelyFlight(draft)
  const lines: string[] = ['What to pack']
  if (purpose === 'business') {
    lines.push('• One smart layer you can wear off the transport and into meetings.')
  } else if (purpose === 'bleisure') {
    lines.push('• Work outfit for the first days, then lighter clothes for the rest.')
  } else {
    lines.push('• Comfortable clothes you can walk in.')
  }
  if (flying) {
    lines.push('• Cabin runs cold. Pack a hoodie or light sweater in the personal item, even in summer.')
    lines.push('• Keep liquids and a spare layer in the cabin bag, not only in checked luggage.')
  } else if (draft && draft.skipLongDistanceTransport) {
    lines.push('• Local trip: a smaller bag is enough. Skip a bulky checked case.')
  } else {
    lines.push('• If this is a train or car, a soft layer on top is easier than a packed coat.')
  }
  const lower = schedule.toLowerCase()
  if (lower.indexOf('rain') >= 0 || lower.indexOf('shower') >= 0 || lower.indexOf('storm') >= 0) {
    lines.push('• A light rain shell. The forecast mentions wet weather.')
  }
  if (lower.indexOf('hot') >= 0 || lower.indexOf('warm') >= 0) {
    lines.push('• Breathable fabrics for the warm days. Keep the extra layer for the ride.')
  }
  if (lower.indexOf('cold') >= 0 || lower.indexOf('freezing') >= 0 || lower.indexOf('coat') >= 0) {
    lines.push('• A real coat for the cold end of the trip, including the day you fly home.')
  }
  lines.push('• Documents, charger, and any medicine in the bag you keep with you.')
  return lines.join('\n')
}

function lineFor(city: string, home: string, dateText: string, measuredDays: string[]): string {
  if (!samePlace(city, home)) {
    return typicalLine(city, dateText)
  }
  const offset = daysFromToday(dateText)
  if (offset != null && offset >= 0 && offset < measuredDays.length && measuredDays[offset]) {
    return measuredDays[offset]
  }
  return typicalLine(city, dateText)
}

function stayLine(city: string, home: string, depart: string, ret: string, measuredDays: string[]): string {
  if (samePlace(city, home)) {
    const start = daysFromToday(depart)
    const end = daysFromToday(ret)
    if (start != null && end != null && start >= 0 && end < measuredDays.length) {
      const bits: string[] = []
      const last = Math.min(end, measuredDays.length - 1)
      for (let i = Math.max(0, start); i <= last && bits.length < 3; i++) {
        if (measuredDays[i]) {
          bits.push(measuredDays[i])
        }
      }
      if (bits.length > 0) {
        return bits.join(' · ')
      }
    }
  }
  return typicalLine(city, depart.length > 0 ? depart : ret)
}

function typicalLine(city: string, dateText: string): string {
  const month = monthIndexFrom(dateText)
  const name = month != null ? MONTHS[month] : 'that month'
  const band = month != null ? TYPICAL[month] : 'seasonal layers — check a forecast closer to departure'
  return `Typical ${name} in ${city}: ${band}. Live forecast covers about 5 days at your current city only.`
}

function monthIndexFrom(dateText: string): number | null {
  const m = dateText.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) {
    return null
  }
  const month = parseInt(m[2], 10) - 1
  if (month < 0 || month > 11) {
    return null
  }
  return month
}

function daysFromToday(dateText: string): number | null {
  const m = dateText.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) {
    return null
  }
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10) - 1
  const year = parseInt(m[3], 10)
  const target = new Date(year, month, day)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function samePlace(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function isLikelyFlight(draft: TripDraft | null): boolean {
  if (!draft) {
    return false
  }
  if (draft.skipLongDistanceTransport) {
    return false
  }
  if (draft.departureCity.trim().length > 0 && draft.destinationCity.trim().length > 0) {
    if (draft.departureCity.trim().toLowerCase() !== draft.destinationCity.trim().toLowerCase()) {
      return true
    }
  }
  const notes = (draft.voicePreferenceNotes || '').toLowerCase()
  return notes.indexOf('flight') >= 0 || notes.indexOf('plane') >= 0 || notes.indexOf('fly') >= 0
}
