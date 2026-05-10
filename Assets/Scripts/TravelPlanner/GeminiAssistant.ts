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
 */
@component
export class GeminiAssistant extends BaseScriptComponent {
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
  private detectedDepartureCity: string = ''
  private currentUserName: string = 'Traveler'
  private userContextResolved: boolean = false
  private currentUserId: string = ''
  private lastTripPlan: TripPlanResponse | null = null

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
    return this.beginAssistantSession(this.currentUserName, this.detectedDepartureCity)
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
    if (this.waitingForDepartureCityConfirmation) {
      this.handleDepartureConfirmation(normalized)
      return
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
      this.publishSummary()
      this.setStatus('Great. Where are you going, and what are your departure and return dates?')
      return
    }
    if (this.isNo(lowered)) {
      this.waitingForDepartureCityConfirmation = false
      this.tripDraft.skipLongDistanceTransport = false
      this.setStatus('No problem. Tell me which city you are leaving from, then your destination and dates.')
      return
    }

    const city = this.extractCityAfterKeyword(lowered, 'from')
    if (city.length > 0) {
      this.tripDraft.departureCity = city
      this.waitingForDepartureCityConfirmation = false
      this.publishSummary()
      this.setStatus('Perfect. Now share destination city and travel dates.')
      return
    }

    this.setStatus(`Please say yes/no, or tell me your departure city (for example: "from ${this.fallbackDepartureCity}").`)
  }

  private extractTripFields(transcript: string): void {
    const lowered = transcript.toLowerCase()

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

    const purpose = this.extractPurpose(lowered)
    if (purpose !== '') {
      this.tripDraft.purpose = purpose
    }

  }

  private extractCityPairFromFreeform(text: string): { from: string; to: string } | null {
    const cleaned = text.replace(/[!?]/g, '').trim()
    const match = cleaned.match(
      /(?:^|\b)(?:i am going|i'm going|go|travel(?:ing)?|trip|from)?\s*([a-z][a-z\s'-]{1,30})\s+to\s+([a-z][a-z\s'-]{1,30})(?:,| on | departing| leaving| returning|$)/,
    )
    if (!match || match.length < 3) {
      return null
    }
    const from = this.toCityCase(match[1].trim())
    const to = this.toCityCase(match[2].trim())
    if (from.length === 0 || to.length === 0) {
      return null
    }
    if (from === to) {
      return null
    }
    return { from, to }
  }

  private extractDateRangeFromFreeform(text: string): { depart: string; arrive: string } | null {
    const numeric = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:to|-|until)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/)
    if (numeric && numeric.length >= 3) {
      return { depart: numeric[1], arrive: numeric[2] }
    }

    const monthRange = text.match(
      /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?)\s*(?:to|-|until)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?)/,
    )
    if (monthRange && monthRange.length >= 3) {
      return { depart: monthRange[1], arrive: monthRange[2] }
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
      this.summaryText.text = [
        `From: ${this.tripDraft.departureCity.length > 0 ? this.tripDraft.departureCity : '—'}`,
        `To: ${this.tripDraft.destinationCity.length > 0 ? this.tripDraft.destinationCity : '—'}`,
        `Depart: ${this.tripDraft.departureDateTime.length > 0 ? this.tripDraft.departureDateTime : '—'}`,
        `Arrive: ${this.tripDraft.arrivalDateTime.length > 0 ? this.tripDraft.arrivalDateTime : '—'}`,
        `Purpose: ${this.tripDraft.purpose.length > 0 ? this.tripDraft.purpose : 'leisure'}`,
        `Transport: ${this.tripDraft.skipLongDistanceTransport ? 'local only (no long-haul)' : 'include long-distance'}`,
      ].join('\n')
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
      'For accommodation: prefer sourceSite like booking.com, pricePerNight and totalStayPrice when trip dates exist.',
      'For transportation: airline, outboundSummary/inboundSummary when cities+dates known; else local transit.',
      'For places: ticketUrl and/or ticketOfficeHint for ticket purchase.',
      'For restaurants: pricePerPerson, neighborhood, dressCode.',
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
    const regex = new RegExp(`${keyword}\\s+([a-zA-Z\\s\\-']{2,40})`)
    const match = text.match(regex)
    if (!match || match.length < 2) {
      return ''
    }
    return this.toCityCase(match[1].trim())
  }

  private extractDateTimeAfterKeyword(text: string, keyword: string): string {
    const regex = new RegExp(`${keyword}[a-z\\s]*\\s+([a-z0-9,:\\-\\s]{4,60})`)
    const match = text.match(regex)
    if (!match || match.length < 2) {
      return ''
    }
    return match[1].trim()
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
    return text === 'yes' || text.indexOf('yes ') === 0 || text.indexOf('sure') >= 0 || text.indexOf('correct') >= 0
  }

  private isNo(text: string): boolean {
    return text === 'no' || text.indexOf('no ') === 0 || text.indexOf('not') >= 0 || text.indexOf('another city') >= 0
  }

  private isLocalExploreIntent(text: string): boolean {
    return (
      text.indexOf('already here') >= 0 ||
      text.indexOf('already there') >= 0 ||
      text.indexOf('i am here') >= 0 ||
      text.indexOf('local') >= 0 ||
      text.indexOf('near me') >= 0 ||
      text.indexOf('current location') >= 0
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
