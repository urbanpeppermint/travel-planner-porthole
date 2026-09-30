import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { OpenAI } from 'RemoteServiceGateway.lspkg/HostedExternal/OpenAI'
import { OpenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/OpenAITypes'
import { AIAssistantUIBridge } from './AIAssistantUIBridge'
import { CategoryPlanDetailController } from './CategoryPlanDetailController'
import { GeminiAssistant } from './GeminiAssistant'

/**
 * Optional **OpenAI TTS** (Remote Service Gateway) for hands-free guidance:
 * - **Keyboard**: speaks `AIAssistantUIBridge` keyboard step prompts (e.g. “Enter departure date…”).
 * - **Voice**: speaks `GeminiAssistant` status lines that guide missing fields / welcome
 *   (`onPromptGenerated`), while skipping noisy technical errors and long debug strings.
 * - **Category row**: speaks the beta detail body when a planning category title is pinched
 *   (`onCategoryDetailBody`). **`onBeforeCategoryDetailChange`** cancels any in-flight TTS when the user
 *   opens another category, collapses the panel, or the plan refreshes.
 *
 * Requires **OpenAI** API token on `RemoteServiceGatewayCredentials` (same as ExampleOAICalls).
 * If TTS fails (no token, network), errors are logged only — text UI is unchanged.
 *
 * Add this component next to `GeminiAssistant` / `AIAssistantUIBridge`, assign references,
 * and place or reference a SceneObject that will host an **AudioComponent** (created lazily
 * if missing), per RSG `ExampleOAICalls.doSpeechGeneration`.
 */
@component
export class AssistantTtsController extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint('Trip assistant whose status / missing-field prompts are spoken in voice mode.')
  geminiAssistant: GeminiAssistant

  @input
  @allowUndefined
  @hint('UI bridge whose keyboard prompts are spoken while keyboard flow is active.')
  uiBridge: AIAssistantUIBridge

  @input
  @allowUndefined
  @hint('When assigned, speaks category info-card copy after each category title pinch.')
  categoryPlanDetailController: CategoryPlanDetailController

  @input
  @allowUndefined
  @hint('SceneObject that plays TTS (gets or creates AudioComponent). Defaults to this object.')
  audioOutputRoot: SceneObject

  @input
  @hint('Master switch for all TTS.')
  enableTts: boolean = true

  @input
  @hint('Speak keyboard step prompts from the bridge.')
  speakKeyboardGuidance: boolean = true

  @input
  @hint('Speak GeminiAssistant status / guidance lines (missing fields, welcome, etc.).')
  speakVoiceGuidance: boolean = true

  @input
  @hint('Speak multi-line category detail when user opens a category row (info card).')
  speakCategoryDetail: boolean = true

  @input
  @hint('OpenAI speech model (e.g. tts-1, tts-1-hd, gpt-4o-mini-tts).')
  ttsModel: string = 'tts-1'

  @input
  @hint('OpenAI TTS voice (e.g. nova, alloy, shimmer).')
  ttsVoice: string = 'nova'

  @input
  @hint('Debounce rapid text updates before calling the API (seconds).')
  debounceSec: number = 0.45

  @input
  @hint('Max characters for voice status / welcome / questions (truncated before TTS).')
  maxSpeakChars: number = 900

  @input
  @hint('Max characters for category info-card TTS (longer than status lines).')
  maxCategoryDetailSpeakChars: number = 2400

  @input
  @hint('Log TTS lifecycle / errors.')
  verboseLogs: boolean = true

  private readonly log = new NativeLogger('AssistantTtsController')
  private audioComponent: AudioComponent | null = null
  private debounceToken: number = 0
  /** Bumped when cancelling so late OpenAI.speech callbacks do not play over a newer intent. */
  private playbackGeneration: number = 0
  private pendingText: string = ''

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      if (this.geminiAssistant && this.speakVoiceGuidance) {
        this.geminiAssistant.onPromptGenerated.add((line: string) => {
          if (!this.enableTts || !this.speakVoiceGuidance) {
            return
          }
          if (!this.shouldSpeakVoiceLine(line)) {
            return
          }
          this.queueSpeak(line)
        })
      }
      if (this.uiBridge && this.speakKeyboardGuidance) {
        this.uiBridge.onKeyboardGuidance.add((line: string) => {
          if (!this.enableTts || !this.speakKeyboardGuidance) {
            return
          }
          if (line.indexOf('AR keyboard: build') >= 0 || line.indexOf('Editor preview') >= 0) {
            return
          }
          this.queueSpeak(line)
        })
      }
      if (this.categoryPlanDetailController) {
        this.categoryPlanDetailController.onBeforeCategoryDetailChange.add(() => {
          this.cancelAllSpeech()
        })
        if (this.speakCategoryDetail) {
          this.categoryPlanDetailController.onCategoryDetailBody.add((body: string) => {
            if (!this.enableTts || !this.speakCategoryDetail) {
              return
            }
            if (!body || body.trim().length === 0) {
              this.cancelAllSpeech()
              return
            }
            this.queueSpeakCategoryBody(body)
          })
        }
      }
      if (this.verboseLogs) {
        this.log.i(
          'AssistantTtsController: OpenAI token required on RemoteServiceGatewayCredentials for speech.',
        )
      }
    })
  }

  /** Stops playback, invalidates pending debounced TTS, and drops late OpenAI.speech responses. */
  private cancelAllSpeech(): void {
    this.playbackGeneration++
    this.debounceToken++
    this.pendingText = ''
    this.stopPlaybackSafe()
  }

  private stopPlaybackSafe(): void {
    try {
      const ac = this.audioComponent
      if (!ac) {
        return
      }
      if (ac.isPlaying()) {
        ac.stop(true)
      }
    } catch (e) {
      this.log.e(`stopPlaybackSafe: ${e}`)
    }
  }

  /** Skip logs, raw errors, and very long status dumps — keep conversational guidance only. */
  private shouldSpeakVoiceLine(raw: string): boolean {
    if (!raw || raw.trim().length === 0) {
      return false
    }
    const t = raw.trim()
    const low = t.toLowerCase()
    if (low.indexOf('gemini.models failed') >= 0) {
      return false
    }
    if (low.indexOf('returned no text') >= 0 || low.indexOf('not valid json') >= 0) {
      return false
    }
    if (low.indexOf('generating trip options') >= 0) {
      return false
    }
    if (low.indexOf('trip plan ready') >= 0 && t.length > 80) {
      return true
    }
    return true
  }

  private queueSpeakCategoryBody(raw: string): void {
    this.cancelAllSpeech()
    const cleaned = this.cleanCategoryBodyForSpeech(raw)
    if (cleaned.length === 0) {
      return
    }
    this.pendingText = cleaned
    const token = ++this.debounceToken
    const ev = this.createEvent('DelayedCallbackEvent')
    ev.bind(() => {
      if (token !== this.debounceToken) {
        return
      }
      this.speakNow(this.pendingText)
    })
    ev.reset(this.debounceSec > 0.05 ? this.debounceSec : 0.45)
  }

  private cleanCategoryBodyForSpeech(raw: string): string {
    let s = raw.replace(/https?:\/\/\S+/gi, ' ')
    s = s.replace(/—+/g, ', ')
    s = s.replace(/[›»]/g, ' ')
    s = s.replace(/\s*•\s*/g, '. ')
    s = s.replace(/\n+/g, '. ')
    s = s.replace(/\s+/g, ' ').trim()
    // Avoid TTS spelling "E-U-R"; speak amounts as "… euro" (after display normalization uses EUR).
    s = s.replace(/\bEUR\s*(\d{1,6})\s*-\s*EUR\s*(\d{1,6})\b/gi, '$1 to $2 euro')
    s = s.replace(/\bEUR(\d{1,6})\s*-\s*EUR(\d{1,6})\b/gi, '$1 to $2 euro')
    s = s.replace(/\bEUR\s*(\d{1,6})\b/gi, '$1 euro')
    s = s.replace(/\bEUR(\d{1,6})\b/gi, '$1 euro')
    s = s.replace(/\u20ac\s*(\d{1,6})\b/g, '$1 euro')
    const lim = Math.max(200, Math.floor(this.maxCategoryDetailSpeakChars))
    if (s.length > lim) {
      s = `${s.substring(0, lim - 1)}…`
    }
    return s
  }

  private queueSpeak(raw: string): void {
    const cleaned = this.cleanForSpeech(raw)
    if (cleaned.length === 0) {
      return
    }
    this.cancelAllSpeech()
    this.pendingText = cleaned
    const token = ++this.debounceToken
    const ev = this.createEvent('DelayedCallbackEvent')
    ev.bind(() => {
      if (token !== this.debounceToken) {
        return
      }
      this.speakNow(this.pendingText)
    })
    ev.reset(this.debounceSec > 0.05 ? this.debounceSec : 0.45)
  }

  private cleanForSpeech(raw: string): string {
    let s = raw.replace(/\s+/g, ' ').trim()
    if (s.length > this.maxSpeakChars) {
      s = s.substring(0, this.maxSpeakChars - 1) + '…'
    }
    return s
  }

  private speakNow(text: string): void {
    if (!text || text.length === 0) {
      return
    }
    const generation = this.playbackGeneration
    const req: OpenAITypes.Speech.Request = {
      model: this.ttsModel as OpenAITypes.Speech.Model,
      input: text,
      voice: this.ttsVoice as OpenAITypes.Speech.Voice,
      response_format: 'mp3',
    }
    OpenAI.speech(req)
      .then((track: AudioTrackAsset) => {
        if (generation !== this.playbackGeneration) {
          return
        }
        const ac = this.ensureAudioComponent()
        this.stopPlaybackSafe()
        ac.audioTrack = track
        ac.play(1)
        if (this.verboseLogs) {
          this.log.i(`TTS playing (${text.length} chars).`)
        }
      })
      .catch((err) => {
        this.log.e(`OpenAI.speech failed: ${err}`)
      })
  }

  private ensureAudioComponent(): AudioComponent {
    if (this.audioComponent) {
      return this.audioComponent
    }
    const root = this.audioOutputRoot ? this.audioOutputRoot : this.getSceneObject()
    const existing = root.getComponent('AudioComponent') as AudioComponent
    if (existing) {
      this.audioComponent = existing
      return existing
    }
    this.audioComponent = root.createComponent('AudioComponent') as AudioComponent
    return this.audioComponent
  }
}
