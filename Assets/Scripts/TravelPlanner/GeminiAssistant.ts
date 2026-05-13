import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { Gemini } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAI'
import { GoogleGenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes'
import { DestinationVisualizer } from './DestinationVisualizer'
import { TripDraft, TripPlanResponse, TripPlanningCategory, TripPurpose } from './TripTypes'

/**
 * Voice-first trip intake orchestrator.
 *
 * Trip planning uses **`Gemini.models()`** from Remote Service Gateway (same stack as ExampleGeminiCalls).
 * Do not call `performApiRequest` on a random RSM with a fake endpoint — that causes
 * `RemoteServiceModule: no API spec id provided` because the Sync module expects built-in `parameters`.
 *
 * Call `beginAssistantSession()` once the mic experience starts, then feed user transcripts to
 * `handleSpeechTranscript()`. When all required fields are captured, call `requestTripPlan()`.
 *
 * **Voice → trip fields:** Parsed with **deterministic phrase + regex rules** on the ASR string
 * (same language path as the mic). **Gemini is not** re-interpreted on every utterance — only
 * `requestTripPlan()` calls Gemini once the draft is filled. Improve fluency by extending parsers
 * here rather than expecting live Gemini on raw speech.
 */
@component
export class GeminiAssistant extends BaseScriptComponent {
  /** Month / weekday tokens that must never be treated as city names (ASR often sits "to may 15" next to cities). */
  private static readonly NON_CITY_TOKENS = new Set<string>([
    'jan',
    'january',
    'feb',
    'february',
    'mar',
    'march',
    'apr',
    'april',
    'may',
    'jun',
    'june',
    'jul',
    'july',
    'aug',
    'august',
    'sep',
    'sept',
    'september',
    'oct',
    'october',
    'nov',
    'november',
    'dec',
    'december',
    'mon',
    'monday',
    'tue',
    'tues',
    'tuesday',
    'wed',
    'wednesday',
    'thu',
    'thur',
    'thurs',
    'thursday',
    'fri',
    'friday',
    'sat',
    'saturday',
    'sun',
    'sunday',
  ])

  /** Single-token captures that are never valid calendar values (regex / ASR glitches). */
  private static readonly SPEECH_DATE_NOISE_WORDS = new Set<string>([
    'month',
    'week',
    'year',
    'day',
    'time',
    'date',
    'the',
    'end',
    'next',
    'last',
  ])

  @input
  @hint('Gemini model id for generateContent (e.g. gemini-2.0-flash).')
  geminiModel: string = 'gemini-2.0-flash'

  @input
  @allowUndefined
  @hint('Optional destination imagery hook.')
  destinationVisualizer: DestinationVisualizer

  @input
  @allowUndefined
  @hint('Optional summary text for assistant state and captured fields.')
  summaryText: Text

  @input
  @allowUndefined
  @hint('Optional status text for prompts and errors.')
  statusText: Text

  @input
  @allowUndefined
  @hint('Optional loading image/object shown while plan generation is running.')
  generationLoadingBar: SceneObject

  @input
  @hint('Enable category widgets when plan is ready.')
  categoryWidgetRoots: SceneObject[] = []

  @input
  @hint('Optional title labels for each category widget.')
  categoryTitleTexts: Text[] = []

  @input
  @hint('Category order used in UI and Gemini prompt.')
  planningCategories: string[] = ['transportation', 'accommodation', 'places', 'restaurants', 'weather', 'pack']

  @input
  @hint('Fallback city for location prompt when location services do not provide one.')
  fallbackDepartureCity: string = 'Berlin'

  @input
  @hint('If destination is missing, default it to current user city for local explore mode.')
  defaultDestinationToCurrentCity: boolean = true

  @input
  @hint('When true, use user id (if available) in welcome; otherwise display name.')
  preferUserIdInWelcome: boolean = false

  @input
  @hint('Prefix [GeminiAssistant] logs for trip-plan / SDK tracing.')
  verboseTripLogs: boolean = true

  private readonly log = new NativeLogger('GeminiAssistant')

  readonly onPromptGenerated: Event<string> = new Event<string>()
  readonly onTripDraftUpdated: Event<TripDraft> = new Event<TripDraft>()
  readonly onTripPlanReady: Event<TripPlanResponse> = new Event<TripPlanResponse>()

  private tripDraft: TripDraft = this.createEmptyDraft()
  private waitingForDepartureCityConfirmation: boolean = false
  /** After the first in-context welcome, further Voice pinches only refresh listening hints (no state reset). */
  private voiceWelcomeCommitted: boolean = false
  private detectedDepartureCity: string = ''
  private currentUserName: string = 'Traveler'
  private userContextResolved: boolean = false
  private currentUserId: string = ''
  private lastTripPlan: TripPlanResponse | null = null
  /** Prevents `CategoryPlanDetailController` from clearing the same `Text` while pack scan is mid-flight (device crash). */
  private packScanDetailUiLockDepth: number = 0

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.resolveUserContextDefaults()
      this.disableCategoryWidgets()
      this.publishSummary()
    })
  }

  beginAssistantSession(userName: string, detectedDepartureCity: string): string {
    this.currentUserName = userName && userName.length > 0 ? userName : 'Traveler'
    this.detectedDepartureCity =
      detectedDepartureCity && detectedDepartureCity.length > 0 ? detectedDepartureCity : this.fallbackDepartureCity
    this.waitingForDepartureCityConfirmation = true
    if (this.tripDraft.departureCity.length === 0) {
      this.tripDraft.departureCity = this.detectedDepartureCity
    }
    this.publishSummary()

    const prompt = `Hey ${this.getPreferredUserLabel()}, are you planning to travel from ${this.detectedDepartureCity}?`
    this.setStatus(prompt)
    this.onPromptGenerated.invoke(prompt)
    return prompt
  }

  /**
   * Starts the assistant using user-context defaults already fetched from Lens systems.
   */
  beginAssistantSessionFromContext(): string {
    if (this.currentUserName.length === 0) {
      this.currentUserName = 'Traveler'
    }
    if (this.detectedDepartureCity.length === 0) {
      this.detectedDepartureCity = this.fallbackDepartureCity
    }
    if (!this.voiceWelcomeCommitted) {
      this.voiceWelcomeCommitted = true
      return this.beginAssistantSession(this.currentUserName, this.detectedDepartureCity)
    }
    const hint = this.getVoiceListeningHint()
    this.setStatus(hint)
    return hint
  }

  /** Short line for VoiceHint when user re-opens the mic after the welcome pass. */
  getVoiceListeningHint(): string {
    if (this.waitingForDepartureCityConfirmation) {
      return `Reply: are you leaving from ${this.detectedDepartureCity}? (yes / no / or say your city.)`
    }
    return this.getNextMissingPrompt()
  }

  /**
   * External systems (e.g. Sync Kit user info) can push identity here.
   */
  setUserIdentity(userId: string, displayName: string): void {
    if (userId && userId.length > 0) {
      this.currentUserId = userId
    }
    if (displayName && displayName.length > 0) {
      this.currentUserName = displayName
    }
  }

  /**
   * Feed speech-to-text transcript chunks or final utterances into this method.
   */
  handleSpeechTranscript(transcript: string): void {
    if (!transcript || transcript.trim().length === 0) {
      return
    }

    const normalized = transcript.trim()
    const lowered = normalized.toLowerCase()

    if (this.waitingForDepartureCityConfirmation) {
      if (this.isLocalExploreIntent(lowered)) {
        this.handleDepartureConfirmation(normalized)
        return
      }
      // User answered the welcome with a full sentence (cities + dates in one go) — do not
      // block on yes/no; parse everything together.
      if (this.speechSupersedesDepartureWelcome(lowered)) {
        this.waitingForDepartureCityConfirmation = false
        this.tripDraft.skipLongDistanceTransport = false
      } else {
        this.handleDepartureConfirmation(normalized)
        this.publishSummary()
        return
      }
    }

    this.extractTripFields(normalized)
    this.publishSummary()

    if (this.isDraftReady()) {
      this.setStatus('Trip details captured. Say "plan my trip" to generate options.')
    } else {
      this.setStatus(this.getNextMissingPrompt())
    }
  }

  requestTripPlan(): void {
    this.applyMissingFieldDefaults()
    this.publishSummary()
    if (!this.isDraftReady()) {
      this.tripLog('requestTripPlan blocked: draft not ready')
      this.setStatus(this.getNextMissingPrompt())
      return
    }

    const categories = this.getCategoriesForRequest()
    const userPrompt = this.buildTripPlanPrompt(categories)

    this.tripLog(
      `requestTripPlan → Gemini.models("${this.geminiModel}") categories=${JSON.stringify(categories)} trip=${JSON.stringify(this.tripDraft)}`,
    )

    const geminiRequest: GoogleGenAITypes.Gemini.Models.GenerateContentRequest = {
      model: this.geminiModel,
      type: 'generateContent',
      body: {
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.4,
        },
      },
    }

    this.setStatus('Generating trip options via Gemini (RSG Sync)...')
    this.setGeneratingLoading(true)

    Gemini.models(geminiRequest)
      .then((response) => {
        this.tripLog(`Gemini.models OK: raw=${JSON.stringify(response).substring(0, 800)}`)
        const text = this.extractTextFromGenerateContentResponse(response)
        if (!text || text.length === 0) {
          this.setStatus('Gemini returned no text. Check promptFeedback / safety block in Logger.')
          print(`[GeminiAssistant] Full response: ${JSON.stringify(response)}`)
          this.setGeneratingLoading(false)
          return
        }
        const parsed = this.parseTripPlanJson(text)
        if (!parsed) {
          this.setStatus('Gemini text was not valid JSON. See Logger for raw text.')
          print(`[GeminiAssistant] Raw model text (first 2000 chars): ${text.substring(0, 2000)}`)
          this.setGeneratingLoading(false)
          return
        }
        this.lastTripPlan = parsed
        this.applyPlanToWidgets(parsed)
        this.onTripPlanReady.invoke(parsed)
        this.setStatus('Trip plan ready. Open any category card to continue.')
        this.setGeneratingLoading(false)
      })
      .catch((error) => {
        this.log.e(`Gemini.models error: ${error}`)
        this.setStatus(`Gemini.models failed: ${error}. Ensure RemoteServiceGatewayCredentials (Google token) is in scene.`)
        this.setGeneratingLoading(false)
      })
  }

  getTripDraft(): TripDraft {
    return this.tripDraft
  }

  /** True while pack scan owns the category detail body (do not clear/disable that UI). */
  isPackScanDetailUiLocked(): boolean {
    return this.packScanDetailUiLockDepth > 0
  }

  /** Call when entering pack scan `sending` from a non-sending state (once per capture). */
  notifyPackScanDetailUiLockEntered(): void {
    this.packScanDetailUiLockDepth++
  }

  /** Call when leaving `sending` to idle/open (pairs with entered lock). */
  notifyPackScanDetailUiLockExited(): void {
    if (this.packScanDetailUiLockDepth <= 0) {
      return
    }
    this.packScanDetailUiLockDepth--
  }

  /**
   * Stable trip labels for auxiliary prompts (e.g. Pack scan) before `requestTripPlan()`.
   * Departure: draft → detected user city → `fallbackDepartureCity`. Destination: draft,
   * or mirrors departure when `defaultDestinationToCurrentCity`; if still empty, departure,
   * then **User Context / detected** city, then `fallbackDepartureCity`.
   * Dates use localized fallback when empty so pack scan always has a calendar anchor.
   */
  resolveTripSurfaceForPackScan(): TripDraft {
    const fb =
      this.fallbackDepartureCity && this.fallbackDepartureCity.trim().length > 0
        ? this.fallbackDepartureCity.trim()
        : 'Berlin'
    const detected = this.detectedDepartureCity ? this.detectedDepartureCity.trim() : ''
    let dep = this.tripDraft.departureCity.trim()
    if (!dep) {
      dep = detected.length > 0 ? detected : fb
    }
    let dest = this.tripDraft.destinationCity.trim()
    if (!dest && this.defaultDestinationToCurrentCity) {
      dest = dep.length > 0 ? dep : fb
    }
    if (!dest) {
      dest = dep.length > 0 ? dep : detected.length > 0 ? detected : fb
    }
    const dateFb = this.getLocalizedDateFallback()
    return {
      departureCity: dep,
      destinationCity: dest,
      departureDateTime: this.tripDraft.departureDateTime.trim() || dateFb,
      arrivalDateTime: this.tripDraft.arrivalDateTime.trim() || dateFb,
      purpose: this.tripDraft.purpose,
      skipLongDistanceTransport: this.tripDraft.skipLongDistanceTransport,
      voicePreferenceNotes: this.tripDraft.voicePreferenceNotes,
    }
  }

  /** Last successful `requestTripPlan` parse — used by category detail UI. */
  getLastTripPlan(): TripPlanResponse | null {
    return this.lastTripPlan
  }

  /** Category order used in UI (same as trip-plan request). */
  getPlanningCategoriesResolved(): TripPlanningCategory[] {
    return this.getCategories()
  }

  /** Call after another component mutates `tripDraft` (e.g. occasion buttons) so summary + mirrors update. */
  notifyTripDraftChanged(): void {
    this.publishSummary()
  }

  resetTripDraft(): void {
    this.tripDraft = this.createEmptyDraft()
    this.lastTripPlan = null
    this.waitingForDepartureCityConfirmation = false
    this.voiceWelcomeCommitted = false
    this.disableCategoryWidgets()
    this.publishSummary()
    this.setStatus('Trip draft cleared.')
  }

  private createEmptyDraft(): TripDraft {
    return {
      departureCity: '',
      destinationCity: '',
      departureDateTime: '',
      arrivalDateTime: '',
      purpose: 'leisure',
      skipLongDistanceTransport: false,
      voicePreferenceNotes: '',
    }
  }

  /**
   * User Context + Sync Kit APIs are native Snapchat features and often throw
   * `InternalError: Value is not a native object` in the **Lens Studio editor** or when the host
   * does not expose a full user stack. Always apply fallbacks first; only call natives on device.
   */
  private resolveUserContextDefaults(): void {
    this.applyFallbackUserContext()

    const device = global.deviceInfoSystem
    const isEditor = device && device.isEditor && device.isEditor()

    if (isEditor) {
      print(
        '[GeminiAssistant] Editor: using fallback city/name only. Pair to Snapchat on device for User Context (display name + city).',
      )
      this.userContextResolved = true
      this.resolveSyncKitIdentitySafe()
      return
    }

    const userContext = (global as any).userContextSystem
    if (!userContext || typeof userContext.requestCity !== 'function') {
      print('[GeminiAssistant] userContextSystem.requestCity not available; using fallback city.')
      this.userContextResolved = true
      this.resolveSyncKitIdentitySafe()
      return
    }

    const self = this

    try {
      if (typeof userContext.requestDisplayName === 'function') {
        // Plain function callback — some hosts reject arrow / non-native closures for native APIs.
        userContext.requestDisplayName(function (name: string) {
          if (name && name.length > 0) {
            self.currentUserName = name
          }
        })
      }
    } catch (e) {
      print(`[GeminiAssistant] requestDisplayName skipped: ${e}`)
    }

    try {
      userContext.requestCity(function (city: string) {
        if (city && city.length > 0) {
          self.detectedDepartureCity = city
          if (self.tripDraft.departureCity.length === 0) {
            self.tripDraft.departureCity = city
          }
          self.publishSummary()
        }
      })
    } catch (e) {
      print(`[GeminiAssistant] requestCity skipped: ${e}`)
      this.applyFallbackUserContext()
    }

    this.userContextResolved = true
    this.resolveSyncKitIdentitySafe()
  }

  private applyFallbackUserContext(): void {
    if (this.detectedDepartureCity.length === 0) {
      this.detectedDepartureCity = this.fallbackDepartureCity
    }
    if (this.tripDraft.departureCity.length === 0) {
      this.tripDraft.departureCity = this.detectedDepartureCity
    }
  }

  private applyMissingFieldDefaults(): void {
    if (this.tripDraft.departureCity.length === 0) {
      this.tripDraft.departureCity =
        this.detectedDepartureCity.length > 0 ? this.detectedDepartureCity : this.fallbackDepartureCity
    }

    if (this.defaultDestinationToCurrentCity && this.tripDraft.destinationCity.length === 0) {
      this.tripDraft.destinationCity = this.tripDraft.departureCity
      this.setStatus(
        `Using ${this.tripDraft.destinationCity} as destination for local explore mode (places, food, weather, and pack).`,
      )
    }

    const fallbackDate = this.getLocalizedDateFallback()
    if (this.tripDraft.departureDateTime.length === 0) {
      this.tripDraft.departureDateTime = fallbackDate
    }
    if (this.tripDraft.arrivalDateTime.length === 0) {
      this.tripDraft.arrivalDateTime = fallbackDate
    }
  }

  private handleDepartureConfirmation(transcript: string): void {
    const lowered = transcript.toLowerCase()
    if (this.isLocalExploreIntent(lowered)) {
      this.waitingForDepartureCityConfirmation = false
      this.tripDraft.skipLongDistanceTransport = true
      this.tripDraft.departureCity =
        this.detectedDepartureCity.length > 0 ? this.detectedDepartureCity : this.fallbackDepartureCity
      this.tripDraft.destinationCity = this.tripDraft.departureCity
      this.publishSummary()
      this.setStatus(
        'Local mode: skipping long-distance transport. Share dates if you want, or say "plan my trip" for places, food, weather, and pack.',
      )
      return
    }

    if (this.isYes(lowered)) {
      this.tripDraft.skipLongDistanceTransport = false
      this.tripDraft.departureCity = this.detectedDepartureCity
      this.waitingForDepartureCityConfirmation = false
      this.extractTripFields(transcript)
      this.publishSummary()
      this.setStatus(
        this.isDraftReady()
          ? 'Trip details captured. Say "plan my trip" to generate options.'
          : 'Great. Where are you going, and what are your departure and return dates?',
      )
      return
    }
    if (this.isNo(lowered)) {
      this.waitingForDepartureCityConfirmation = false
      this.tripDraft.skipLongDistanceTransport = false
      this.extractTripFields(transcript)
      this.publishSummary()
      this.setStatus('No problem. Tell me which city you are leaving from, then your destination and dates.')
      return
    }

    const city = this.extractCityAfterKeyword(lowered, 'from')
    if (city.length > 0) {
      this.tripDraft.departureCity = city
      this.waitingForDepartureCityConfirmation = false
      this.extractTripFields(transcript)
      this.publishSummary()
      this.setStatus(
        this.isDraftReady()
          ? 'Trip details captured. Say "plan my trip" to generate options.'
          : this.getNextMissingPrompt(),
      )
      return
    }

    this.setStatus(`Please say yes/no, or tell me your departure city (for example: "from ${this.fallbackDepartureCity}").`)
  }

  private extractTripFields(transcript: string): void {
    const loweredRaw = transcript.toLowerCase()
    this.applyExplicitCurrentLocationPhrases(loweredRaw)
    const lowered = this.normalizeVoiceDateTokens(this.expandHereAliasesInCityPhrases(loweredRaw))

    const cityPair = this.extractCityPairFromFreeform(lowered)
    if (cityPair) {
      if (this.tripDraft.departureCity.length === 0) {
        this.tripDraft.departureCity = cityPair.from
      }
      if (this.tripDraft.destinationCity.length === 0) {
        this.tripDraft.destinationCity = cityPair.to
        this.triggerDestinationPreview()
      }
    }

    const fromCity = this.extractCityAfterKeyword(lowered, 'from')
    if (fromCity.length > 0) {
      this.tripDraft.departureCity = fromCity
    }

    const toCity = this.extractCityAfterKeyword(lowered, 'to')
    if (toCity.length > 0) {
      this.tripDraft.destinationCity = toCity
      this.triggerDestinationPreview()
    }

    const departTime = this.extractDateTimeAfterKeyword(lowered, 'depart')
    if (departTime.length > 0) {
      this.tripDraft.departureDateTime = departTime
    }

    const arrivalTime = this.extractDateTimeAfterKeyword(lowered, 'arrive')
    if (arrivalTime.length > 0) {
      this.tripDraft.arrivalDateTime = arrivalTime
    }

    const dateRange = this.extractDateRangeFromFreeform(lowered)
    if (dateRange) {
      if (this.tripDraft.departureDateTime.length === 0) {
        this.tripDraft.departureDateTime = dateRange.depart
      }
      if (this.tripDraft.arrivalDateTime.length === 0) {
        this.tripDraft.arrivalDateTime = dateRange.arrive
      }
    }

    const relativeRange = this.extractRelativeDateRange(lowered)
    if (relativeRange) {
      if (this.tripDraft.departureDateTime.length === 0) {
        this.tripDraft.departureDateTime = relativeRange.depart
      }
      if (this.tripDraft.arrivalDateTime.length === 0) {
        this.tripDraft.arrivalDateTime = relativeRange.arrive
      }
    }

    const fluentEndMonth = this.extractFluentUntilEndOfMonth(lowered)
    if (fluentEndMonth) {
      this.tripDraft.departureDateTime = fluentEndMonth.depart
      this.tripDraft.arrivalDateTime = fluentEndMonth.arrive
    }

    if (this.tripDraft.departureDateTime.length === 0) {
      const lone = this.extractLoneMonthDayInUtterance(lowered)
      if (lone) {
        this.tripDraft.departureDateTime = lone
      }
    }

    const purpose = this.extractPurpose(lowered)
    if (purpose !== '') {
      this.tripDraft.purpose = purpose
    }

    this.appendTripPreferenceHintsFromSpeech(transcript)

    const depSan = this.sanitizeCityCandidate(this.tripDraft.departureCity)
    if (!depSan) {
      this.tripDraft.departureCity = ''
    } else if (depSan !== this.tripDraft.departureCity) {
      this.tripDraft.departureCity = depSan
    }
    const destSan = this.sanitizeCityCandidate(this.tripDraft.destinationCity)
    if (!destSan) {
      this.tripDraft.destinationCity = ''
    } else if (destSan !== this.tripDraft.destinationCity) {
      this.tripDraft.destinationCity = destSan
    }

    const loc = this.detectedDepartureCity.length > 0 ? this.detectedDepartureCity : this.fallbackDepartureCity
    if (loc && this.tripDraft.departureCity.toLowerCase() === 'here') {
      this.tripDraft.departureCity = loc
    }

    this.stripGarbageDateFields()
  }

  /** User said "use my current location" etc. — map departure to Lens-detected / fallback city. */
  private applyExplicitCurrentLocationPhrases(lowered: string): void {
    const loc = this.detectedDepartureCity.length > 0 ? this.detectedDepartureCity : this.fallbackDepartureCity
    if (!loc || loc.length === 0) {
      return
    }
    const useHere =
      /\b(use my current location|use current location|my current location|this location|where i am|where i'm at|my gps location)\b/.test(
        lowered,
      ) ||
      /\b(from|leaving|depart(?:ing)?|start(?:ing)?)\s+from\s+here\b/.test(lowered) ||
      /\b(from|leaving)\s+right\s+here\b/.test(lowered)
    if (useHere) {
      this.tripDraft.departureCity = loc
    }
  }

  /**
   * ASR often says "from here to Paris" — replace **here** with the resolved city so city regexes work.
   * Uses lowercase slug words; sanitize / toCityCase later fixes casing.
   */
  private expandHereAliasesInCityPhrases(lowered: string): string {
    const loc = this.detectedDepartureCity.length > 0 ? this.detectedDepartureCity : this.fallbackDepartureCity
    if (!loc || loc.length === 0) {
      return lowered
    }
    const slug = loc.toLowerCase().replace(/\s+/g, ' ').trim()
    if (slug.length === 0) {
      return lowered
    }
    let s = lowered
    s = s.replace(/\bfrom here to\b/g, `from ${slug} to`)
    s = s.replace(/\bgoing from here to\b/g, `going from ${slug} to`)
    s = s.replace(/\btravel(?:ing|ling)? from here to\b/g, `traveling from ${slug} to`)
    s = s.replace(/\bleaving from here to\b/g, `leaving from ${slug} to`)
    s = s.replace(/\bfrom here for\b/g, `from ${slug} for`)
    return s
  }

  private extractCityPairFromFreeform(text: string): { from: string; to: string } | null {
    const t = text.replace(/[!?.]/g, ' ').trim().toLowerCase()
    // Prefer explicit "from <city> to <city>" so we never swallow "from ... to ... from May …" into one city.
    const trip = t.match(
      /\bfrom\s+([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*){0,2})\s+to\s+([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*){0,2})(?=\s+from\s|\s+for\s|\s+on\b|\s+between\b|\s+depart|\s+return|\s+leaving|\s+arriv|$|[,.]|\s+\d|\s+tomorrow|\s+today|\s+next\s)/,
    )
    if (trip && trip.length >= 3) {
      const from = this.sanitizeCityCandidate(trip[1].trim())
      const to = this.sanitizeCityCandidate(trip[2].trim())
      if (from && to && from.toLowerCase() !== to.toLowerCase()) {
        return { from, to }
      }
    }

    const cleaned = t
    const legacy = cleaned.match(
      /(?:^|\b)(?:i am going|i'm going|go|travel(?:ing)?|trip)\s+([a-z][a-z\s'-]{1,30})\s+to\s+([a-z][a-z\s'-]{1,30})(?:,| on | departing| leaving| returning|$)/,
    )
    if (legacy && legacy.length >= 3) {
      const fromL = this.sanitizeCityCandidate(legacy[1].trim())
      const toL = this.sanitizeCityCandidate(legacy[2].trim())
      if (fromL && toL && fromL.toLowerCase() !== toL.toLowerCase()) {
        return { from: fromL, to: toL }
      }
    }

    const skipLead = new Set<string>([
      'flying',
      'flight',
      'flights',
      'travel',
      'traveling',
      'travelling',
      'trip',
      'go',
      'going',
      'fly',
      'get',
      'heading',
      'drive',
      'train',
      'bus',
      'back',
      'way',
    ])
    const direct = t.match(
      /\b([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*){0,2})\s+to\s+([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*){0,2})(?=\s+(?:from|for|on|the|starting|leaving|tomorrow|today|next|between|until|return|,|\d|$)|$)/,
    )
    if (direct && direct.length >= 3) {
      const rawLead = direct[1].trim().toLowerCase()
      if (!skipLead.has(rawLead)) {
        const fromD = this.sanitizeCityCandidate(direct[1].trim())
        const toD = this.sanitizeCityCandidate(direct[2].trim())
        if (fromD && toD && fromD.toLowerCase() !== toD.toLowerCase()) {
          return { from: fromD, to: toD }
        }
      }
    }

    return null
  }

  /** True when the user is clearly dictating a trip (not a short yes/no) — skip welcome gate. */
  private speechSupersedesDepartureWelcome(lowered: string): boolean {
    const forCities = this.expandHereAliasesInCityPhrases(lowered)
    const forDates = this.normalizeVoiceDateTokens(forCities)
    if (this.extractCityPairFromFreeform(forCities)) {
      return true
    }
    if (this.extractDateRangeFromFreeform(forDates)) {
      return true
    }
    if (this.extractRelativeDateRange(forDates)) {
      return true
    }
    if (/\bfrom\s+[a-z][a-z'\-]{1,28}\s+to\s+[a-z]/.test(forCities)) {
      return true
    }
    if (/\b(depart|departure|return(?:ing)?|arriv(?:e|ing)?|until)\b/.test(lowered) && /\d/.test(forDates)) {
      return true
    }
    if (/\bfrom here to\b/.test(lowered) || /\b(use my current location|my current location)\b/.test(lowered)) {
      return true
    }
    return false
  }

  private addCalendarDays(base: Date, days: number): Date {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
    d.setDate(d.getDate() + days)
    return d
  }

  private formatTripCalendarDate(d: Date): string {
    return `${this.pad2(d.getDate())}/${this.pad2(d.getMonth() + 1)}/${d.getFullYear()}`
  }

  /**
   * Parses spoken relative windows: "from tomorrow for a week", "today for 5 days", "next week".
   * Returns dd/mm/yyyy strings for draft fields (same style as extractDateRangeFromFreeform).
   */
  private extractRelativeDateRange(lowered: string): { depart: string; arrive: string } | null {
    let durDays: number | null = null
    if (/\bfor\s+(?:a|an|one|1)\s+weeks?\b/.test(lowered) || /\b(?:a|one|1)\s+week(?:\s+long|\s+trip|\s+stay)?\b/.test(lowered)) {
      durDays = 7
    }
    if (/\bfor\s+(?:a|an|one)\s+fortnight\b/.test(lowered)) {
      durDays = 14
    }
    const numDays = lowered.match(/\bfor\s+(\d{1,2})\s+days?\b/)
    if (numDays) {
      const n = parseInt(numDays[1], 10)
      if (n >= 1 && n <= 60) {
        durDays = n
      }
    }
    const wordDays = lowered.match(
      /\bfor\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen)\s+days?\b/,
    )
    if (wordDays) {
      const map: { [key: string]: number } = {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
        eleven: 11,
        twelve: 12,
        fourteen: 14,
      }
      const w = wordDays[1]
      if (map[w] !== undefined) {
        durDays = map[w]
      }
    }

    let startOffset: number | null = null
    if (/\bday after tomorrow\b/.test(lowered)) {
      startOffset = 2
    } else if (/\b(from|starting|depart(?:ing)?|leav(?:e|ing))\s+tomorrow\b/.test(lowered)) {
      startOffset = 1
    } else if (/\b(from|starting|depart(?:ing)?|leav(?:e|ing))\s+today\b/.test(lowered)) {
      startOffset = 0
    } else if (/\btomorrow\b/.test(lowered) && durDays !== null) {
      startOffset = 1
    } else if (/\btoday\b/.test(lowered) && durDays !== null && !/\bfrom\s+tomorrow\b/.test(lowered)) {
      startOffset = 0
    } else if (/\bnext\s+week\b/.test(lowered)) {
      startOffset = 7
      if (durDays === null) {
        durDays = 7
      }
    } else if (/\b(leav(?:e|ing)|depart(?:ing)?|start(?:ing)?|go(?:ing)?|flying)\s+today\b/.test(lowered)) {
      startOffset = 0
      if (durDays === null) {
        durDays = 1
      }
    }

    if (durDays !== null && startOffset === null) {
      startOffset = 1
    }
    if (startOffset !== null && durDays === null) {
      durDays = 1
    }

    if (startOffset === null || durDays === null || durDays < 1) {
      return null
    }

    const startDate = this.addCalendarDays(new Date(), startOffset)
    const endDate = this.addCalendarDays(startDate, durDays)
    return {
      depart: this.formatTripCalendarDate(startDate),
      arrive: this.formatTripCalendarDate(endDate),
    }
  }

  /** Converts "may 13th" / "13 may" style chunks to dd/mm/yyyy using the current calendar year. */
  private parseSpokenMonthDayPair(monthTok: string, dayNum: number): string {
    const mi = this.monthAbbrToIndex(monthTok)
    if (mi < 0 || dayNum < 1 || dayNum > 31) {
      return ''
    }
    return this.monthDayToTripFormat(mi, dayNum)
  }

  /**
   * Single "may 13" / "13 may" in a fluent sentence (no "may 13 to may 20" range) — fills departure
   * when keyword-based parsing did not yield a strict calendar string.
   */
  private extractLoneMonthDayInUtterance(text: string): string | null {
    const re = /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)\s+(\d{1,2})(?:st|nd|rd|th)?\b/g
    const found: { mon: string; day: number; index: number }[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      found.push({ mon: m[1], day: parseInt(m[2], 10), index: m.index })
    }
    if (found.length === 0) {
      return null
    }
    if (found.length >= 2) {
      const between = text.substring(found[0].index, found[1].index)
      if (/\b(to|-|until)\b/.test(between)) {
        return null
      }
    }
    const parsed = this.parseSpokenMonthDayPair(found[0].mon, found[0].day)
    return parsed.length > 0 ? parsed : null
  }

  /** Parses leading fragment after "depart"/"arrive" into dd/mm/yyyy when it is spoken month/day. */
  private parseLooseSpokenDateFragment(frag: string): string {
    const t = frag.trim().toLowerCase()
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) {
      return frag.trim()
    }
    if (/^tomorrow\b/.test(t)) {
      return this.formatTripCalendarDate(this.addCalendarDays(new Date(), 1))
    }
    if (/^today\b/.test(t)) {
      return this.formatTripCalendarDate(this.addCalendarDays(new Date(), 0))
    }
    const md = t.match(
      /^\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)\s+(\d{1,2})(?:st|nd|rd|th)?\b/,
    )
    if (md) {
      return this.parseSpokenMonthDayPair(md[1], parseInt(md[2], 10))
    }
    const dm = t.match(
      /^\s*(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)\b/,
    )
    if (dm) {
      return this.parseSpokenMonthDayPair(dm[2], parseInt(dm[1], 10))
    }
    return ''
  }

  private extractDateRangeFromFreeform(text: string): { depart: string; arrive: string } | null {
    const numeric = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:to|-|until)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/)
    if (numeric && numeric.length >= 3) {
      return { depart: numeric[1], arrive: numeric[2] }
    }

    const monthRange = text.match(
      /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|-|until)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)\s+(\d{1,2})(?:st|nd|rd|th)?/,
    )
    if (monthRange && monthRange.length >= 5) {
      const d0 = parseInt(monthRange[2], 10)
      const d1 = parseInt(monthRange[4], 10)
      const a = this.parseSpokenMonthDayPair(monthRange[1], d0)
      const b = this.parseSpokenMonthDayPair(monthRange[3], d1)
      if (a && b) {
        return { depart: a, arrive: b }
      }
    }

    const dayFirst = text.match(
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)\s*(?:to|-|until)\s*(\d{1,2})(?:st|nd|rd|th)?\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)\b/,
    )
    if (dayFirst && dayFirst.length >= 5) {
      const a = this.parseSpokenMonthDayPair(dayFirst[2], parseInt(dayFirst[1], 10))
      const b = this.parseSpokenMonthDayPair(dayFirst[4], parseInt(dayFirst[3], 10))
      if (a && b) {
        return { depart: a, arrive: b }
      }
    }

    return null
  }

  private triggerDestinationPreview(): void {
    if (!this.destinationVisualizer || this.tripDraft.destinationCity.length === 0) {
      return
    }
    this.destinationVisualizer.generateDestinationImage(
      this.tripDraft.destinationCity,
      this.tripDraft.purpose,
      'clear skies',
      (base64) => {
        if (!base64 || base64.length === 0) {
          return
        }
        this.destinationVisualizer.applyToPlanes(base64, this.tripDraft.destinationCity)
      },
    )
  }

  private applyPlanToWidgets(response: TripPlanResponse): void {
    this.enableCategoryWidgets()

    const categories = this.getCategories()
    const cards = response.cards || {}
    for (let i = 0; i < this.categoryTitleTexts.length && i < categories.length; i++) {
      const text = this.categoryTitleTexts[i]
      if (text) {
        const category = categories[i]
        const title = this.buildCategoryTitle(category, response)
        text.text = `${title}  ›`
      }
    }
  }

  private buildCategoryTitle(category: TripPlanningCategory, response: TripPlanResponse): string {
    const cards = response.cards || {}
    const card = cards[category]
    if (!card) {
      return this.capitalize(category)
    }
    const count = card.options ? card.options.length : 0
    return `${this.capitalize(category)} (${count})`
  }

  private publishSummary(): void {
    if (this.summaryText) {
      const lines = [
        `From: ${this.tripDraft.departureCity.length > 0 ? this.tripDraft.departureCity : '—'}`,
        `To: ${this.tripDraft.destinationCity.length > 0 ? this.tripDraft.destinationCity : '—'}`,
        `Depart: ${this.tripDraft.departureDateTime.length > 0 ? this.tripDraft.departureDateTime : '—'}`,
        `Arrive: ${this.tripDraft.arrivalDateTime.length > 0 ? this.tripDraft.arrivalDateTime : '—'}`,
        `Purpose: ${this.tripDraft.purpose.length > 0 ? this.tripDraft.purpose : 'leisure'}`,
        `Transport: ${this.tripDraft.skipLongDistanceTransport ? 'local only (no long-haul)' : 'include long-distance'}`,
      ]
      if (this.tripDraft.voicePreferenceNotes && this.tripDraft.voicePreferenceNotes.length > 0) {
        const n = this.tripDraft.voicePreferenceNotes
        lines.push(`Voice prefs: ${n.length > 220 ? `${n.substring(0, 217)}…` : n}`)
      }
      this.summaryText.text = lines.join('\n')
    }
    this.onTripDraftUpdated.invoke(this.tripDraft)
  }

  private setStatus(message: string): void {
    if (this.statusText) {
      this.statusText.text = message
    }
    this.onPromptGenerated.invoke(message)
  }

  private setGeneratingLoading(enabled: boolean): void {
    if (this.generationLoadingBar) {
      this.generationLoadingBar.enabled = enabled
    }
  }

  private tripLog(message: string): void {
    if (this.verboseTripLogs) {
      this.log.i(message)
    }
  }

  private buildTripPlanPrompt(categories: TripPlanningCategory[]): string {
    const tripJson = JSON.stringify(this.tripDraft)
    const catList = categories.join(', ')
    return [
      'You are a travel planning assistant. Reply with ONE JSON object only (no markdown, no prose).',
      `User display name: ${this.currentUserName}`,
      `Trip draft (fields may be empty strings): ${tripJson}`,
      'Use voicePreferenceNotes in the JSON for user intent (food, transport bias, family/work, hobbies) when generating options — never invent a different destination than destinationCity.',
      'Purpose must be exactly one of: leisure, business, bleisure.',
      `Include planning cards ONLY for these categories, in this order when possible: ${catList}.`,
      'If skipLongDistanceTransport is true, omit long-haul flights/trains; focus on local transit and day trips.',
      'Weather and pack must match destination, dates, and purpose when inferable.',
      'JSON shape:',
      '{',
      '  "summary": string (optional),',
      '  "cards": {',
      '    "<category>": {',
      '      "category": "<same as key>",',
      '      "options": [',
      '        {',
      '          "provider": string, "title": string, "price"?: string, "departureTime"?: string, "arrivalTime"?: string, "notes"?: string,',
      '          "sourceSite"?: string, "bookingProductUrl"?: string, "pricePerNight"?: string, "totalStayPrice"?: string,',
      '          "airline"?: string, "outboundSummary"?: string, "inboundSummary"?: string,',
      '          "ticketUrl"?: string, "ticketOfficeHint"?: string,',
      '          "pricePerPerson"?: string, "neighborhood"?: string, "dressCode"?: string,',
      '          "weatherPracticalTips"?: string, "luggageVisionHint"?: string',
      '        }',
      '      ]',
      '    }',
      '  }',
      '}',
      'Categories must be chosen from: transportation, accommodation, places, restaurants, weather, pack.',
      'For accommodation when trip dates exist:',
      '  - Include a **mix of price tiers**: at least one **value or solid mid-range** hotel (well-reviewed, good neighborhood) and avoid listing only luxury 5-star properties unless purpose is business and voicePreferenceNotes clearly imply upscale stays.',
      '  - Include at least one **hotel price-comparison** option: set sourceSite to "Google Hotels", "Trivago", "Kayak Hotels", or "HotelsCombined", title like "Compare hotel rates in the destination city" using the draft dates, notes that users compare chains and OTAs for lower nightly rates.',
      '  - Spread other stays across realistic OTAs in sourceSite — e.g. booking.com, Agoda, Hotels.com, Expedia — not the same ultra-premium positioning for every row.',
      '  - Use pricePerNight and totalStayPrice only as **broad indicative ranges** — when you include a number, **prefix a real currency symbol** (€, $, £, or JP¥) and avoid leading zeros (write "€400" not "0400"). Say "typical range" in words; never invent live rack rates. bookingProductUrl only when plausible public URLs; otherwise omit.',
      'For transportation when departureCity differs from destinationCity AND skipLongDistanceTransport is false (long-haul / international):',
      '  - Include at least one option aimed at **price comparison**: set sourceSite to "Skyscanner" or "Google Flights" or "Kayak", title like "Compare Rome → Tokyo flights" using the draft dates, notes explaining user compares airlines and times there — do not invent obscure airline brands (e.g. avoid fake names like "National Airways") as the only booking path.',
      '  - When both departure and return dates exist in the draft, at least one transportation option must frame **round-trip / return-included** search in title or notes and state that **round-trip tickets are usually much cheaper than buying two separate one-way tickets**; do not present two one-ways as the default cheapest path.',
      '  - Add 1–2 additional options naming **real** major carriers that commonly serve similar routes (e.g. ITA Airways, JAL, ANA, Lufthansa, Air France) as examples in title/notes/airline; price may be qualitative with a **currency symbol** (e.g. "from €800 typical round-trip range") or omitted — never fake live fares or use naked numbers with leading zeros.',
      '  - Prefer ticketUrl only for well-known public flight-search URLs; if unsure, omit ticketUrl and keep sourceSite + notes.',
      'For transportation when cities match, skipLongDistanceTransport is true, or dates missing: local transit / trains / day trips only.',
      'If voicePreferenceNotes mention shortest/cheapest/direct, reflect that in transportation titles and notes.',
      'For places: ticketUrl and/or ticketOfficeHint for ticket purchase.',
      'For restaurants: include at least 3 options when possible: (1) one Michelin-star or clear fine-dining pick, (2) one famous street-food / market stall locals love, note strong TripAdvisor (or similar) reputation, (3) one other authentic local favorite. Put labels like "Michelin-style", "Street food", "Local classic" in title or notes.',
      'For weather: weatherPracticalTips (what to wear / rain / UV) — not raw API codes.',
      'For pack: luggageVisionHint for packing / bag-check guidance.',
      'Provide at least 2 options per included category when reasonable.',
    ].join('\n')
  }

  private extractTextFromGenerateContentResponse(response: any): string {
    try {
      const candidates = response && response.candidates
      if (!candidates || candidates.length === 0) {
        return ''
      }
      const parts = candidates[0].content && candidates[0].content.parts
      if (!parts || parts.length === 0) {
        return ''
      }
      const first = parts[0]
      if (first && typeof first.text === 'string') {
        return first.text
      }
    } catch (e) {
      this.log.e(`extractTextFromGenerateContentResponse: ${e}`)
    }
    return ''
  }

  private parseTripPlanJson(raw: string): TripPlanResponse | null {
    const trimmed = this.stripCodeFence(raw).trim()
    const jsonSlice = this.extractJsonObject(trimmed)
    if (!jsonSlice) {
      this.log.e('parseTripPlanJson: no JSON object found in model text')
      return null
    }
    try {
      const parsed = JSON.parse(jsonSlice) as TripPlanResponse
      if (!parsed.cards || typeof parsed.cards !== 'object') {
        this.log.e('parseTripPlanJson: parsed JSON missing cards')
        return null
      }
      this.tripLog(`parseTripPlanJson OK: keys=${Object.keys(parsed.cards).join(',')}`)
      return parsed
    } catch (e) {
      this.log.e(`parseTripPlanJson: JSON.parse failed: ${e}`)
      return null
    }
  }

  private stripCodeFence(text: string): string {
    let s = text
    if (s.indexOf('```') === 0) {
      s = s.replace(/^```[a-zA-Z]*\s*/, '')
      const end = s.lastIndexOf('```')
      if (end >= 0) {
        s = s.substring(0, end)
      }
    }
    return s
  }

  private extractJsonObject(text: string): string | null {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) {
      return null
    }
    return text.substring(start, end + 1)
  }

  private getPreferredUserLabel(): string {
    if (this.preferUserIdInWelcome && this.currentUserId.length > 0) {
      return this.currentUserId
    }
    return this.currentUserName.length > 0 ? this.currentUserName : 'Traveler'
  }

  private resolveSyncKitIdentitySafe(): void {
    const device = global.deviceInfoSystem
    if (device && device.isEditor && device.isEditor()) {
      return
    }

    const syncUserInfo = (global as any).syncKitUserInfoSystem ?? (global as any).userInformationSystem
    if (!syncUserInfo) {
      return
    }

    const self = this

    try {
      if (typeof syncUserInfo.requestUserId === 'function') {
        syncUserInfo.requestUserId(function (id: string) {
          if (id && id.length > 0) {
            self.currentUserId = id
          }
        })
      }
    } catch (e) {
      print(`[GeminiAssistant] requestUserId skipped: ${e}`)
    }

    try {
      if (typeof syncUserInfo.requestDisplayName === 'function') {
        syncUserInfo.requestDisplayName(function (name: string) {
          if (name && name.length > 0 && self.currentUserName === 'Traveler') {
            self.currentUserName = name
          }
        })
      }
    } catch (e) {
      print(`[GeminiAssistant] syncKit requestDisplayName skipped: ${e}`)
    }
  }

  private isDraftReady(): boolean {
    if (this.isLocalPlanReady()) {
      return true
    }
    return (
      this.tripDraft.departureCity.length > 0 &&
      this.tripDraft.destinationCity.length > 0 &&
      this.tripDraft.departureDateTime.length > 0 &&
      this.tripDraft.arrivalDateTime.length > 0
    )
  }

  private getNextMissingPrompt(): string {
    if (this.tripDraft.departureCity.length === 0) {
      return 'Please tell me your departure city (or say: use my current location).'
    }
    if (this.tripDraft.destinationCity.length === 0) {
      return 'Please tell me your destination city (or say: I am already there).'
    }
    if (this.tripDraft.departureDateTime.length === 0) {
      return 'Please tell me departure date and time.'
    }
    if (this.tripDraft.arrivalDateTime.length === 0) {
      return 'Please tell me arrival date and time.'
    }
    return 'Trip data ready.'
  }

  private isLocalPlanReady(): boolean {
    return (
      this.tripDraft.departureCity.length > 0 &&
      this.tripDraft.destinationCity.length > 0 &&
      this.tripDraft.departureCity === this.tripDraft.destinationCity
    )
  }

  private getCategoriesForRequest(): TripPlanningCategory[] {
    const all = this.getCategories()
    if (!this.tripDraft.skipLongDistanceTransport) {
      return all
    }
    const out: TripPlanningCategory[] = []
    for (let i = 0; i < all.length; i++) {
      if (all[i] !== 'transportation') {
        out.push(all[i])
      }
    }
    return out.length > 0 ? out : all
  }

  private getCategories(): TripPlanningCategory[] {
    const parsed: TripPlanningCategory[] = []
    for (let i = 0; i < this.planningCategories.length; i++) {
      const category = this.normalizeCategory(this.planningCategories[i])
      if (category) {
        parsed.push(category)
      }
    }
    return parsed.length > 0
      ? parsed
      : ['transportation', 'accommodation', 'places', 'restaurants', 'weather', 'pack']
  }

  private normalizeCategory(raw: string): TripPlanningCategory | null {
    const key = raw.toLowerCase().trim()
    if (
      key === 'transportation' ||
      key === 'accommodation' ||
      key === 'places' ||
      key === 'restaurants' ||
      key === 'weather' ||
      key === 'pack'
    ) {
      return key
    }
    return null
  }

  private extractCityAfterKeyword(text: string, keyword: string): string {
    const t = text.toLowerCase()
    const kw = keyword.toLowerCase()

    if (kw === 'from') {
      const trip = t.match(
        /\bfrom\s+([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*){0,2})\s+to\b/,
      )
      if (trip && trip[1]) {
        return this.sanitizeCityCandidate(trip[1].trim()) || ''
      }
      const loose = t.match(/\bfrom\s+([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*){0,2})(?=\s*[,.]|$|\s+and\s|\s+on\s|\d)/)
      if (loose && loose[1]) {
        return this.sanitizeCityCandidate(loose[1].trim()) || ''
      }
      return ''
    }

    if (kw === 'to') {
      const trip = t.match(
        /\bfrom\s+[a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*){0,2}\s+to\s+([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*){0,2})(?=\s+from\s|\s+on\b|[,.]|\s+for\s|\s+the\s|$)/,
      )
      if (trip && trip[1]) {
        return this.sanitizeCityCandidate(trip[1].trim()) || ''
      }
      const loose = t.match(/\bto\s+([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*){0,2})(?=\s+from|\s+on|[,.]|$)/)
      if (loose && loose[1]) {
        return this.sanitizeCityCandidate(loose[1].trim()) || ''
      }
      return ''
    }

    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\s+([a-z][a-zA-Z\\-']{1,24})(?=\\s|$|[,.]|\\d)`)
    const match = t.match(regex)
    if (!match || match.length < 2) {
      return ''
    }
    return this.sanitizeCityCandidate(match[1].trim()) || ''
  }

  /** Drops month/weekday tokens so "Berlin May" → "Berlin"; rejects pure "May" as a city. */
  private sanitizeCityCandidate(raw: string): string | null {
    const stripped = raw
      .trim()
      .toLowerCase()
      .replace(/[,.'"]+/g, ' ')
      .trim()
    if (!stripped.length) {
      return null
    }
    const words = stripped.split(/\s+/).filter((w) => w.length > 0 && !GeminiAssistant.NON_CITY_TOKENS.has(w))
    if (words.length === 0) {
      return null
    }
    return this.toCityCase(words.join(' '))
  }

  private appendTripPreferenceHintsFromSpeech(transcript: string): void {
    const t = transcript.toLowerCase()
    const lines: string[] = []
    const add = (s: string) => {
      if (lines.indexOf(s) < 0) {
        lines.push(s)
      }
    }
    if (/\b(for work|business trip|work travel|conference|client meeting)\b/.test(t)) {
      add('Context: work / business')
    }
    if (/\b(family|with (my )?(kids|children)|spouse|parents|relatives)\b/.test(t)) {
      add('Context: family')
    }
    if (/\b(solo|alone|by myself)\b/.test(t)) {
      add('Context: solo')
    }
    if (/\b(michelin|fine dining|tasting menu)\b/.test(t)) {
      add('Food: upscale / Michelin-style interest')
    }
    if (/\b(street food|food market|night market|hawker|food stall)\b/.test(t)) {
      add('Food: street food & markets')
    }
    if (/\b(tripadvisor|yelp|google reviews)\b/.test(t)) {
      add('Food: cares about review ratings')
    }
    if (/\b(vegetarian|vegan|halal|kosher|gluten[- ]?free)\b/.test(t)) {
      add('Food: dietary requirement mentioned')
    }
    if (/\b(shortest route|fewest stops|fastest|quickest)\b/.test(t)) {
      add('Transport: prefer speed / few connections')
    }
    if (/\b(cheapest|budget|save money|affordable|lowest price|best deal)\b/.test(t)) {
      add('Transport: prefer lowest cost')
    }
    if (/\b(direct|non[- ]?stop|fewer layovers)\b/.test(t)) {
      add('Transport: prefer direct routing')
    }
    if (/\b(museum|hiking|nightlife|shopping|architecture|history|art galleries?|photography)\b/.test(t)) {
      add('Interests: activities mentioned')
    }
    const block = lines.join('; ')
    if (!block.length) {
      return
    }
    const cur = this.tripDraft.voicePreferenceNotes || ''
    if (cur.indexOf(block) >= 0) {
      return
    }
    const merged = cur.length > 0 ? `${cur} | ${block}` : block
    this.tripDraft.voicePreferenceNotes =
      merged.length > 900 ? `${merged.substring(0, 897)}…` : merged
  }

  /** Spoken ordinals / cardinals ASR often drops ("13" vs "13th") — normalize before date regexes. */
  private normalizeVoiceDateTokens(lowered: string): string {
    let s = lowered
    const ordinals: [string, string][] = [
      ['first', '1st'],
      ['second', '2nd'],
      ['third', '3rd'],
      ['fourth', '4th'],
      ['fifth', '5th'],
      ['sixth', '6th'],
      ['seventh', '7th'],
      ['eighth', '8th'],
      ['ninth', '9th'],
      ['tenth', '10th'],
      ['eleventh', '11th'],
      ['twelfth', '12th'],
      ['thirteenth', '13th'],
      ['fourteenth', '14th'],
      ['fifteenth', '15th'],
      ['sixteenth', '16th'],
      ['seventeenth', '17th'],
      ['eighteenth', '18th'],
      ['nineteenth', '19th'],
      ['twentieth', '20th'],
      ['twenty-first', '21st'],
      ['twenty-second', '22nd'],
      ['twenty-third', '23rd'],
      ['twenty-fourth', '24th'],
      ['twenty-fifth', '25th'],
      ['twenty-sixth', '26th'],
      ['twenty-seventh', '27th'],
      ['twenty-eighth', '28th'],
      ['twenty-ninth', '29th'],
      ['thirtieth', '30th'],
      ['thirty-first', '31st'],
    ]
    for (let i = 0; i < ordinals.length; i++) {
      const re = new RegExp(`\\b${ordinals[i][0]}\\b`, 'g')
      s = s.replace(re, ordinals[i][1])
    }
    const cardinals: [string, string][] = [
      ['one', '1'],
      ['two', '2'],
      ['three', '3'],
      ['four', '4'],
      ['five', '5'],
      ['six', '6'],
      ['seven', '7'],
      ['eight', '8'],
      ['nine', '9'],
      ['ten', '10'],
      ['eleven', '11'],
      ['twelve', '12'],
      ['thirteen', '13'],
      ['fourteen', '14'],
      ['fifteen', '15'],
      ['sixteen', '16'],
      ['seventeen', '17'],
      ['eighteen', '18'],
      ['nineteen', '19'],
      ['twenty', '20'],
      ['thirty', '30'],
    ]
    for (let j = 0; j < cardinals.length; j++) {
      const re2 = new RegExp(`\\b${cardinals[j][0]}\\b`, 'g')
      s = s.replace(re2, cardinals[j][1])
    }
    return s
  }

  private isPlausibleSpeechDateFragment(raw: string): boolean {
    const t = raw.trim().toLowerCase()
    if (t.length < 3) {
      return false
    }
    const words = t.split(/\s+/).filter((w) => w.length > 0)
    if (words.length === 1 && GeminiAssistant.SPEECH_DATE_NOISE_WORDS.has(words[0])) {
      return false
    }
    if (/\d/.test(t)) {
      return true
    }
    if (
      /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/.test(
        t,
      )
    ) {
      return true
    }
    if (/\b(tomorrow|today|tonight|next\s+week)\b/.test(t)) {
      return true
    }
    return false
  }

  private monthAbbrToIndex(m: string): number {
    const ml = m.substring(0, 3).toLowerCase()
    const map: { [k: string]: number } = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      sept: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    }
    const v = map[ml]
    return v !== undefined ? v : -1
  }

  private monthDayToTripFormat(monthIdx: number, day: number): string {
    const y = new Date().getFullYear()
    const d = new Date(y, monthIdx, day)
    return this.formatTripCalendarDate(d)
  }

  /**
   * "from tomorrow until the end of the month" (and close variants) → calendar dates in dd/mm/yyyy.
   */
  private extractFluentUntilEndOfMonth(lowered: string): { depart: string; arrive: string } | null {
    if (!/\buntil\s+(?:the\s+)?end\s+of\s+(?:the\s+)?month\b/.test(lowered)) {
      return null
    }
    const hasTomorrowAnchor =
      /\bfrom\s+tomorrow\b/.test(lowered) ||
      /\b(starting|depart(?:ing|ure)?|leav(?:e|ing)|go(?:ing)?)\s+tomorrow\b/.test(lowered) ||
      /\btomorrow\s+until\s+(?:the\s+)?end\s+of\s+(?:the\s+)?month\b/.test(lowered)
    const hasTodayAnchor =
      /\bfrom\s+today\b/.test(lowered) || /\b(starting|depart(?:ing|ure)?|leav(?:e|ing))\s+today\b/.test(lowered)
    let startOffset = -1
    if (hasTomorrowAnchor) {
      startOffset = 1
    } else if (hasTodayAnchor) {
      startOffset = 0
    }
    if (startOffset < 0) {
      return null
    }
    const startDate = this.addCalendarDays(new Date(), startOffset)
    const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0)
    if (endDate < startDate) {
      return null
    }
    return {
      depart: this.formatTripCalendarDate(startDate),
      arrive: this.formatTripCalendarDate(endDate),
    }
  }

  private isStrictTripCalendarDate(s: string): boolean {
    return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test((s || '').trim())
  }

  private stripGarbageDateFields(): void {
    if (!this.isStrictTripCalendarDate(this.tripDraft.departureDateTime)) {
      this.tripDraft.departureDateTime = ''
    }
    if (!this.isStrictTripCalendarDate(this.tripDraft.arrivalDateTime)) {
      this.tripDraft.arrivalDateTime = ''
    }
  }

  private extractDateTimeAfterKeyword(text: string, keyword: string): string {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const head = text.match(new RegExp(`\\b${escaped}(?:ing|ure|ed|s)?\\s+`, 'i'))
    if (!head || head.index === undefined) {
      return ''
    }
    const i0 = head.index + head[0].length
    let frag = text.substring(i0, i0 + 96).trim()
    const cutIdx = frag.search(/\b(until|through|returning|arriving|,|;)\b/i)
    if (cutIdx >= 4) {
      frag = frag.substring(0, cutIdx).trim()
    }
    if (!this.isPlausibleSpeechDateFragment(frag)) {
      return ''
    }
    const tl = frag.trim().toLowerCase()
    if (/^tomorrow\b/.test(tl)) {
      return this.formatTripCalendarDate(this.addCalendarDays(new Date(), 1))
    }
    if (/^today\b/.test(tl)) {
      return this.formatTripCalendarDate(this.addCalendarDays(new Date(), 0))
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(frag.trim())) {
      return frag.trim()
    }
    const spoken = this.parseLooseSpokenDateFragment(frag)
    if (spoken.length > 0) {
      return spoken
    }
    return ''
  }

  private extractPurpose(text: string): TripPurpose | '' {
    if (text.indexOf('bleisure') >= 0) {
      return 'bleisure'
    }
    if (text.indexOf('business') >= 0 || text.indexOf('work') >= 0) {
      return 'business'
    }
    if (text.indexOf('leisure') >= 0 || text.indexOf('vacation') >= 0 || text.indexOf('holiday') >= 0) {
      return 'leisure'
    }
    return ''
  }

  private getLocalizedDateFallback(): string {
    const localization = (global as any).localizationSystem
    if (localization && typeof localization.getDateAndTimeFormatted === 'function') {
      try {
        const formatted = localization.getDateAndTimeFormatted()
        if (typeof formatted === 'string' && formatted.length > 0) {
          return formatted
        }
      } catch (_) {
        // Ignore and use manual date format fallback.
      }
    }
    const now = new Date()
    return `${this.pad2(now.getDate())}/${this.pad2(now.getMonth() + 1)}/${now.getFullYear()}`
  }

  private pad2(value: number): string {
    return value < 10 ? `0${value}` : `${value}`
  }

  private enableCategoryWidgets(): void {
    for (let i = 0; i < this.categoryWidgetRoots.length; i++) {
      const widget = this.categoryWidgetRoots[i]
      if (widget) {
        widget.enabled = true
      }
    }
  }

  private disableCategoryWidgets(): void {
    for (let i = 0; i < this.categoryWidgetRoots.length; i++) {
      const widget = this.categoryWidgetRoots[i]
      if (widget) {
        widget.enabled = false
      }
    }
  }

  private isYes(text: string): boolean {
    const t = text.toLowerCase().trim()
    if (t === 'yes' || t.indexOf('yes,') === 0 || t.indexOf('yes ') === 0) {
      return true
    }
    return /\b(sure|correct|yeah|yep|yup|absolutely|definitely|ok|okay)\b/.test(t)
  }

  private isNo(text: string): boolean {
    const t = text.toLowerCase().trim()
    if (t === 'no' || t.indexOf('no,') === 0 || t.indexOf('no ') === 0) {
      return true
    }
    if (/\b(another city|different city|not from here|wrong city)\b/.test(t)) {
      return true
    }
    return /\bno\b/.test(t) && t.length < 36
  }

  private isLocalExploreIntent(text: string): boolean {
    return (
      text.indexOf('already here') >= 0 ||
      text.indexOf('already there') >= 0 ||
      text.indexOf('i am here') >= 0 ||
      text.indexOf('stay here') >= 0 ||
      text.indexOf('local') >= 0 ||
      text.indexOf('near me') >= 0 ||
      text.indexOf('current location') >= 0 ||
      /\bexplore\s+here\b/.test(text) ||
      /\baround\s+here\b/.test(text)
    )
  }

  private capitalize(value: string): string {
    if (value.length === 0) {
      return value
    }
    return value.substring(0, 1).toUpperCase() + value.substring(1)
  }

  private toCityCase(raw: string): string {
    const words = raw.split(' ')
    const out: string[] = []
    for (let i = 0; i < words.length; i++) {
      const w = words[i].trim()
      if (w.length === 0) {
        continue
      }
      out.push(this.capitalize(w.substring(0, 1).toUpperCase() + w.substring(1).toLowerCase()))
    }
    return out.join(' ')
  }
}
