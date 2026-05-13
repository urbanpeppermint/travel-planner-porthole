import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'

/**
 * Speech capture helper: call **`toggleRecording()`** from `AIAssistantUIBridge` (Voice Mode pinch)
 * so welcome prompts and listen/stop stay in one place. Optional **`toggleMicMuted()`** from a separate mic pinch.
 *
 * When **`autoResumeListeningAfterUtterance`** is on, the mic opens again shortly after each **final**
 * transcript is delivered (hands-free follow-up like “plan my trip”) without another Voice pinch.
 */
@component
export class ASRQueryController extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint('Optional text field for listening/error status.')
  statusText: Text

  @input
  @allowUndefined
  @hint('Optional second line (e.g. VoiceHint) mirrored with listening/errors.')
  hintEchoText: Text

  @input
  @hint('After a final transcript is processed, start listening again without pinching Voice Mode.')
  autoResumeListeningAfterUtterance: boolean = true

  @input
  @hint('Seconds to wait before reopening the mic (lets ASR + UI settle).')
  autoResumeDelaySec: number = 0.28

  readonly onQueryEvent: Event<string> = new Event<string>()

  private asrModule: AsrModule = require('LensStudio:AsrModule')
  private isRecording: boolean = false
  /** When true, pinch-to-listen is blocked (safety mute); independent of Voice Mode welcome button. */
  private micMuted: boolean = false
  /** Cancels stale delayed resume when a new utterance schedules another resume. */
  private resumeScheduleToken: number = 0

  /** Toggle safety mute (bind from a separate Mic pinch/toggle in AIAssistantUIBridge). */
  toggleMicMuted(): boolean {
    this.micMuted = !this.micMuted
    if (this.micMuted && this.isRecording) {
      this.asrModule.stopTranscribing()
      this.isRecording = false
    }
    const msg = this.micMuted ? 'Mic muted — voice capture blocked.' : 'Mic unmuted — pinch Voice Mode to speak.'
    this.setStatus(msg, msg)
    return this.micMuted
  }

  getMicMuted(): boolean {
    return this.micMuted
  }

  getIsRecording(): boolean {
    return this.isRecording
  }

  /**
   * Called from the UI bridge after handling a final transcript. When `skip` is true (e.g. trip plan
   * just started, or keyboard mode), no auto-resume is scheduled — use `onTripPlanReady` to resume later.
   */
  scheduleResumeListeningAfterTurn(skip: boolean): void {
    if (skip || this.micMuted || !this.autoResumeListeningAfterUtterance) {
      return
    }
    this.resumeScheduleToken++
    const token = this.resumeScheduleToken
    const ev = this.createEvent('DelayedCallbackEvent')
    ev.bind(() => {
      if (token !== this.resumeScheduleToken || this.micMuted || this.isRecording) {
        return
      }
      this.startTranscribingInternal()
    })
    ev.reset(this.autoResumeDelaySec)
  }

  toggleRecording(): void {
    if (this.micMuted) {
      this.setStatus('Mic is muted. Use mic toggle to unmute, then pinch Voice Mode.', 'Mic muted.')
      return
    }

    if (this.isRecording) {
      this.resumeScheduleToken++
      this.asrModule.stopTranscribing()
      this.isRecording = false
      this.setStatus('Stopped listening.', false)
      return
    }

    this.startTranscribingInternal()
  }

  private startTranscribingInternal(): void {
    if (this.micMuted || this.isRecording) {
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
      if (text.length > 0) {
        this.setStatus(`Heard: ${text}`, text)
      } else {
        this.setStatus('No speech detected.', '')
      }
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
      this.setStatus(`ASR error: ${errorData}${hint}`, 'ASR error — see subtitle.')
      print(`[ASRQueryController] onTranscriptionErrorEvent: ${errorData}`)
    })

    this.isRecording = true
    print('[ASRQueryController] startTranscribing')
    this.setStatus('Listening…', false)
    this.asrModule.startTranscribing(asrSettings)
  }

  /**
   * @param hintLine `false` = update subtitle only (do not touch VoiceHint). `string` = that text on VoiceHint.
   *        `undefined` = mirror `message` onto VoiceHint (used for mute lines / errors).
   */
  private setStatus(message: string, hintLine?: string | false): void {
    if (this.statusText) {
      this.statusText.text = message
    }
    if (!this.hintEchoText) {
      return
    }
    if (hintLine === false) {
      return
    }
    this.hintEchoText.text = hintLine !== undefined ? hintLine : message
  }
}
