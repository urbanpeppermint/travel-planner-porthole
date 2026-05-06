import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable'
import { SIK } from 'SpectaclesInteractionKit.lspkg/SIK'
import { DestinationVisualizer } from './DestinationVisualizer'
import { TripState } from './TripState'

/**
 * Wires SIK Interactable buttons to a simple trip model and a summary Text.
 * See SCENE_SETUP.md in the project root for hierarchy and inspector wiring.
 */
@component
export class TravelPlannerController extends BaseScriptComponent {
  @input
  @hint('Large Text showing the live itinerary')
  summaryText: Text

  @input
  @hint('Three pinch/interactable objects for cities')
  destinationButtonA: SceneObject

  @input
  destinationButtonB: SceneObject

  @input
  destinationButtonC: SceneObject

  @input
  destinationNameA: string = 'Paris'

  @input
  destinationNameB: string = 'Tokyo'

  @input
  destinationNameC: string = 'New York'

  @input
  @allowUndefined
  activityButtonA: SceneObject

  @input
  @allowUndefined
  activityButtonB: SceneObject

  @input
  activityNameA: string = 'Museums'

  @input
  activityNameB: string = 'Local food'

  @input
  @allowUndefined
  @hint('Optional: pinch to clear the activity list')
  clearActivitiesButton: SceneObject

  @input
  @allowUndefined
  @hint('Phase 16 — generate RSG destination layers when a city is chosen')
  destinationVisualizer: DestinationVisualizer

  @input
  @hint('If true, triggers Porthole image gen on destination pinch')
  enablePortholeOnDestinationSelect: boolean = true

  @input
  @hint('Mood keyword for RSG prompt: romantic | adventure | other')
  defaultOccasion: string = 'general'

  @input
  @hint('Free-text weather line passed into the image prompt')
  defaultWeatherContext: string = 'clear skies'

  private readonly trip = new TripState()

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.setupInteractables()
      this.refreshSummary()
    })
  }

  private setupInteractables(): void {
    if (!SIK.InteractionManager) {
      print('[TravelPlannerController] SIK.InteractionManager not ready')
      return
    }

    this.bindDestination(this.destinationButtonA, this.destinationNameA)
    this.bindDestination(this.destinationButtonB, this.destinationNameB)
    this.bindDestination(this.destinationButtonC, this.destinationNameC)

    this.bindActivity(this.activityButtonA, this.activityNameA)
    this.bindActivity(this.activityButtonB, this.activityNameB)

    if (this.clearActivitiesButton) {
      this.bindClear(this.clearActivitiesButton)
    }
  }

  private bindDestination(button: SceneObject, label: string): void {
    if (!button) {
      print('[TravelPlannerController] Missing destination button reference')
      return
    }
    const interactable = button.getComponent(Interactable.getTypeName()) as Interactable
    if (!interactable) {
      print(`[TravelPlannerController] Add Interactable to: ${button.name}`)
      return
    }
    interactable.onInteractorTriggerEnd.add(() => {
      this.trip.setDestination(label)
      this.refreshSummary()
      this.tryOpenPortholeForDestination(label)
    })
  }

  private bindActivity(button: SceneObject | undefined, label: string): void {
    if (!button) {
      return
    }
    const interactable = button.getComponent(Interactable.getTypeName()) as Interactable
    if (!interactable) {
      print(`[TravelPlannerController] Add Interactable to: ${button.name}`)
      return
    }
    interactable.onInteractorTriggerEnd.add(() => {
      this.trip.addActivity(label)
      this.refreshSummary()
    })
  }

  private bindClear(button: SceneObject): void {
    const interactable = button.getComponent(Interactable.getTypeName()) as Interactable
    if (!interactable) {
      print(`[TravelPlannerController] Add Interactable to: ${button.name}`)
      return
    }
    interactable.onInteractorTriggerEnd.add(() => {
      this.trip.clearActivities()
      this.refreshSummary()
    })
  }

  private refreshSummary(): void {
    if (!this.summaryText) {
      return
    }
    this.summaryText.text = this.trip.toDisplayString()
  }

  private tryOpenPortholeForDestination(label: string): void {
    if (!this.enablePortholeOnDestinationSelect || !this.destinationVisualizer) {
      return
    }
    const viz = this.destinationVisualizer
    viz.generateDestinationImage(label, this.defaultOccasion, this.defaultWeatherContext, (base64) => {
      if (base64) {
        viz.applyToPlanes(base64, label)
      }
    })
  }
}
