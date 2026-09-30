import { GeminiAssistant } from './GeminiAssistant'
import { collectMapPins, MAP_PIN, TripMapPin } from './TripMapPins'
import { TripPlanResponse } from './TripTypes'

/**
 * Compact floating map list. Enable an optional root when a plan arrives and write
 * numbered pins (hotels, places, restaurants, stations). This is a glanceable index,
 * not turn-by-turn navigation.
 *
 * Wire `floatingMapText` to a short Text on a small panel that sits beside the category
 * rows. Leave `floatingMapRoot` empty to write the text only.
 */
@component
export class TripMapOverlay extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint('Plan source. Overlay fills when onTripPlanReady fires.')
  geminiAssistant: GeminiAssistant

  @input
  @allowUndefined
  @hint('Optional panel root. Enabled when pins exist; hidden again if the next plan has none.')
  floatingMapRoot: SceneObject

  @input
  @allowUndefined
  @hint('Short multi-line Text for the pin list.')
  floatingMapText: Text

  @input
  @hint('How many pins to show. Keep this small so the panel stays glanceable.')
  maxPins: number = 6

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.setRootEnabled(false)
      if (!this.geminiAssistant) {
        print('[TripMapOverlay] Assign geminiAssistant.')
        return
      }
      this.geminiAssistant.onTripPlanReady.add((plan) => {
        this.render(plan)
      })
    })
  }

  private render(plan: TripPlanResponse): void {
    const destination = this.geminiAssistant ? this.geminiAssistant.getTripDraft().destinationCity : ''
    const pins = collectMapPins(plan, this.maxPins)
    if (pins.length === 0) {
      this.write('')
      this.setRootEnabled(false)
      return
    }
    this.write(this.format(destination, pins))
    this.setRootEnabled(true)
  }

  private format(destination: string, pins: TripMapPin[]): string {
    const lines: string[] = []
    lines.push(destination && destination.length > 0 ? destination : 'Trip map')
    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i]
      const hint = pin.hint.length > 0 ? ` — ${pin.hint}` : ''
      lines.push(`${MAP_PIN} ${i + 1}  ${pin.label}${hint}`)
    }
    lines.push('Pins mark suggested places. Confirm routes on a maps app.')
    return lines.join('\n')
  }

  private write(body: string): void {
    if (!this.floatingMapText) {
      return
    }
    try {
      const owner = this.floatingMapText.getSceneObject()
      if (owner && !owner.enabled) {
        owner.enabled = true
      }
      this.floatingMapText.text = body
    } catch (e) {
      print(`[TripMapOverlay] write failed: ${e}`)
    }
  }

  private setRootEnabled(enabled: boolean): void {
    if (!this.floatingMapRoot) {
      return
    }
    try {
      this.floatingMapRoot.enabled = enabled
    } catch (e) {
      print(`[TripMapOverlay] floatingMapRoot.enabled: ${e}`)
    }
  }
}
