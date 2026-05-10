import { PinchButton } from 'SpectaclesInteractionKit.lspkg/Components/UI/PinchButton/PinchButton'
import { ASRQueryController } from './ASRQueryController'
import { GeminiAssistant } from './GeminiAssistant'
import { TravelPlannerController } from './TravelPlannerController'
import { TripDraft } from './TripTypes'

@component
export class AIAssistantUIBridge extends BaseScriptComponent {
  private static readonly DATE_HINT = 'dd/mm/yyyy'

  @input
  @allowUndefined
  @hint('Primary trip assistant.')
  geminiAssistant: GeminiAssistant

  @input
  @allowUndefined
  @hint('Optional ASR controller that emits user speech transcripts.')
  asrQueryController: ASRQueryController

  @input
  @allowUndefined
  @hint('Optional legacy voice start button.')
  startAssistantButton: PinchButton

  @input
  @allowUndefined
  @hint('Optional legacy mic button; hide if using keyboard-first flow.')
  micToggleButton: PinchButton

  @input
  @allowUndefined
  @hint('Button to submit current captured trip draft to Gemini.')
  planTripButton: PinchButton

  @input
  @allowUndefined
  @hint('Optional hint line for setup/debug status.')
  hintText: Text

  @input
  @allowUndefined
  @hint('Mirrors Gemini trip draft into the center itinerary panel (TripState).')
  travelPlannerController: TravelPlannerController

  @input
  @allowUndefined
  @hint('Toggle keyboard entry mode (shows prompt + confirms each step).')
  keyboardToggleButton: PinchButton

  @input
  @allowUndefined
  @hint('Pinch to confirm current keyboard text entry for active step.')
  keyboardConfirmButton: PinchButton

  @input
  @allowUndefined
  @hint('Text field where user-typed value is read from.')
  keyboardEntryText: Text

  @input
  @allowUndefined
  @hint('Prompt/status line for keyboard step flow.')
  keyboardPromptText: Text

  @input
  @allowUndefined
  @hint('Optional panel root enabled only in keyboard mode.')
  keyboardModeRoot: SceneObject

  private keyboardModeEnabled: boolean = false
  private keyboardStepIndex: number = 0
  private readonly keyboardSteps = ['departure city', 'destination city', 'departure date', 'arrival date']

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.bindUi()
    })
  }

  private bindUi(): void {
    if (!this.geminiAssistant) {
      this.setHint('GeminiAssistant is not assigned.')
      return
    }

    this.geminiAssistant.onTripDraftUpdated.add((draft: TripDraft) => {
      this.travelPlannerController?.syncFromTripDraft(draft)
    })
    this.travelPlannerController?.syncFromTripDraft(this.geminiAssistant.getTripDraft())

    if (this.keyboardToggleButton) {
      this.keyboardToggleButton.onButtonPinched.add(() => {
        this.enterKeyboardMode()
      })
    }

    if (this.startAssistantButton) {
      this.startAssistantButton.onButtonPinched.add(() => {
        if (this.keyboardModeEnabled) {
          this.keyboardModeEnabled = false
          this.updateKeyboardUi()
          this.setKeyboardPrompt('Voice mode ON. Keyboard flow paused.')
        }
        const welcome = this.geminiAssistant.beginAssistantSessionFromContext()
        this.setHint(welcome)
      })
    } else if (!this.keyboardToggleButton) {
      // If only one button exists, let it start voice session (not keyboard mode).
      this.setHint('Assign keyboardToggleButton to enable manual text-entry mode.')
    }

    if (this.planTripButton) {
      this.planTripButton.onButtonPinched.add(() => {
        this.geminiAssistant.requestTripPlan()
      })
    }

    if (this.asrQueryController) {
      this.asrQueryController.onQueryEvent.add((query: string) => {
        this.routeVoiceQuery(query)
      })
    }

    if (this.keyboardConfirmButton) {
      this.keyboardConfirmButton.onButtonPinched.add(() => {
        this.confirmKeyboardStep()
      })
    }
    this.updateKeyboardUi()
  }

  private routeVoiceQuery(query: string): void {
    if (!this.geminiAssistant || !query || query.trim().length === 0 || this.keyboardModeEnabled) {
      return
    }

    const normalized = query.toLowerCase().trim()
    this.geminiAssistant.handleSpeechTranscript(query)

    if (
      normalized.indexOf('plan my trip') >= 0 ||
      normalized.indexOf('show options') >= 0 ||
      normalized.indexOf('find options') >= 0
    ) {
      this.geminiAssistant.requestTripPlan()
    }
  }

  private setHint(message: string): void {
    if (this.hintText) {
      this.hintText.text = message
    }
  }

  private enterKeyboardMode(): void {
    this.keyboardModeEnabled = true
    this.keyboardStepIndex = 0
    this.setKeyboardPrompt('Keyboard mode ON. Enter departure city, then pinch Confirm.')
    this.updateKeyboardUi()
  }

  private updateKeyboardUi(): void {
    if (this.keyboardModeRoot) {
      this.keyboardModeRoot.enabled = this.keyboardModeEnabled
    }
    if (!this.keyboardModeEnabled) {
      return
    }
    const step = this.keyboardSteps[this.keyboardStepIndex] || 'done'
    if (step === 'departure date' || step === 'arrival date') {
      this.setKeyboardPrompt(`Enter ${step} (${AIAssistantUIBridge.DATE_HINT}), then pinch Confirm.`)
    } else {
      this.setKeyboardPrompt(`Enter ${step}, then pinch Confirm.`)
    }
  }

  private confirmKeyboardStep(): void {
    if (!this.keyboardModeEnabled || !this.geminiAssistant) {
      return
    }
    const entry = this.keyboardEntryText ? this.keyboardEntryText.text.trim() : ''
    if (entry.length === 0) {
      this.setKeyboardPrompt('Please type a value before confirming.')
      return
    }
    const draft = this.geminiAssistant.getTripDraft()
    if (this.keyboardStepIndex === 0) {
      draft.departureCity = entry
    } else if (this.keyboardStepIndex === 1) {
      draft.destinationCity = entry
    } else if (this.keyboardStepIndex === 2) {
      if (!this.isDateDdMmYyyy(entry)) {
        this.setKeyboardPrompt(`Use ${AIAssistantUIBridge.DATE_HINT} format for departure date.`)
        return
      }
      draft.departureDateTime = entry
    } else if (this.keyboardStepIndex === 3) {
      if (!this.isDateDdMmYyyy(entry)) {
        this.setKeyboardPrompt(`Use ${AIAssistantUIBridge.DATE_HINT} format for arrival date.`)
        return
      }
      draft.arrivalDateTime = entry
    }
    this.geminiAssistant.notifyTripDraftChanged()
    if (this.keyboardEntryText) {
      this.keyboardEntryText.text = ''
    }
    this.keyboardStepIndex++
    if (this.keyboardStepIndex >= this.keyboardSteps.length) {
      this.setKeyboardPrompt('All keyboard fields captured. Pinch Plan Trip anytime.')
      this.keyboardModeEnabled = false
      this.updateKeyboardUi()
      return
    }
    this.updateKeyboardUi()
  }

  private setKeyboardPrompt(message: string): void {
    if (this.keyboardPromptText) {
      this.keyboardPromptText.text = message
    } else {
      this.setHint(message)
    }
  }

  private isDateDdMmYyyy(value: string): boolean {
    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (!match) {
      return false
    }
    const day = parseInt(match[1], 10)
    const month = parseInt(match[2], 10)
    return day >= 1 && day <= 31 && month >= 1 && month <= 12
  }
}
