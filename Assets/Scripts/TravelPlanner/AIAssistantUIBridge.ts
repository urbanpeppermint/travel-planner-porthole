require('LensStudio:TextInputModule')

import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { PinchButton } from 'SpectaclesInteractionKit.lspkg/Components/UI/PinchButton/PinchButton'
import { ToggleButton } from 'SpectaclesInteractionKit.lspkg/Components/UI/ToggleButton/ToggleButton'
import { ASRQueryController } from './ASRQueryController'
import { GeminiAssistant } from './GeminiAssistant'
import { TravelPlannerController } from './TravelPlannerController'
import { TripDraft } from './TripTypes'

@component
export class AIAssistantUIBridge extends BaseScriptComponent {
  private static readonly DATE_HINT = 'dd/mm/yyyy or ddmmyyyy'

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
  @hint('Voice capture: assign PinchButton under Btn_VoiceMode_Placeholder. Pinch = welcome (once) + start/stop speech-to-text.')
  startAssistantButton: PinchButton

  @input
  @allowUndefined
  @hint('SIK Toggle on Btn_Mic: ON = muted (blocks capture), OFF = unmuted. Does not start STT.')
  micMuteToggle: ToggleButton

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
  @hint('Keyboard intake: assign PinchButton under Btn_Keyboard_Placeholder. Does not start the mic.')
  keyboardToggleButton: PinchButton

  @input
  @allowUndefined
  @hint('Pinch to confirm current keyboard text entry for active step. Shown only while keyboard mode is on (hidden during voice-only).')
  keyboardConfirmButton: PinchButton

  @input
  @allowUndefined
  @hint('Dedicated line for typed trip fields — assign VoiceListening_Status_Text (not PromptTitle, not VoiceHint).')
  keyboardEntryText: Text

  @input
  @allowUndefined
  @hint('Prompt/status line for keyboard step flow (use PromptSubtitle, not VoiceHint).')
  keyboardPromptText: Text

  @input
  @allowUndefined
  @hint('Optional panel root enabled only in keyboard mode.')
  keyboardModeRoot: SceneObject

  @input
  @hint('Enable if the KEYBOARD row runs voice and Voice row opens keyboard (overlapping prefabs / wrong drag-drop).')
  swapVoiceAndKeyboardPinchButtons: boolean = false

  @input
  @allowUndefined
  @hint('Pinch to clear trip draft, voice prefs, and plan widgets (fixes bad parses). Assign PinchButton on Btn_ClearInputs.')
  clearInputsButton: PinchButton

  private keyboardModeEnabled: boolean = false
  private keyboardStepIndex: number = 0
  private readonly keyboardSteps = ['departure city', 'destination city', 'departure date', 'arrival date']
  private keyboardOptions: any = null
  private textInputPrimed: boolean = false

