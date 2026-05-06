import { DestinationVisualizer } from './DestinationVisualizer'

/**
 * Orchestration hook for assistant flows (Gemini tools, anti-tracking WebView, Porthole).
 * Wire your session / engine references when those modules exist; Porthole hooks are ready below.
 */
@component
export class NewInCityAssistant extends BaseScriptComponent {
  @input
  @allowUndefined
  destinationVisualizer: DestinationVisualizer

  /** Latest confirmed trip — extend when you add WebView or LLM tool state */
  private tripData = {
    destination: '',
    occasion: 'general',
  }

  /**
   * Call after the user confirms a trip (e.g. from a `saveTripDetails` tool handler).
   * Mirrors the Phase 16 integration snippet from your spec.
   */
  saveTripDetails(destination: string, occasion: string, weatherCtx: string): void {
    this.tripData.destination = destination
    this.tripData.occasion = occasion

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

  /** Call from a `closeWebView` (or similar) tool handler alongside anti-tracking cleanup. */
  dismissPorthole(): void {
    this.destinationVisualizer?.dismiss()
  }
}
