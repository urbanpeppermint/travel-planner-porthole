import { PinchButton } from 'SpectaclesInteractionKit.lspkg/Components/UI/PinchButton/PinchButton'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { Gemini } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAI'
import { GoogleGenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes'
import { VideoController } from 'RemoteServiceGateway.lspkg/Helpers/VideoController'
import { GeminiAssistant } from './GeminiAssistant'
import { CategoryPlanDetailController } from './CategoryPlanDetailController'
import { WeatherAccuBridge } from './WeatherAccuBridge'

type PackScanState = 'idle' | 'open' | 'sending'

/**
 * Pack scan: **Scan Pack** opens a session (Capture + Close; optional live preview), **Capture**
 * sends one frame from `originalCameraTexture` to Gemini Vision. **Live preview defaults on**
 * so users see the capture frame on-screen; turn **`showLiveCameraPreview`** off if you prefer passthrough-only.
 * All pack status + results go to **`packScanResultText`** when set, otherwise **`detailBodyText`**.
 * If your result `Text` lives under **`packScanHud`**, never let another script disable that HUD while
 * results are shown — `CategoryPlanDetailController` no longer disables `packScanHud` on trip refresh.
 *
 * **Two-line UI:** assign **`categoryPlanDetailBodyText`** to the same `Text` as
 * `CategoryPlanDetailController.detailBodyText`, and **`packScanDetailText`** on the category controller
 * to **`packScanResultText`**. Opening **Scan Pack** clears the category line; opening **any category row**
 * clears the scan line — no overlapping parents, only empty-string swaps.
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
  @hint('Pinch button shown while a session is open. Snapshots the camera frame to Gemini Vision.')
  captureButton: PinchButton

  @input
  @allowUndefined
  @hint('Pinch button that closes the scan session (capture UI only; pack result `Text` unchanged).')
  closeButton: PinchButton

  @input
  @allowUndefined
  @hint('Pack HUD root. Scan is gated to only run when this HUD is enabled.')
  packScanHud: SceneObject

  @input
  @allowUndefined
  @hint('Deprecated — unused for output. Assign `packScanResultText` or `detailBodyText` instead.')
  packHudText: Text

  @input
  @allowUndefined
  @hint('Optional dedicated pack scan output (e.g. `ScanDetail_Text_Body`). If set, all pack lines write here only and trip-plan detail clear will not race this `Text`.')
  packScanResultText: Text

  @input
  @allowUndefined
  @hint('Category detail body when not using `packScanResultText` (e.g. `CategoryDetail_Text`).')
  detailBodyText: Text

  @input
  @allowUndefined
  @hint('SceneObject to enable before writing `detailBodyText` / `packScanResultText` (e.g. parent card or `PackScanHUD_Placeholder` when the scan text lives under the pack HUD).')
  categoryDetailPanelRoot: SceneObject

  @input
  @allowUndefined
  @hint('Optional Text of items the user typed (kept for text-only fallback). Do NOT point at keyboard entry text.')
  observedItemsText: Text

  @input
  @allowUndefined
  @hint('Optional live camera preview root (e.g. CropCameraTexture prefab). Shown while a session is open when `showLiveCameraPreview` is on.')
  cameraPreviewRoot: SceneObject

  @input
  @hint('Show `cameraPreviewRoot` during an open scan session (including while analyzing after Capture). Off = no on-screen camera panel.')
  showLiveCameraPreview: boolean = true

  @input
  @allowUndefined
  @hint('Texture used for JPEG capture (often Crop package output). Preview panel does not require this to be set; Capture does.')
  originalCameraTexture: Texture

  @input
  @allowUndefined
  @hint('Optional AccuWeather bridge — last summary is passed into the prompt so "Suggested additions" can follow real conditions.')
  weatherAccuBridge: WeatherAccuBridge

  @input
  @hint('Gemini model for pack-check generation. gemini-2.0-flash supports inlineData images.')
  geminiModel: string = 'gemini-2.0-flash'

  @input
  @hint('Capture interval (ms) hint for the VideoController used during a one-shot snapshot.')
  captureIntervalMs: number = 250

  @input
  @hint('Enable PackScanController logs.')
  verboseLogs: boolean = true

  @input
  @hint('In Lens Studio editor preview, skip VideoController (camera JPEG encode) and use text-only pack — avoids frequent editor native crashes when the scan result appears.')
  skipCameraEncodeInEditor: boolean = true

  @input
  @allowUndefined
  @hint('Same `Text` as CategoryPlanDetailController.detailBodyText (e.g. CategoryDetail_Text). Cleared when Scan Pack opens so only the scan line shows.')
  categoryPlanDetailBodyText: Text

  @input
  @allowUndefined
  @hint('Optional — restores the category panel after **Close** on an open or sending session (no parent disable).')
  categoryPlanDetailController: CategoryPlanDetailController

  private readonly log = new NativeLogger('PackScanController')
  private state: PackScanState = 'idle'
  private pendingCapture: VideoController | null = null
  /** Bumped to cancel in-flight deferred camera preview when session closes or reopens. */
  private previewEnableToken: number = 0
  /** After idle UI, wait this many Update frames before assigning pack result `Text` (editor-safe). */
  private packDetailPostIdleFramesRemaining: number = 0
  private pendingPackDetailBody: string | null = null
  private packDetailFlushToken: number = 0

  private setPackScanState(next: PackScanState): void {
    const prev = this.state
    const lockSharedDetail = !this.packScanResultText && this.geminiAssistant
    if (lockSharedDetail && prev === 'sending' && next !== 'sending') {
      this.geminiAssistant.notifyPackScanDetailUiLockExited()
    }
    if (lockSharedDetail && prev !== 'sending' && next === 'sending') {
      this.geminiAssistant.notifyPackScanDetailUiLockEntered()
    }
    this.state = next
  }

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.bindUi()
      this.applyIdleVisibility()
      this.createEvent('UpdateEvent').bind(() => this.onUpdatePackDetailFlush())
      this.tripLog('PackScanController ready. Pinch Scan Pack to open session; live camera preview follows `showLiveCameraPreview`.')
    })
  }

  private bindUi(): void {
    if (this.scanButton) {
      this.scanButton.onButtonPinched.add(() => this.onScanPack())
    } else {
      this.tripLog('scanButton not assigned.')
    }
    if (this.captureButton) {
      this.captureButton.onButtonPinched.add(() => this.onCapture())
    }
    if (this.closeButton) {
      this.closeButton.onButtonPinched.add(() => this.onClose())
    }
  }

  private onScanPack(): void {
    if (!this.packScanHud || !this.packScanHud.enabled) {
      this.tripLog('Scan Pack ignored: packScanHud is not enabled.')
      return
    }
    if (this.state === 'sending') {
      this.tripLog('Scan Pack ignored while sending.')
      return
    }
    try {
      this.clearCategoryPlanDetailBodyForScanSession()
      this.setPackScanState('open')
      this.applyOpenVisibility()
      if (this.packScanResultText) {
        this.setPackDetailBody('Pinch Capture to scan your items, or Close to return to Pack details.')
      }
      this.tripLog('Scan session opened.')
    } catch (e) {
      this.log.e(`onScanPack failed: ${e}`)
      print(`[PackScanController] onScanPack failed: ${e}`)
      this.previewEnableToken++
      this.setPackScanState('idle')
      this.applyIdleVisibility()
    }
  }

  private onCapture(): void {
    if (this.state !== 'open') {
      this.tripLog('Capture ignored: session not open.')
      return
    }
    if (!this.originalCameraTexture) {
      this.tripLog('originalCameraTexture not assigned. Text-only fallback.')
      this.submitTextOnly('Camera texture not assigned; using text-only pack check.')
      return
    }
    this.snapshotAndSend(this.originalCameraTexture)
  }

  private onClose(): void {
    const restoreCategoryPanel = this.state === 'open' || this.state === 'sending'
    this.previewEnableToken++
    this.packDetailFlushToken++
    this.pendingPackDetailBody = null
    this.packDetailPostIdleFramesRemaining = 0
    if (this.pendingCapture) {
      try {
        this.pendingCapture.stopRecording()
      } catch (e) {
        this.log.e(`pendingCapture.stopRecording: ${e}`)
      }
      this.pendingCapture = null
    }
    this.setPackScanState('idle')
    this.applyIdleVisibility()
    if (restoreCategoryPanel && this.categoryPlanDetailController) {
      this.categoryPlanDetailController.reapplyLastCategoryDetail()
    }
    this.tripLog('Scan session closed.')
  }

  private applyIdleVisibility(): void {
    this.previewEnableToken++
    this.setCameraPreviewVisible(false)
    this.setButtonVisible(this.captureButton, false)
    this.setButtonVisible(this.closeButton, false)
    this.setButtonVisible(this.scanButton, true)
  }

  private applyOpenVisibility(): void {
    this.previewEnableToken++
    this.setCameraPreviewVisible(false)
    this.setButtonVisible(this.captureButton, true)
    this.setButtonVisible(this.closeButton, true)
    this.setButtonVisible(this.scanButton, true)
    if (!this.shouldShowLiveCameraPanel()) {
      if (this.showLiveCameraPreview && !this.cameraPreviewRoot) {
        this.tripLog('Live preview skipped: assign cameraPreviewRoot (e.g. CropCameraTexture scene root).')
      }
      return
    }
    const token = this.previewEnableToken
    const delayed = this.createEvent('DelayedCallbackEvent')
    delayed.bind(() => {
      if (token !== this.previewEnableToken || this.state !== 'open') {
        return
      }
      try {
        this.setCameraPreviewVisible(true)
        if (!this.originalCameraTexture) {
          this.tripLog('Preview visible; assign originalCameraTexture on PackScanController for Capture.')
        }
      } catch (e) {
        this.log.e(`Deferred camera preview failed: ${e}`)
        print(`[PackScanController] Deferred camera preview failed: ${e}`)
      }
    })
    delayed.reset(0.08)
  }

  private applySendingVisibility(): void {
    this.setCameraPreviewVisible(this.shouldShowLiveCameraPanel())
    this.setButtonVisible(this.captureButton, false)
    this.setButtonVisible(this.closeButton, true)
    this.setButtonVisible(this.scanButton, false)
  }

  /**
   * Whether to show the in-lens camera preview panel. Uses only `showLiveCameraPreview` +
   * `cameraPreviewRoot` — **not** `originalCameraTexture` (Crop UI often drives the feed internally;
   * assign `originalCameraTexture` separately for JPEG capture).
   */
  private shouldShowLiveCameraPanel(): boolean {
    return !!(this.showLiveCameraPreview && this.cameraPreviewRoot)
  }

  private setCameraPreviewVisible(visible: boolean): void {
    if (!this.cameraPreviewRoot) {
      return
    }
    try {
      this.cameraPreviewRoot.enabled = visible
    } catch (e) {
      this.log.e(`setCameraPreviewVisible failed: ${e}`)
      print(`[PackScanController] setCameraPreviewVisible failed: ${e}`)
    }
  }

  private setButtonVisible(button: PinchButton | undefined, visible: boolean): void {
    if (!button) {
      return
    }
    try {
      button.getSceneObject().enabled = visible
    } catch (e) {
      this.log.e(`setButtonVisible failed: ${e}`)
    }
  }

  private snapshotAndSend(source: Texture): void {
    if (this.state === 'sending') {
      return
    }
    this.setPackScanState('sending')
    this.applySendingVisibility()
    this.setPackDetailBody('Analyzing your items…')

    if (this.isRunningInLensEditor() && this.skipCameraEncodeInEditor) {
      this.tripLog('Lens editor: skipCameraEncodeInEditor — text-only pack (no VideoController).')
      this.submitTextOnly('Editor preview: text-only pack (camera encode skipped). Use device for vision scan.')
      return
    }

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
      .then((response) => this.applyResponse(response))
      .catch((error) => {
        this.log.e(`Gemini.models vision call failed: ${error}`)
        this.submitTextOnly('Vision scan failed; falling back to text-only pack check.')
      })
  }

  private submitTextOnly(statusLine: string): void {
    this.setPackScanState('sending')
    this.applySendingVisibility()
    this.setPackDetailBody(statusLine)
    const prompt = this.buildPackPrompt()
    const request: GoogleGenAITypes.Gemini.Models.GenerateContentRequest = {
      model: this.geminiModel,
      type: 'generateContent',
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      },
    }
    Gemini.models(request)
      .then((response) => this.applyResponse(response))
      .catch((error) => {
        this.log.e(`Gemini.models text-only call failed: ${error}`)
        this.finishSendingOnMainThread('Pack scan failed. Check RSG token and connectivity.')
      })
  }

  private applyResponse(response: any): void {
    const text = this.extractText(response)
    if (!text || text.length === 0) {
      this.finishSendingOnMainThread('No scan response. Try again.')
      return
    }
    const compact = text.trim()
    this.finishSendingOnMainThread(`— Pack —\n\n${compact}`)
  }

  /**
   * Apply pack result + idle UI off the Gemini callback, then assign `Text` only after several
   * **Update** frames (avoids Lens Studio native crashes from chained timers + immediate layout).
   */
  private finishSendingOnMainThread(detailBody: string): void {
    const myFlush = ++this.packDetailFlushToken
    const ev = this.createEvent('DelayedCallbackEvent')
    ev.bind(() => {
      if (myFlush !== this.packDetailFlushToken) {
        return
      }
      if (this.state !== 'sending') {
        return
      }
      this.applyIdleVisibility()
      if (myFlush !== this.packDetailFlushToken) {
        return
      }
      this.pendingPackDetailBody = detailBody
      this.packDetailPostIdleFramesRemaining = 4
    })
    ev.reset(0.12)
  }

  private onUpdatePackDetailFlush(): void {
    if (this.packDetailPostIdleFramesRemaining <= 0) {
      return
    }
    this.packDetailPostIdleFramesRemaining--
    if (this.packDetailPostIdleFramesRemaining > 0) {
      return
    }
    const body = this.pendingPackDetailBody
    this.pendingPackDetailBody = null
    if (this.state !== 'sending' || !body) {
      return
    }
    this.setPackDetailBody(body)
    this.setPackScanState('idle')
  }

  private isRunningInLensEditor(): boolean {
    try {
      const device = (global as any).deviceInfoSystem
      return !!(device && device.isEditor && device.isEditor())
    } catch (_) {
      return false
    }
  }

  private sanitizePackDisplayString(raw: string): string {
    let s = raw.replace(/\u0000/g, '').replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    s = s.replace(/[\uD800-\uDFFF]/g, '')
    s = s.replace(/[\uFE00-\uFE0F\u200B-\u200D\uFEFF]/g, '')
    s = s.replace(/\n{8,}/g, '\n\n\n\n\n\n\n')
    return s
  }

  private buildPackPrompt(): string {
    const observed = this.observedItemsText ? this.observedItemsText.text.trim() : ''
    const draft = this.geminiAssistant ? this.geminiAssistant.resolveTripSurfaceForPackScan() : null

    const tripContext = draft
      ? [
          `Departure city: ${draft.departureCity || '-'}`,
          `Destination: ${draft.destinationCity || '-'}`,
          `Depart date: ${draft.departureDateTime || '-'}`,
          `Arrive date: ${draft.arrivalDateTime || '-'}`,
          `Purpose: ${draft.purpose}`,
          '(Cities use User Context when available, otherwise the assistant fallback city such as Berlin.)',
          draft.voicePreferenceNotes && draft.voicePreferenceNotes.trim().length > 0
            ? `User notes: ${draft.voicePreferenceNotes.trim()}`
            : '',
        ]
          .filter((s) => s.length > 0)
          .join('\n')
      : 'Trip context unavailable (assign GeminiAssistant). Use generic temperate-climate packing ideas if geography is unknown.'

    const observedLine =
      observed.length > 0
        ? `User-listed items (if any): ${observed}`
        : 'No separate typed item list was provided.'

    const planSnippet = this.buildLastPlanPackWeatherSnippet()
    const weatherStrip = this.buildAccuWeatherSnippet()

    return [
      'You are a practical packing assistant. The user may send a photo of packed items (luggage, flat lay, or shelf).',
      'Trip context:',
      tripContext,
      observedLine,
      planSnippet.length > 0 ? `Itinerary / plan hints:\n${planSnippet}` : '',
      weatherStrip.length > 0 ? `Weather context:\n${weatherStrip}` : '',
      'Describe only what is clearly visible in the image for the first section. Do not invent objects in the photo.',
      'Use neutral section headings (exactly these three, in order, each followed by your bullets):',
      'Visible items',
      'Gaps or risks for this trip',
      'Suggested additions',
      'Under "Visible items": list concrete objects you actually see, or a single line like "No packed travel gear visible" if the frame is a room / not luggage.',
      'Under "Gaps or risks": relate missing gear to the trip context (dates, purpose, destination).',
      'Under "Suggested additions": ALWAYS give 3–6 specific packing ideas (clothing, toiletries, adapters, documents, gear) grounded in destination, trip purpose, dates/season, and any weather context above — even when nothing travel-related is visible in the photo. Never reply with only "N/A", "none", or an empty section here.',
      'Keep each section to short bullets; total under 18 lines.',
    ]
      .filter((s) => s.length > 0)
      .join('\n')
  }

  private buildLastPlanPackWeatherSnippet(): string {
    if (!this.geminiAssistant) {
      return ''
    }
    const plan = this.geminiAssistant.getLastTripPlan()
    if (!plan || !plan.cards) {
      return ''
    }
    const lines: string[] = []
    const weatherCard = plan.cards.weather
    if (weatherCard && weatherCard.options && weatherCard.options.length > 0) {
      for (let i = 0; i < weatherCard.options.length && i < 2; i++) {
        const o = weatherCard.options[i]
        if (o.weatherPracticalTips) {
          lines.push(`- Weather tips: ${o.weatherPracticalTips}`)
        } else if (o.notes) {
          lines.push(`- Weather: ${o.notes}`)
        } else if (o.title) {
          lines.push(`- Weather: ${o.title}`)
        }
      }
    }
    const packCard = plan.cards.pack
    if (packCard && packCard.options && packCard.options.length > 0) {
      for (let i = 0; i < packCard.options.length && i < 4; i++) {
        const o = packCard.options[i]
        const hint = o.luggageVisionHint ? ` — ${o.luggageVisionHint}` : ''
        lines.push(`- Plan item: ${o.title}${hint}`)
      }
    }
    return lines.join('\n')
  }

  private buildAccuWeatherSnippet(): string {
    if (!this.weatherAccuBridge) {
      return ''
    }
    try {
      const s = this.weatherAccuBridge.getLastSummary().trim()
      return s.length > 0 ? s : ''
    } catch (e) {
      return ''
    }
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
      const chunks: string[] = []
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        if (p && typeof p.text === 'string' && p.text.length > 0) {
          chunks.push(p.text)
        }
      }
      return chunks.join('\n')
    } catch (e) {
      this.log.e(`extractText failed: ${e}`)
    }
    return ''
  }

  /** Walk parents when the API exposes `getParent` (Spectacles / LS); no-op if unsupported. */
  private tryGetParentSceneObject(so: SceneObject): SceneObject | null {
    try {
      const fn = (so as any).getParent as undefined | (() => SceneObject | null)
      if (typeof fn === 'function') {
        const p = fn.call(so) as SceneObject | null
        return p || null
      }
    } catch (e) {
      this.log.e(`tryGetParentSceneObject: ${e}`)
    }
    return null
  }

  /**
   * If the pack output `Text` sits under **`packScanHud`**, the HUD root must stay enabled for
   * `.text` updates — otherwise native builds crash (trip-plan `clearDetail` used to disable this HUD).
   */
  private ensurePackScanHudEnabledForOwnerOf(text: Text): void {
    if (!this.packScanHud) {
      return
    }
    try {
      let cur: SceneObject | null = text.getSceneObject()
      let depth = 0
      while (cur && depth < 24) {
        if (cur === this.packScanHud) {
          if (!this.packScanHud.enabled) {
            this.packScanHud.enabled = true
          }
          return
        }
        cur = this.tryGetParentSceneObject(cur)
        depth++
      }
    } catch (e) {
      this.log.e(`ensurePackScanHudEnabledForOwnerOf: ${e}`)
    }
  }

  /**
   * Enable configured panel root + the `Text` owner only. (Walking every parent via `getParent`
   * and toggling nodes caused instability in Lens Studio when pack copy appeared.)
   */
  private ensureCategoryDetailTextWritable(text: Text): void {
    try {
      if (this.categoryDetailPanelRoot && !this.categoryDetailPanelRoot.enabled) {
        this.categoryDetailPanelRoot.enabled = true
      }
      const owner = text.getSceneObject()
      if (owner && !owner.enabled) {
        owner.enabled = true
      }
    } catch (e) {
      this.log.e(`ensureCategoryDetailTextWritable: ${e}`)
    }
  }

  /** Same ancestor walk as `CategoryPlanDetailController.ensureDetailTextOwnerEnabled` — safe before `.text = ''`. */
  private ensureTextAncestorsEnabledForWrite(text: Text): void {
    let cur: SceneObject | null = null
    try {
      cur = text.getSceneObject()
    } catch (e) {
      this.log.e(`ensureTextAncestorsEnabledForWrite getSceneObject: ${e}`)
      return
    }
    let depth = 0
    while (cur && depth < 20) {
      try {
        if (!cur.enabled) {
          cur.enabled = true
        }
      } catch (e) {
        this.log.e(`ensureTextAncestorsEnabledForWrite: ${e}`)
        break
      }
      cur = this.tryGetParentSceneObject(cur)
      depth++
    }
  }

  private clearCategoryPlanDetailBodyForScanSession(): void {
    if (!this.categoryPlanDetailBodyText) {
      return
    }
    this.ensureTextAncestorsEnabledForWrite(this.categoryPlanDetailBodyText)
    try {
      this.categoryPlanDetailBodyText.text = ''
    } catch (e) {
      this.log.e(`clearCategoryPlanDetailBodyForScanSession: ${e}`)
    }
  }

  /** Pack scan status + results: `packScanResultText` if set, else `detailBodyText` only. */
  private setPackDetailBody(message: string): void {
    const maxLen = this.isRunningInLensEditor() ? 6000 : 12000
    let safe = this.sanitizePackDisplayString(message)
    if (safe.length > maxLen) {
      safe = `${safe.substring(0, maxLen)}\n\n…(truncated for display)`
    }
    const target = this.packScanResultText || this.detailBodyText
    if (!target) {
      this.log.e(
        'PackScanController: assign packScanResultText (recommended) or detailBodyText. packHudText is unused.',
      )
      print('[PackScanController] Assign packScanResultText (e.g. Text on ScanDetail_Text_Body) or detailBodyText.')
      return
    }
    this.ensurePackScanHudEnabledForOwnerOf(target)
    this.ensureCategoryDetailTextWritable(target)
    try {
      target.text = safe
    } catch (e) {
      this.log.e(`setPackDetailBody failed: ${e}`)
      print(`[PackScanController] setPackDetailBody failed: ${e}`)
    }
  }

  private tripLog(message: string): void {
    if (this.verboseLogs) {
      this.log.i(message)
    }
  }
}