  /** Fires whenever the keyboard step prompt line updates (for optional TTS via `AssistantTtsController`). */
  readonly onKeyboardGuidance: Event<string> = new Event<string>()

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.primeTextInputOptions()
      this.bindUi()
    })
  }

  private primeTextInputOptions(): void {
    if (this.textInputPrimed) {
      return
    }
    try {
      const g = global as any
      const TIS = g.TextInputSystem
      if (!TIS || !g.textInputSystem) {
        print('[AIAssistantUIBridge] textInputSystem unavailable in this host (use Spectacles device for AR keyboard).')
        return
      }
      const opts = new TIS.KeyboardOptions()
      opts.enablePreview = false
      opts.keyboardType = TIS.KeyboardType.Text
      opts.returnKeyType = TIS.ReturnKeyType.Done
      const self = this
      opts.onTextChanged = (text: string, _: vec2) => {
        if (self.keyboardEntryText && self.keyboardModeEnabled) {
          self.keyboardEntryText.text = text
        }
      }
      opts.onReturnKeyPressed = () => {
        self.dismissTripKeyboard()
      }
      opts.onKeyboardStateChanged = (_open: boolean) => {}
      this.keyboardOptions = opts
      this.textInputPrimed = true
    } catch (e) {
      print(`[AIAssistantUIBridge] primeTextInputOptions failed: ${e}`)
    }
  }

  private requestTripKeyboard(): void {
    this.primeTextInputOptions()
    const g = global as any
    if (!this.keyboardOptions || !g.textInputSystem) {
      this.setKeyboardPrompt('AR keyboard: build to Spectacles. Editor preview often has no textInputSystem.')
      return
    }
    if (this.keyboardEntryText) {
      this.keyboardEntryText.text = ''
    }
    print('[AIAssistantUIBridge] requestKeyboard for trip field entry')
    g.textInputSystem.requestKeyboard(this.keyboardOptions)
  }

  private dismissTripKeyboard(): void {
    const g = global as any
    if (g.textInputSystem) {
      try {
        g.textInputSystem.dismissKeyboard()
      } catch (_e) {}
    }
  }

  private bindUi(): void {
    if (!this.geminiAssistant) {
      this.setHint('GeminiAssistant is not assigned.')
      return
    }

    this.geminiAssistant.onTripDraftUpdated.add((draft: TripDraft) => {
      this.travelPlannerController?.syncFromTripDraft(draft)
    })
    this.geminiAssistant.onTripPlanReady.add(() => {
      if (this.asrQueryController) {
        this.asrQueryController.scheduleResumeListeningAfterTurn(this.keyboardModeEnabled)
      }
    })
    this.travelPlannerController?.syncFromTripDraft(this.geminiAssistant.getTripDraft())

    const voicePinch = this.swapVoiceAndKeyboardPinchButtons ? this.keyboardToggleButton : this.startAssistantButton
    const keyboardPinch = this.swapVoiceAndKeyboardPinchButtons ? this.startAssistantButton : this.keyboardToggleButton

    if (keyboardPinch) {
      keyboardPinch.onButtonPinched.add(() => {
        this.enterKeyboardMode()
      })
    }

    if (voicePinch) {
      voicePinch.onButtonPinched.add(() => {
        if (this.keyboardModeEnabled) {
          this.dismissTripKeyboard()
          this.keyboardModeEnabled = false
          this.updateKeyboardUi()
          this.setKeyboardPrompt('Voice mode ON. Keyboard flow paused.')
        }
        const wasRecording = this.asrQueryController?.getIsRecording() ?? false
        const micMuted = this.asrQueryController?.getMicMuted() ?? false
        if (!wasRecording && !micMuted) {
          const line = this.geminiAssistant.beginAssistantSessionFromContext()
          this.setHint(line)
        }
        this.asrQueryController?.toggleRecording()
      })
    } else if (!keyboardPinch) {
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

    if (this.micMuteToggle && this.asrQueryController) {
      this.micMuteToggle.onStateChanged.add((isToggledOn: boolean) => {
        const wantMuted = isToggledOn
        const muted = this.asrQueryController.getMicMuted()
        if (wantMuted && !muted) {
          this.asrQueryController.toggleMicMuted()
        } else if (!wantMuted && muted) {
          this.asrQueryController.toggleMicMuted()
        }
      })
    }

    if (this.keyboardConfirmButton) {
      this.keyboardConfirmButton.onButtonPinched.add(() => {
        this.confirmKeyboardStep()
      })
    }

    if (this.clearInputsButton) {
      this.clearInputsButton.onButtonPinched.add(() => {
        this.keyboardModeEnabled = false
        this.keyboardStepIndex = 0
        this.dismissTripKeyboard()
        if (this.asrQueryController && this.asrQueryController.getIsRecording()) {
          this.asrQueryController.toggleRecording()
        }
        this.geminiAssistant?.resetTripDraft()
        this.setHint('Inputs cleared. Pinch Voice Mode to start again.')
        if (this.geminiAssistant && this.travelPlannerController) {
          this.travelPlannerController.syncFromTripDraft(this.geminiAssistant.getTripDraft())
        }
        this.updateKeyboardUi()
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
    this.setHint(query.trim())

    const triggersPlan =
      normalized.indexOf('plan my trip') >= 0 ||
      normalized.indexOf('show options') >= 0 ||
      normalized.indexOf('find options') >= 0
    if (triggersPlan) {
      this.geminiAssistant.requestTripPlan()
    }

    const skipAutoResume = this.keyboardModeEnabled || triggersPlan
    if (this.asrQueryController) {
      this.asrQueryController.scheduleResumeListeningAfterTurn(skipAutoResume)
    }
  }

  private setHint(message: string): void {
    if (this.hintText) {
      this.hintText.text = message
    }
  }

  private enterKeyboardMode(): void {
    if (this.asrQueryController && this.asrQueryController.getIsRecording()) {
      this.asrQueryController.toggleRecording()
    }
    this.setHint('')
    this.dismissTripKeyboard()
    this.keyboardModeEnabled = true
    this.keyboardStepIndex = 0
    if (this.keyboardEntryText) {
      this.keyboardEntryText.text = ''
    }
    this.setKeyboardPrompt('Keyboard mode ON. Enter departure city, then pinch Confirm.')
    this.updateKeyboardUi()
    this.requestTripKeyboard()
  }

  private updateKeyboardUi(): void {
    if (this.keyboardModeRoot) {
      this.keyboardModeRoot.enabled = this.keyboardModeEnabled
    }
    this.setKeyboardConfirmVisible(this.keyboardModeEnabled)
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
      this.requestTripKeyboard()
      return
    }
    const draft = this.geminiAssistant.getTripDraft()
    if (this.keyboardStepIndex === 0) {
      draft.departureCity = entry
    } else if (this.keyboardStepIndex === 1) {
      draft.destinationCity = entry
    } else if (this.keyboardStepIndex === 2) {
      const normalizedDate = this.normalizeDateToDdMmYyyy(entry)
      if (!normalizedDate) {
        this.setKeyboardPrompt(`Use ${AIAssistantUIBridge.DATE_HINT} for departure date (example: 15/05/2026 or 15052026).`)
        this.requestTripKeyboard()
        return
      }
      draft.departureDateTime = normalizedDate
    } else if (this.keyboardStepIndex === 3) {
      const normalizedDate = this.normalizeDateToDdMmYyyy(entry)
      if (!normalizedDate) {
        this.setKeyboardPrompt(`Use ${AIAssistantUIBridge.DATE_HINT} for arrival date (example: 20/05/2026 or 20052026).`)
        this.requestTripKeyboard()
        return
      }
      draft.arrivalDateTime = normalizedDate
    }
    this.geminiAssistant.notifyTripDraftChanged()
    if (this.keyboardEntryText) {
      this.keyboardEntryText.text = ''
    }
    this.keyboardStepIndex++
    if (this.keyboardStepIndex >= this.keyboardSteps.length) {
      this.setKeyboardPrompt('All keyboard fields captured. Pinch Plan Trip anytime.')
      this.keyboardModeEnabled = false
      this.dismissTripKeyboard()
      this.updateKeyboardUi()
      return
    }
    this.updateKeyboardUi()
    this.scheduleKeyboardRefocusAfterStep()
  }

  private setKeyboardPrompt(message: string): void {
    if (this.keyboardPromptText) {
      this.keyboardPromptText.text = message
    } else {
      this.setHint(message)
    }
    if (message && message.length > 0) {
      this.onKeyboardGuidance.invoke(message)
    }
  }

  /**
   * Confirm is keyboard-only: hide/disable the PinchButton unless keyboard flow is active
   * so it does not sit on screen during voice-only use.
   */
  private setKeyboardConfirmVisible(visible: boolean): void {
    if (!this.keyboardConfirmButton) {
      return
    }
    try {
      this.keyboardConfirmButton.getSceneObject().enabled = visible
    } catch (e) {
      print(`[AIAssistantUIBridge] setKeyboardConfirmVisible: ${e}`)
    }
  }

  /**
   * Dismiss then re-open the AR keyboard after a short delay so the OS buffer does not
   * repopulate the previous step's text (e.g. "Tokyo" still showing on the date step).
   */
  private scheduleKeyboardRefocusAfterStep(): void {
    this.dismissTripKeyboard()
    if (this.keyboardEntryText) {
      this.keyboardEntryText.text = ''
    }
    const delayed = this.createEvent('DelayedCallbackEvent')
    delayed.bind(() => {
      if (this.keyboardModeEnabled) {
        this.requestTripKeyboard()
      }
    })
    delayed.reset(0.12)
  }

  /** Accepts `dd/mm/yyyy` or eight digits `ddmmyyyy` → normalized `dd/mm/yyyy`. */
  private normalizeDateToDdMmYyyy(raw: string): string | null {
    const value = raw.trim()
    const slash = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (slash) {
      const day = parseInt(slash[1], 10)
      const month = parseInt(slash[2], 10)
      if (!this.isPlausibleDayMonth(day, month)) {
        return null
      }
      return `${slash[1]}/${slash[2]}/${slash[3]}`
    }
    const compact = value.match(/^(\d{8})$/)
    if (!compact) {
      return null
    }
    const s = compact[1]
    const dd = s.substring(0, 2)
    const mm = s.substring(2, 4)
    const yyyy = s.substring(4, 8)
    const day = parseInt(dd, 10)
    const month = parseInt(mm, 10)
    if (!this.isPlausibleDayMonth(day, month)) {
      return null
    }
    return `${dd}/${mm}/${yyyy}`
  }

  private isPlausibleDayMonth(day: number, month: number): boolean {
    return day >= 1 && day <= 31 && month >= 1 && month <= 12
  }
}
