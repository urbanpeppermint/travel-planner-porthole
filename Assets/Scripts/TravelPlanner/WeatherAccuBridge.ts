/**
 * AccuWeather via the official **Weather API - AccuWeather** Remote Service Module (same endpoints as
 * `AccuweatherAPI.js`: `current_condition_and_forecast`, etc.). Wire **`Accuweather.remoteServiceModule`**
 * from the imported asset — not the Gemini / Imagen RSM.
 *
 * @see https://developers.snap.com/lens-studio/features/remote-apis/remote-apis-templates/weather-api#weather-api---accuweather-asset
 */
import { TripDraft } from './TripTypes'
import { buildTripWeatherSchedule, buildWhatToPack } from './TripWeatherSchedule'

@component
export class WeatherAccuBridge extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint('Drag Accuweather.remoteServiceModule from Weather - AccuWeather API package.')
  accuWeatherRemoteModule: RemoteServiceModule

  @input
  @allowUndefined
  @hint('Text to update with current + short forecast summary.')
  weatherSummaryText: Text

  @input
  @hint('Default latitude when no device location (e.g. Berlin).')
  defaultLatitude: string = '52.5200'

  @input
  @hint('Default longitude when no device location.')
  defaultLongitude: string = '13.4050'

  @input
  @hint('Call AccuWeather on scene start. Leave off — TripOptic does not use the weather API.')
  fetchOnStart: boolean = false

  private lastSummary: string = ''
  /** Index 0 is today at the measured city. Later slots are the next forecast days. */
  private measuredDays: string[] = []
  private homeCity: string = 'Here'
  private draft: TripDraft | null = null
  private detailsOpen: boolean = false
  private packOpen: boolean = false

  setHomeCity(city: string): void {
    this.homeCity = city && city.trim().length > 0 ? city.trim() : 'Here'
    this.applyWeatherText()
  }

  setTripDraft(draft: TripDraft | null): void {
    this.draft = draft
    this.applyWeatherText()
  }

  setDetailsOpen(open: boolean): void {
    this.detailsOpen = open
    if (!open) {
      this.packOpen = false
    }
    this.applyWeatherText()
  }

  isDetailsOpen(): boolean {
    return this.detailsOpen
  }

  isPackOpen(): boolean {
    return this.packOpen
  }

  showPackAdvice(): void {
    this.detailsOpen = true
    this.packOpen = true
    this.applyWeatherText()
  }

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      if (this.fetchOnStart) {
        this.refreshWeather(this.defaultLatitude, this.defaultLongitude)
      }
    })
  }

  /** Last formatted summary shown in `weatherSummaryText` (for category “Weather” detail). */
  getLastSummary(): string {
    return this.lastSummary
  }

  /**
   * Call when you have GPS (e.g. from Location AR / device APIs). AccuWeather package expects lat/lng strings.
   */
  refreshWeather(latitude: string, longitude: string): void {
    if (!this.accuWeatherRemoteModule) {
      this.setText(
        'AccuWeather: assign Accuweather.remoteServiceModule from the Weather API asset (see Snap AccuWeather template docs).',
      )
      return
    }

    const request = RemoteApiRequest.create()
    request.endpoint = 'current_condition_and_forecast'
    request.body = JSON.stringify({ lat: latitude, lng: longitude })

    this.accuWeatherRemoteModule.performApiRequest(request, (response: RemoteApiResponse) => {
      if (response.statusCode !== 1) {
        this.setText(`AccuWeather request failed (status=${response.statusCode}). Check RSM + API setup in Lens Studio.`)
        return
      }
      try {
        const data = JSON.parse(response.body) as Record<string, unknown>
        this.measuredDays = this.collectMeasuredDays(data)
        this.setText(this.formatAccuSummary(data))
      } catch (e) {
        this.setText(`AccuWeather parse error: ${e}`)
      }
    })
  }

  private formatAccuSummary(data: Record<string, unknown>): string {
    const lines: string[] = ['🌤️ Weather (AccuWeather)']

    const current = (data.currentCondition ?? data.current) as Record<string, unknown> | undefined
    if (current) {
      const tempF = pickNumber(current, ['temperatureF', 'Temperature', 'temperature'])
      const tempC = pickNumber(current, ['temperatureC', 'temperatureCelsius'])
      const condRaw = pickString(current, ['condition', 'Condition', 'weatherText', 'WeatherText', 'iconPhrase'])
      const cond = condRaw ? weatherEmojiLabel(condRaw) : '—'
      if (tempF != null) {
        lines.push(`📍 Now: ${Math.round(tempF)}°F (${cond})`)
      } else if (tempC != null) {
        lines.push(`📍 Now: ${Math.round(tempC)}°C (${cond})`)
      } else {
        lines.push(`📍 Now: ${cond}`)
      }
    } else {
      lines.push('(Unexpected response shape — check AccuWeather RSM.)')
    }

    const daily = data.dailyForecast as unknown
    if (Array.isArray(daily) && daily.length > 1) {
      lines.push('🗓️ Next days:')
      const max = Math.min(daily.length, 4)
      for (let i = 1; i < max; i++) {
        const slot = daily[i] as Record<string, unknown>
        const day = (slot && (slot.day as Record<string, unknown>)) || slot
        if (!day) {
          continue
        }
        const t = pickNumber(day, ['temperatureF', 'highTemperatureF', 'Temperature', 'temperature'])
        const c = pickString(day, ['condition', 'Condition', 'weatherText', 'WeatherText'])
        const label = c ? weatherEmojiLabel(c) : 'Forecast'
        if (t != null) {
          lines.push(`• 🌡️ ${Math.round(t)}°F — ${label}`)
        } else {
          lines.push(`• ${label}`)
        }
      }
    }

    return lines.join('\n')
  }

  private setText(msg: string): void {
    this.lastSummary = msg
    this.applyWeatherText()
  }

  getPackingContext(draft: TripDraft | null): string {
    const schedule = buildTripWeatherSchedule(draft, this.homeCity, this.measuredDays)
    return `${schedule}\n${buildWhatToPack(draft, schedule)}`
  }

  private applyWeatherText(): void {
    if (!this.weatherSummaryText) {
      return
    }
    const now = this.measuredDays.length > 0 ? this.measuredDays[0] : 'Forecast loading'
    if (!this.detailsOpen) {
      const trip = this.tripChipLine()
      this.weatherSummaryText.text = trip.length > 0 ? `${now} · ${this.homeCity}\n${trip}` : `${this.homeCity}\n${now}`
      return
    }
    const schedule = buildTripWeatherSchedule(this.draft, this.homeCity, this.measuredDays)
    if (!this.packOpen) {
      this.weatherSummaryText.text = `${schedule}\nPinch again for What to Pack`
      return
    }
    this.weatherSummaryText.text = `${schedule}\n\n${buildWhatToPack(this.draft, schedule)}`
  }

  /** Second line of the closed chip: route and trip length, once the draft has them. */
  private tripChipLine(): string {
    if (!this.draft) {
      return ''
    }
    const from = this.draft.departureCity.trim()
    const to = this.draft.destinationCity.trim()
    if (to.length === 0) {
      return ''
    }
    const route = from.length > 0 && from.toLowerCase() !== to.toLowerCase() ? `${from} → ${to}` : to
    const days = spanDays(this.draft.departureDateTime, this.draft.arrivalDateTime)
    return days > 0 ? `${route} · ${days} ${days === 1 ? 'day' : 'days'}` : route
  }

  private collectMeasuredDays(data: Record<string, unknown>): string[] {
    const days: string[] = []
    const current = (data.currentCondition ?? data.current) as Record<string, unknown> | undefined
    if (current) {
      days.push(this.formatSlot(current))
    }
    const daily = data.dailyForecast as unknown
    if (Array.isArray(daily)) {
      for (let i = 1; i < daily.length && days.length < 5; i++) {
        const slot = daily[i] as Record<string, unknown>
        const day = (slot && (slot.day as Record<string, unknown>)) || slot
        if (day) {
          days.push(this.formatSlot(day))
        }
      }
    }
    return days
  }

  private formatSlot(obj: Record<string, unknown>): string {
    const tempF = pickNumber(obj, ['temperatureF', 'highTemperatureF', 'Temperature', 'temperature'])
    const tempC = pickNumber(obj, ['temperatureC', 'temperatureCelsius'])
    const condRaw = pickString(obj, ['condition', 'Condition', 'weatherText', 'WeatherText', 'iconPhrase'])
    const cond = condRaw ? weatherEmojiLabel(condRaw) : 'Forecast'
    if (tempF != null) {
      return `${Math.round(tempF)}°F · ${cond}`
    }
    if (tempC != null) {
      return `${Math.round(tempC)}°C · ${cond}`
    }
    return cond
  }
}

