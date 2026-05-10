import { PinchButton } from 'SpectaclesInteractionKit.lspkg/Components/UI/PinchButton/PinchButton'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { Gemini } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAI'
import { GoogleGenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes'
import { GeminiAssistant } from './GeminiAssistant'

/**
 * Pack scan bridge for the Pack HUD.
 *
 * Current implementation is "scan-assisted": it reads a typed item list from `observedItemsText`
 * (or falls back to generic context) and asks Gemini for a quick pack-check report.
 *
 * Why text-first:
 * Lens Studio runtime does not expose a universal direct "Texture -> base64" utility in this project yet.
 * This controller keeps UX functional now and is ready for a future camera-frame encoder input.
 */
@component
export class PackScanController extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint('Trip context source (destination, dates, purpose).')
  geminiAssistant: GeminiAssistant

  @input
  @allowUndefined
  @hint('Pinch button that triggers a pack scan while Pack HUD is visible.')
  scanButton: PinchButton

  @input
  @allowUndefined
  @hint('Pack HUD root. Scan runs only when this HUD is enabled.')
  packScanHud: SceneObject

  @input
  @allowUndefined
  @hint('Main text inside Pack HUD.')
  packHudText: Text

  @input
  @allowUndefined
  @hint('Optional category detail text to mirror the scan result.')
  detailBodyText: Text

  @input
  @allowUndefined
  @hint('Observed packed items text (typed by user / future OCR bridge).')
  observedItemsText: Text

  @input
  @hint('Gemini model for pack-check text generation.')
  geminiModel: string = 'gemini-2.0-flash'

  @input
  @hint('Enable PackScanController logs.')
  verboseLogs: boolean = true

  private readonly log = new NativeLogger('PackScanController')
  private isScanning: boolean = false

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.bindUi()
      this.renderIdleHud()
    })
  }

  private bindUi(): void {
    if (!this.scanButton) {
      this.tripLog('scanButton not assigned.')
      return
    }
    this.scanButton.onButtonPinched.add(() => {
      this.runPackScan()
    })
  }

  private runPackScan(): void {
    if (this.isScanning) {
      this.setHudText('Scan already running...')
      return
    }
    if (!this.packScanHud || !this.packScanHud.enabled) {
      return
    }

    this.isScanning = true
    this.setHudText('Scanning packed items with Gemini...')

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
        generationConfig: {
          temperature: 0.2,
        },
      },
    }

    Gemini.models(request)
      .then((response) => {
        const text = this.extractText(response)
        if (!text || text.length === 0) {
          this.setHudText('No scan response. Try again.')
          this.isScanning = false
          return
        }
        const compact = text.trim()
        this.setHudText(`PACK SCAN RESULT\n${compact}`)
        if (this.detailBodyText) {
          this.detailBodyText.text = `— Pack (scan) —\n\n${compact}`
        }
        this.isScanning = false
      })
      .catch((error) => {
        this.log.e(`Gemini.models scan failed: ${error}`)
        this.setHudText('Pack scan failed. Check RSG token and connectivity.')
        this.isScanning = false
      })
  }

  private buildPackPrompt(): string {
    const observed = this.observedItemsText ? this.observedItemsText.text.trim() : ''
    const draft = this.geminiAssistant ? this.geminiAssistant.getTripDraft() : null

    const tripContext = draft
      ? `Destination: ${draft.destinationCity || '-'}, Depart: ${draft.departureDateTime || '-'}, Arrive: ${draft.arrivalDateTime || '-'}, Purpose: ${draft.purpose}`
      : 'Trip context unavailable.'

    const observedLine =
      observed.length > 0
        ? `Observed packed items (user-provided): ${observed}`
        : 'Observed packed items unavailable. Provide general essentials and likely misses.'

    return [
      'You are a practical packing assistant.',
      tripContext,
      observedLine,
      'Return concise plain text with 3 sections:',
      '1) Good to go',
      '2) Missing or risky',
      '3) Quick additions',
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
      const first = parts[0]
      if (first && typeof first.text === 'string') {
        return first.text
      }
    } catch (e) {
      this.log.e(`extractText failed: ${e}`)
    }
    return ''
  }

  private renderIdleHud(): void {
    if (!this.packScanHud || !this.packScanHud.enabled) {
      return
    }
    this.setHudText('PACK SCAN HUD\nPinch Scan Pack to run a text-based check (trip context only).')
  }

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
