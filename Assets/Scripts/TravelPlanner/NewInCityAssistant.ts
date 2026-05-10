import { DestinationVisualizer } from './DestinationVisualizer'
import { GeminiAssistant } from './GeminiAssistant'
import { TripPurpose } from './TripTypes'

/**
 * Orchestration hook for assistant flows (e.g. voice session tools, WebView lifecycle, destination imagery).
 * Wire Gemini / search modules when Remote Service Gateway and related assets are in the project.
 */
@component
export class NewInCityAssistant extends BaseScriptComponent {
  @input
  @allowUndefined
  destinationVisualizer: DestinationVisualizer

  @input
  @allowUndefined
  geminiAssistant: GeminiAssistant

  private tripData = {
    destination: '',
    occasion: 'leisure' as TripPurpose,
  }

  /**
   * Call after the user confirms a trip (e.g. from a `saveTripDetails` tool handler).
   */
  saveTripDetails(destination: string, occasion: string, weatherCtx: string): void {
    this.tripData.destination = destination
    this.tripData.occasion = this.normalizePurpose(occasion)

    if (this.geminiAssistant) {
      const draft = this.geminiAssistant.getTripDraft()
      draft.destinationCity = destination
      draft.purpose = this.normalizePurpose(occasion)
      draft.skipLongDistanceTransport = false
    }

    const viz = this.destinationVisualizer
    if (!viz) {
      return
    }

    viz.generateDestinationImage(destination, occasion, weatherCtx, (base64) => {
      if (base64) {
        viz.applyToPlanes(base64, destination)
      }
    })
  }

  private normalizePurpose(raw: string): TripPurpose {
    const key = (raw || '').toLowerCase()
    if (key.indexOf('bleisure') >= 0) {
      return 'bleisure'
    }
    if (key.indexOf('business') >= 0) {
      return 'business'
    }
    return 'leisure'
  }

  /** Call when tearing down WebView / clearing browser state. */
  dismissDestinationView(): void {
    this.destinationVisualizer?.dismiss()
  }

  /**
   * Start voice-first onboarding.
   * Pass user display name and detected city from your location service module.
   */
  beginVoiceAssistant(userName: string, currentCity: string): string {
    if (!this.geminiAssistant) {
      return ''
    }
    return this.geminiAssistant.beginAssistantSession(userName, currentCity)
  }

  beginVoiceAssistantFromContext(): string {
    if (!this.geminiAssistant) {
      return ''
    }
    return this.geminiAssistant.beginAssistantSessionFromContext()
  }

  /**
   * Feed speech-to-text transcript from Gemini Live / dictation pipeline.
   */
  handleVoiceTranscript(transcript: string): void {
    this.geminiAssistant?.handleSpeechTranscript(transcript)
  }

  /**
   * Trigger Gemini trip planning request once required fields are captured.
   */
  planTripFromCapturedDetails(): void {
    this.geminiAssistant?.requestTripPlan()
  }
}
