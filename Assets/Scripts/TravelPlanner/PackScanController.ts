import { PinchButton } from 'SpectaclesInteractionKit.lspkg/Components/UI/PinchButton/PinchButton'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { Gemini } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAI'
import { GoogleGenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes'
import { VideoController } from 'RemoteServiceGateway.lspkg/Helpers/VideoController'
import { GeminiAssistant } from './GeminiAssistant'

type PackScanState = 'idle' | 'open' | 'sending'

/**
 * Pack scan orchestrator backed by the **CropCameraTexture** Asset Library package.
 *
 * Camera lifecycle is owned by `Packages/CropCameraTexture.lspkg/Scripts/CameraTexture.ts`,
 * which starts on `OnStartEvent` and drives an Image with the cropped texture every frame.
 * This controller only:
 *   1. Toggles the visibility of the package's preview SceneObject so the camera viewfinder is
 *      hidden until the user pinches **Scan Pack** and is hidden again on **Close**.
 *   2. Reads `originalCameraTexture` (full frame) or `cropCameraTexture` (cropped) at capture
 *      time and pipes it through RSG `VideoController` → base64 JPEG → Gemini Vision.
 *   3. Mirrors the result into the inline HUD text **and** the persistent detail-panel text so
 *      tapping the Pack category row after Close still surfaces the last scan.
 *
 * Two trigger points for Pack details (both already work):
 *   - Pinch **`scanButton`** → opens the scan session (this controller).
 *   - Tap the **Pack category title** (handled by `CategoryPlanDetailController`) → opens the
 *     Pack HUD and the detail panel; the last scan result is preserved in `detailBodyText`.
 *
 * State machine (`idle | open | sending` with sub-flag `cropMode`):
 *   idle    ── Scan Pack ──▶ open(full)
 *   open(full) ── Crop Scan ─▶ open(crop)       (hide live preview, show crop hint)
 *   open(crop) ── Crop Scan ─▶ open(full)       (re-show preview, hide crop hint)
 *   open(*)  ── Capture ────▶ sending ──▶ idle  (camera display hidden, result written)
 *   open(*)  ── Scan Pack ──▶ open(full)        (restart, overwrites previous text on capture)
 *   any     ── Close ──────▶ idle               (detail panel keeps the last result)
 */
@component
export class PackScanController extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint('Trip context source (destination, dates, purpose).')
  geminiAssistant: GeminiAssistant

  @input
  @allowUndefined
  @hint('Pinch button that opens the Pack scan session.')
  scanButton: PinchButton

  @input
  @allowUndefined
  @hint('Pinch button shown while a session is open. Snapshots the current view to Gemini Vision.')
  captureButton: PinchButton

  @input
  @allowUndefined
  @hint('Pinch button that toggles Crop mode (hides the live preview, shows the crop hint).')
  cropScanButton: PinchButton

  @input
  @allowUndefined
  @hint('Pinch button that closes the scan session, releases the preview, and clears the HUD inline text.')
  closeButton: PinchButton

  @input
  @allowUndefined
  @hint('Pack HUD root. Scan is gated to only run when this HUD is enabled.')
  packScanHud: SceneObject

  @input
  @allowUndefined
  @hint('Main inline text inside Pack HUD. Cleared by Close; latest result is mirrored to detailBodyText.')
  packHudText: Text

  @input
  @allowUndefined
  @hint('Persistent Pack detail text. Preserved across Close and the next time the category row is tapped.')
  detailBodyText: Text

  @input
  @allowUndefined
  @hint('Optional Text of items the user typed (kept for text-only fallback). Do NOT point at keyboard entry text.')
  observedItemsText: Text

  @input
  @allowUndefined
  @hint('SceneObject of the CropCameraTexture package preview (e.g. `CropCameraTextureTS`). Toggled visible while a session is open.')
  cameraPreviewRoot: SceneObject

  @input
  @allowUndefined
  @hint('Original camera Texture from the package (Device Camera Texture). Used for full-frame capture.')
  originalCameraTexture: Texture

  @input
  @allowUndefined
  @hint('Cropped camera Texture from the package (Screen Crop Texture). Used for cropped capture.')
  cropCameraTexture: Texture

  @input
  @allowUndefined
  @hint('Optional UI root for the Crop hint (text / dotted overlay). Shown only in Crop mode.')
  cropHintRoot: SceneObject

  @input
  @hint('Gemini model for pack-check generation. gemini-2.0-flash supports inlineData images.')
  geminiModel: string = 'gemini-2.0-flash'

  @input
  @hint('Capture interval (ms) hint for the VideoController used during a one-shot snapshot.')
  captureIntervalMs: number = 250

  @input
  @hint('Enable PackScanController logs.')
  verboseLogs: boolean = true

  private readonly log = new NativeLogger('PackScanController')
  private state: PackScanState = 'idle'
  private cropMode: boolean = false
  private pendingCapture: VideoController | null = null

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.bindUi()
      this.applyIdleVisibility()
      this.tripLog(
        'PackScanController ready. Idle until user pinches Scan Pack. Camera is owned by CropCameraTexture.lspkg.',
      )
    })
  }

  private bindUi(): void {
    if (this.scanButton) {
      this.scanButton.onButtonPinched.add(() => this.onScanPack())
    } else {
      this.tripLog('scanButton not assigned — Scan Pack pinch will not trigger.')
    }
    if (this.captureButton) {
      this.captureButton.onButtonPinched.add(() => this.onCapture())
    }
    if (this.cropScanButton) {
      this.cropScanButton.onButtonPinched.add(() => this.onCropScanToggle())
    }
    if (this.closeButton) {
      this.closeButton.onButtonPinched.add(() => this.onClose())
    }
  }

  // ─── Button handlers ───────────────────────────────────────────────────────

  private onScanPack(): void {
    if (!this.packScanHud || !this.packScanHud.enabled) {
      this.tripLog('Scan Pack ignored: packScanHud is not enabled (open the Pack category row first).')
      return
    }
    if (this.state === 'sending') {
      this.tripLog('Scan Pack ignored while previous scan is still sending.')
      return
    }
    this.state = 'open'
    this.cropMode = false
    this.applyOpenVisibility()
    this.tripLog('Scan session opened in FullFrame mode.')
  }

  private onCropScanToggle(): void {
    if (this.state !== 'open') {
      this.tripLog('Crop Scan ignored: scan session is not open.')
      return
    }
    this.cropMode = !this.cropMode
    this.applyOpenVisibility()
    this.tripLog(`Crop mode ${this.cropMode ? 'ON (live preview hidden, capture targets crop texture)' : 'OFF (live preview visible)'}.`)
  }

  private onCapture(): void {
    if (this.state !== 'open') {
      this.tripLog('Capture ignored: scan session is not open.')
      return
    }
    const source = this.cropMode ? this.cropCameraTexture : this.originalCameraTexture
    if (!source) {
      const label = this.cropMode ? 'cropCameraTexture' : 'originalCameraTexture'
      this.tripLog(`Capture: ${label} not assigned. Falling back to text-only.`)
      this.submitTextOnly('Camera frame unavailable; using text-only pack check.')
      return
    }
    this.snapshotAndSend(source, this.cropMode ? 'cropped' : 'full-frame')
  }

  private onClose(): void {
    if (this.pendingCapture) {
      try {
        this.pendingCapture.stopRecording()
      } catch (e) {
        this.log.e(`pendingCapture.stopRecording: ${e}`)
      }
      this.pendingCapture = null
    }
    this.state = 'idle'
    this.cropMode = false
    this.applyIdleVisibility()
    this.setHudText('')
    this.tripLog('Scan session closed; detail-panel mirror preserved.')
  }

  // ─── Visibility helpers ────────────────────────────────────────────────────

  private applyIdleVisibility(): void {
    this.setCameraPreviewVisible(false)
    this.setCropHintVisible(false)
    this.setButtonVisible(this.captureButton, false)
    this.setButtonVisible(this.cropScanButton, false)
    this.setButtonVisible(this.closeButton, false)
    this.setButtonVisible(this.scanButton, true)
  }

  private applyOpenVisibility(): void {
    if (this.cropMode) {
      this.setCameraPreviewVisible(false)
      this.setCropHintVisible(true)
    } else {
      this.setCameraPreviewVisible(true)
      this.setCropHintVisible(false)
    }
    this.setButtonVisible(this.captureButton, true)
    this.setButtonVisible(this.cropScanButton, true)
    this.setButtonVisible(this.closeButton, true)
    this.setButtonVisible(this.scanButton, true)
  }

  private applySendingVisibility(): void {
    this.setCameraPreviewVisible(false)
    this.setCropHintVisible(false)
    this.setButtonVisible(this.captureButton, false)
    this.setButtonVisible(this.cropScanButton, false)
    this.setButtonVisible(this.closeButton, true)
    this.setButtonVisible(this.scanButton, false)
  }

  private setCameraPreviewVisible(visible: boolean): void {
    if (this.cameraPreviewRoot) {
      this.cameraPreviewRoot.enabled = visible
    }
  }

  private setCropHintVisible(visible: boolean): void {
    if (this.cropHintRoot) {
      this.cropHintRoot.enabled = visible
    }
  }

  private setButtonVisible(button: PinchButton | undefined, visible: boolean): void {
    if (!button) {
      return
    }
    try {
      const obj = button.getSceneObject()
      if (obj) {
        obj.enabled = visible
      }
    } catch (e) {
      this.log.e(`setButtonVisible failed: ${e}`)
    }
  }

  // ─── Capture pipeline ──────────────────────────────────────────────────────

  /**
   * Encodes one frame from `source` to base64 JPEG via RSG VideoController, sends to Gemini
   * Vision, then renders the response. Releases the recorder regardless of outcome.
   */
  private snapshotAndSend(source: Texture, label: string): void {
    if (this.state === 'sending') {
      return
    }
    this.state = 'sending'
    this.applySendingVisibility()
    this.setHudText(`Analyzing ${label}…`)

    let video: VideoController
    try {
      video = new VideoController(this.captureIntervalMs, CompressionQuality.HighQuality, EncodingType.Jpg)
    } catch (e) {
      this.log.e(`VideoController init failed: ${e}`)
      this.submitTextOnly('Could not create frame encoder; using text-only pack check.')
      return
    }
    this.pendingCapture = video

    const onFrameOnce = (base64: string) => {
      try {
        video.stopRecording()
      } catch (e) {
        this.log.e(`stopRecording: ${e}`)
      }
      this.pendingCapture = null
      if (!base64 || base64.length === 0) {
        this.log.e('VideoController emitted empty base64 frame.')
        this.submitTextOnly('Captured frame was empty; falling back to text-only.')
        return
      }
      this.submitVisionScan(base64)
    }

    try {
      video.onEncodedFrame.add(onFrameOnce)
    } catch (e) {
      this.log.e(`VideoController.onEncodedFrame.add: ${e}`)
      this.submitTextOnly('Frame encoder not available; using text-only.')
      return
    }

    try {
      const recorder = video as any
      if (recorder && typeof recorder.setSourceTexture === 'function') {
        recorder.setSourceTexture(source)
      } else if (recorder && typeof recorder.setInputTexture === 'function') {
        recorder.setInputTexture(source)
      } else if (recorder && 'sourceTexture' in recorder) {
        recorder.sourceTexture = source
      } else if (recorder && 'inputTexture' in recorder) {
        recorder.inputTexture = source
      }
    } catch (e) {
      this.log.e(`Could not set VideoController source: ${e}`)
    }

    try {
      video.startRecording()
    } catch (e) {
      this.log.e(`startRecording: ${e}`)
      this.submitTextOnly('Frame encoder could not start; using text-only.')
    }
  }

  private submitVisionScan(base64Jpeg: string): void {
    const prompt = this.buildPackPrompt()
    const request = {
      model: this.geminiModel,
      type: 'generateContent',
      body: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: 'image/jpeg', data: base64Jpeg } } as any,
            ] as any,
          },
        ] as any,
        generationConfig: { temperature: 0.2 },
      },
    } as unknown as GoogleGenAITypes.Gemini.Models.GenerateContentRequest

    Gemini.models(request)
      .then((response) => this.applyResponse(response, 'image+text'))
      .catch((error) => {
        this.log.e(`Gemini.models vision call failed: ${error}`)
        this.submitTextOnly('Vision scan failed; falling back to text-only pack check.')
      })
  }

  private submitTextOnly(statusLine: string): void {
    this.state = 'sending'
    this.applySendingVisibility()
    this.setHudText(statusLine)
    const prompt = this.buildPackPrompt()
    const request: GoogleGenAITypes.Gemini.Models.GenerateContentRequest = {
      model: this.geminiModel,
      type: 'generateContent',
      body: {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: { temperature: 0.2 },
      },
    }
    Gemini.models(request)
      .then((response) => this.applyResponse(response, 'text-only'))
      .catch((error) => {
        this.log.e(`Gemini.models text-only call failed: ${error}`)
        this.setHudText('Pack scan failed. Check RSG token and connectivity.')
        this.state = 'idle'
        this.applyIdleVisibility()
      })
  }

  private applyResponse(response: any, source: string): void {
    const text = this.extractText(response)
    if (!text || text.length === 0) {
      this.setHudText('No scan response. Try again.')
      this.state = 'idle'
      this.applyIdleVisibility()
      return
    }
    const compact = text.trim()
    this.setHudText(`Pack scan (${source})\n${compact}`)
    if (this.detailBodyText) {
      this.detailBodyText.text = `— Pack (${source}) —\n\n${compact}`
    }
    this.state = 'idle'
    this.cropMode = false
    this.applyIdleVisibility()
  }

  // ─── Prompt + response helpers ─────────────────────────────────────────────

  private buildPackPrompt(): string {
    const observed = this.observedItemsText ? this.observedItemsText.text.trim() : ''
    const draft = this.geminiAssistant ? this.geminiAssistant.getTripDraft() : null

    const tripContext = draft
      ? `Destination: ${draft.destinationCity || '-'}, Depart: ${draft.departureDateTime || '-'}, Arrive: ${draft.arrivalDateTime || '-'}, Purpose: ${draft.purpose}`
      : 'Trip context unavailable.'

    const observedLine =
      observed.length > 0
        ? `Observed packed items (user-provided): ${observed}`
        : 'Observed packed items unavailable.'

    return [
      'You are a practical packing assistant analyzing a photo of someone\'s travel bag (or a cropped region).',
      tripContext,
      observedLine,
      'When the image is provided, ground every observation in items you can actually see. Do not invent items.',
      'Return concise plain text with 3 short sections, separated by blank lines:',
      '1) Good to go (items you see that suit the trip)',
      '2) Missing or risky (gaps for destination weather, dress code, regulations)',
      '3) Quick additions (small, high-value items worth adding)',
      'Keep under 8 short bullet points total.',
    ].join('\n')
  }

  private extractText(response: any): string {
    try {
      const candidates = response && response.candidates
      if (!candidates || candidates.length === 0) {
        return ''
      }
      const parts = candidates[0].content && candidates[0].content.parts
      if (!parts || parts.length === 0) {
        return ''
      }
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        if (p && typeof p.text === 'string' && p.text.length > 0) {
          return p.text
        }
      }
    } catch (e) {
      this.log.e(`extractText failed: ${e}`)
    }
    return ''
  }

  // ─── UI helpers ────────────────────────────────────────────────────────────

  private setHudText(message: string): void {
    if (this.packHudText) {
      this.packHudText.text = message
    }
  }

  private tripLog(message: string): void {
    if (this.verboseLogs) {
      this.log.i(message)
    }
  }
}
