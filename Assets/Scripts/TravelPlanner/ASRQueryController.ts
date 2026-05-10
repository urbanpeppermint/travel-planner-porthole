import { PinchButton } from 'SpectaclesInteractionKit.lspkg/Components/UI/PinchButton/PinchButton'
import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'

@component
export class ASRQueryController extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint('Pinch button used to start/stop transcription.')
  button: PinchButton

  @input
  @allowUndefined
  @hint('Optional text field for listening/error status.')
  statusText: Text

  readonly onQueryEvent: Event<string> = new Event<string>()

  private asrModule: AsrModule = require('LensStudio:AsrModule')
  private isRecording: boolean = false

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      if (!this.button) {
        return
      }
      this.button.onButtonPinched.add(() => {
        this.toggleRecording()
      })
    })
  }

  toggleRecording(): void {
    if (this.isRecording) {
      this.asrModule.stopTranscribing()
      this.isRecording = false
      this.setStatus('Stopped listening.')
      return
    }

    const asrSettings = AsrModule.AsrTranscriptionOptions.create()
    asrSettings.mode = AsrModule.AsrMode.HighAccuracy
    asrSettings.silenceUntilTerminationMs = 1500

    asrSettings.onTranscriptionUpdateEvent.add((asrOutput) => {
      if (!asrOutput.isFinal) {
        return
      }
      this.isRecording = false
      this.asrModule.stopTranscribing()
      const text = asrOutput.text || ''
      this.setStatus(text.length > 0 ? `Heard: ${text}` : 'No speech detected.')
      if (text.length > 0) {
        this.onQueryEvent.invoke(text)
      }
    })

    asrSettings.onTranscriptionErrorEvent.add((errorData) => {
      this.isRecording = false
      const device = global.deviceInfoSystem
      const inEditor = device && device.isEditor && device.isEditor()
      const hint = inEditor
        ? ' (ASR is unreliable in Lens Studio preview — test on device, or use Plan Trip without voice.)'
        : ''
      this.setStatus(`ASR error: ${errorData}${hint}`)
      print(`[ASRQueryController] onTranscriptionErrorEvent: ${errorData}`)
    })

    this.isRecording = true
    this.setStatus('Listening...')
    this.asrModule.startTranscribing(asrSettings)
  }

  private setStatus(message: string): void {
    if (this.statusText) {
      this.statusText.text = message
    }
  }
}
