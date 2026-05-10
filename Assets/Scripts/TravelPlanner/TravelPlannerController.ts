import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable'
import { SIK } from 'SpectaclesInteractionKit.lspkg/SIK'
import { DestinationVisualizer } from './DestinationVisualizer'
import { GeminiAssistant } from './GeminiAssistant'
import { TripDraft } from './TripTypes'
import { TripState } from './TripState'

/**
 * Wires SIK Interactable buttons for three trip purposes: leisure / business / bleisure.
 * City selection and dates are captured by Gemini assistant (voice or keyboard flow).
 */
@component
export class TravelPlannerController extends BaseScriptComponent {
  @input
  @hint('Large Text showing the live itinerary')
  summaryText: Text

  @input
  @hint('Three pinch/interactable roots for purpose: leisure, business, bleisure')
  occasionButtonA: SceneObject

  @input
  occasionButtonB: SceneObject

  @input
  occasionButtonC: SceneObject

  @input
  occasionLabelA: string = 'Leisure'

  @input
  occasionLabelB: string = 'Business'

  @input
  occasionLabelC: string = 'Bleisure'

  @input
  @allowUndefined
  @hint('Optional: sync occasion into assistant trip draft')
  geminiAssistant: GeminiAssistant

  @input
  @allowUndefined
  @hint('Phase 16 — generate RSG destination layers when destination is set elsewhere')
  destinationVisualizer: DestinationVisualizer

  @input
  @hint('If true, requests a generated destination image when destination text is set on trip state')
  enableDestinationImageOnSelect: boolean = false

  @input
  @hint('Mood keyword for RSG prompt when generating from occasion')
  defaultOccasion: string = 'general'

  @input
  @hint('Free-text weather line passed into the image prompt')
  defaultWeatherContext: string = 'clear skies'

  private readonly trip = new TripState()
  private lastSyncedDestination: string = ''

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.setupInteractables()
      if (this.geminiAssistant) {
        this.syncFromTripDraft(this.geminiAssistant.getTripDraft())
      } else {
        this.refreshSummary()
      }
    })
  }

  /**
   * Keeps the large itinerary block (`TripState` / `summaryText`) aligned with the voice assistant draft.
   */
  syncFromTripDraft(draft: TripDraft): void {
    if (draft.destinationCity && draft.destinationCity.length > 0) {
      this.trip.setDestination(draft.destinationCity)
    }
    const p = (draft.purpose || 'leisure').toLowerCase()
    if (p.indexOf('business') >= 0) {
      this.trip.setOccasion('Business')
    } else if (p.indexOf('bleisure') >= 0) {
      this.trip.setOccasion('Bleisure')
    } else if (p.indexOf('leisure') >= 0) {
      this.trip.setOccasion('Leisure')
    } else if (draft.purpose && draft.purpose.length > 0) {
      this.trip.setOccasion(draft.purpose.charAt(0).toUpperCase() + draft.purpose.slice(1))
    }
    this.refreshSummary()
    const dest = draft.destinationCity
    if (dest && dest.length > 0 && dest !== this.lastSyncedDestination) {
      this.lastSyncedDestination = dest
      this.tryGenerateDestinationImage(dest)
    }
  }

  private setupInteractables(): void {
    if (!SIK.InteractionManager) {
      print('[TravelPlannerController] SIK.InteractionManager not ready')
      return
    }

    this.bindOccasion(this.occasionButtonA, this.occasionLabelA)
    this.bindOccasion(this.occasionButtonB, this.occasionLabelB)
    this.bindOccasion(this.occasionButtonC, this.occasionLabelC)

  }

  private bindOccasion(button: SceneObject, label: string): void {
    if (!button) {
      print('[TravelPlannerController] Missing occasion button reference')
      return
    }
    const interactable = this.findInteractable(button)
    if (!interactable) {
      print(
        `[TravelPlannerController] No Interactable on "${button.name}" or its children (add SIK Interactable / Pinch Button under the placeholder).`,
      )
      return
    }
    interactable.onInteractorTriggerEnd.add(() => {
      this.trip.setOccasion(label)
      this.syncOccasionToAssistant(label)
      if (this.geminiAssistant) {
        this.geminiAssistant.notifyTripDraftChanged()
      } else {
        this.refreshSummary()
      }
    })
  }

  private syncOccasionToAssistant(label: string): void {
    if (!this.geminiAssistant) {
      return
    }
    const draft = this.geminiAssistant.getTripDraft()
    const key = label.toLowerCase()
    if (key.indexOf('business') >= 0) {
      draft.purpose = 'business'
    } else if (key.indexOf('bleisure') >= 0) {
      draft.purpose = 'bleisure'
    } else {
      draft.purpose = 'leisure'
    }
  }

  private refreshSummary(): void {
    if (!this.summaryText) {
      return
    }
    this.summaryText.text = this.trip.toDisplayString()
  }

  /** Interactable is usually on a child (e.g. Pinch Button prefab), not the placeholder root. */
  private findInteractable(root: SceneObject): Interactable | null {
    const direct = root.getComponent(Interactable.getTypeName()) as Interactable
    if (direct) {
      return direct
    }
    const n = root.getChildrenCount()
    for (let i = 0; i < n; i++) {
      const nested = this.findInteractable(root.getChild(i))
      if (nested) {
        return nested
      }
    }
    return null
  }

  /** Call from other scripts when voice flow sets a destination city name. */
  setTripDestinationForPreview(cityName: string): void {
    if (!cityName || cityName.length === 0) {
      return
    }
    this.trip.setDestination(cityName)
    this.refreshSummary()
    this.tryGenerateDestinationImage(cityName)
  }

  private tryGenerateDestinationImage(label: string): void {
    if (!this.enableDestinationImageOnSelect || !this.destinationVisualizer) {
      return
    }
    const viz = this.destinationVisualizer
    const mood = this.trip.occasion.length > 0 ? this.trip.occasion : this.defaultOccasion
    viz.generateDestinationImage(label, mood, this.defaultWeatherContext, (base64) => {
      if (base64) {
        viz.applyToPlanes(base64, label)
      }
    })
  }
}