function spanDays(depart: string, ret: string): number {
  const a = (depart || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const b = (ret || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!a || !b) {
    return 0
  }
  const start = new Date(parseInt(a[3], 10), parseInt(a[2], 10) - 1, parseInt(a[1], 10))
  const end = new Date(parseInt(b[3], 10), parseInt(b[2], 10) - 1, parseInt(b[1], 10))
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]]
    if (typeof v === 'number' && !isNaN(v)) {
      return v
    }
    if (typeof v === 'string' && v.length > 0 && !isNaN(parseFloat(v))) {
      return parseFloat(v)
    }
  }
  return null
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]]
    if (typeof v === 'string' && v.length > 0) {
      return v
    }
  }
  return ''
}

function weatherEmojiLabel(raw: string): string {
  const u = raw.toUpperCase().replace(/\s+/g, '_')
  const map: Record<string, string> = {
    SUNNY: '☀️ Sunny',
    WINDY: '💨 Windy',
    SNOW: '❄️ Snow',
    CLEAR_NIGHT: '🌙 Clear night',
    CLOUDY: '☁️ Cloudy',
    HAIL: '🧊 Hail',
    LIGHTNING: '⛈️ Storms',
    LOW_VISIBILITY: '🌫️ Low visibility',
    PARTIAL_CLOUDY: '⛅ Partly cloudy',
    PARTIAL_CLOUDY_NIGHT: '🌙☁️ Partly cloudy night',
    RAINY: '🌧️ Rain',
    HOT: '🔥 Hot',
    COLD: '🥶 Cold',
    UNKNOWN: '❔ Unknown',
    FOG: '🌫️ Fog',
  }
  if (map[u]) {
    return map[u]
  }
  const human = raw.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
  return `🌤️ ${human}`
}
