require('LensStudio:TextInputModule')

import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable'
import { PinchButton } from 'SpectaclesInteractionKit.lspkg/Components/UI/PinchButton/PinchButton'
import { ToggleButton } from 'SpectaclesInteractionKit.lspkg/Components/UI/ToggleButton/ToggleButton'
import { ASRQueryController } from './ASRQueryController'
import { GeminiAssistant } from './GeminiAssistant'
import { TravelPlannerController } from './TravelPlannerController'
import { TripDraft } from './TripTypes'
import { WeatherAccuBridge } from './WeatherAccuBridge'

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

  @input
  @hint('Hide the old 5.15 panels so TripOptic_Proto (glass capsules + portal) is the live UI.')
  useTripOpticPrototype: boolean = true

  private keyboardModeEnabled: boolean = false
  private keyboardStepIndex: number = 0
  private readonly keyboardSteps = ['departure city', 'destination city', 'departure date', 'return date']
  private keyboardOptions: any = null
  private textInputPrimed: boolean = false

  /** Fires whenever the keyboard step prompt line updates (for optional TTS via `AssistantTtsController`). */
  readonly onKeyboardGuidance: Event<string> = new Event<string>()

  /** After a plan exists, the plan button starts a fresh cycle instead of requesting again. */
  private planCycleReady: boolean = false
  private planButtonLabel: Text | null = null

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.primeTextInputOptions()
      this.bindUi()
      this.applyLandingLayout()
    })
  }

  /**
   * Center landing is the New In City panel.
   * Trip inputs sit top-left, weather top-right, both at full type size.
   * Voice, keyboard, and reset stay up during prompting.
   * Purpose appears after from, to, and both dates. Plan appears after a purpose pinch.
   * Scan Pack appears bottom-left once a destination is set.
   */
  private applyLandingLayout(): void {
    if (this.useTripOpticPrototype) {
      this.hideLegacyVisuals()
    }
    this.placePanel(this.findNamed('WeatherCard_Placeholder'), 13, 20)
    this.setEnabled(this.findNamed('TripSummary_Text_Placeholder'), false)
    this.layoutCategoryRow()
    this.placePanel(this.findNamed('CategoryDetailCard_Placeholder'), 13, -3)
    this.placePlanButton()
    this.refreshOrbLabel()
    this.bindTripOpticButton()
    this.seatWeatherFrame(false)
    this.bindWeatherPinch()
    this.bindPackAdviceButton()
    this.setEnabled(this.findNamed('TopAssistVisual 1'), false)
    this.setEnabled(this.findNamed('SummaryText_Placeholder'), false)
    this.setEnabled(this.findNamed('CategoryDetailCard_Placeholder'), false)

    const planRoot = this.findNamed('Btn_PlanTrip_Placeholder')
    this.planButtonLabel = planRoot ? this.findText(planRoot) : null
    this.setPlanLabel('Plan Trip')

    if (this.geminiAssistant) {
      this.geminiAssistant.onPromptGenerated.add((message: string) => this.fitMainFrame(message))
      this.geminiAssistant.onTripDraftUpdated.add(() => {
        this.refreshLanding()
        this.refreshOrbLabel()
      })
      this.geminiAssistant.onTripPlanReady.add(() => {
        this.planCycleReady = true
        this.setPlanLabel('Plan a new trip')
        this.layoutCategoryRow()
        this.placePlanButton()
        this.refreshLanding()
      })
    }
    this.refreshLanding()
    this.applyChicGlass()
    this.fitMainFrame('Hey. Tell me where you are leaving from.')
  }

  /**
   * Quiet glass on the travel UI only. Clones each material so the spatial
   * image portal and its ring stay on their own shader.
   */
  private applyChicGlass(): void {
    const ink = new vec4(0.05, 0.07, 0.11, 0.88)
    const sand = new vec4(0.16, 0.12, 0.07, 0.86)
    const voice = new vec4(0.18, 0.12, 0.24, 0.92)
    const keys = new vec4(0.1, 0.13, 0.2, 0.92)
    const clear = new vec4(0.26, 0.1, 0.12, 0.9)
    const leisure = new vec4(0.2, 0.1, 0.24, 0.9)
    const bleisure = new vec4(0.1, 0.14, 0.2, 0.9)
    const business = new vec4(0.08, 0.18, 0.16, 0.9)
    const plan = new vec4(0.18, 0.14, 0.08, 0.92)
    const scan = new vec4(0.08, 0.16, 0.13, 0.92)
    this.tintTree(this.findNamed('TopAssistVisual'), ink)
    this.tintTree(this.findNamed('weather Card'), sand)
    this.tintTree(this.findNamed('TripCard'), sand)
    this.tintTree(this.findNamed('Btn_VoiceMode_Placeholder'), voice)
    this.tintTree(this.findNamed('Btn_Keyboard_Placeholder'), keys)
    this.tintTree(this.findNamed('Btn_ClearInputs'), clear)
    this.tintTree(this.findNamed('Btn_Occasion_Leisure_Placeholder'), leisure)
    this.tintTree(this.findNamed('Btn_Occasion_Bleisure_Placeholder'), bleisure)
    this.tintTree(this.findNamed('Btn_Occasion_Business_Placeholder'), business)
    this.tintTree(this.findNamed('Btn_PlanTrip_Placeholder'), plan)
    this.tintTree(this.findNamed('Btn_Scan_Pack'), scan)
  }

  private tintTree(root: SceneObject | null, color: vec4): void {
    if (!root || this.isPortalPiece(root)) {
      return
    }
    this.tintOne(root, color)
    const count = root.getChildrenCount()
    for (let i = 0; i < count; i++) {
      this.tintTree(root.getChild(i), color)
    }
  }

  private isPortalPiece(so: SceneObject): boolean {
    const name = so.name
    if (name === 'Spatial Image') {
      return true
    }
    if (name.indexOf('ring') === 0) {
      return true
    }
    return false
  }

  private tintOne(so: SceneObject, color: vec4): void {
    try {
      const vis = so.getComponent('Component.RenderMeshVisual') as RenderMeshVisual
      if (!vis || !vis.mainMaterial) {
        return
      }
      const mat = vis.mainMaterial.clone()
      vis.mainMaterial = mat
      const pass = mat.mainPass as any
      if (pass.baseColor !== undefined) {
        pass.baseColor = color
      }
      if (pass.baseColorFactor !== undefined) {
        pass.baseColorFactor = color
      }
    } catch (e) {
      print(`[AIAssistantUIBridge] tint ${so.name}: ${e}`)
    }
  }

  /**
   * Grows the New In City glass with the status copy, then places the control
   * rows under the bottom edge of that glass.
   */
  private fitMainFrame(message: string): void {
    const visual = this.findNamed('TopAssistVisual')
    const prompt = this.findNamed('Top_AssistantPrompt_Placeholder')
    if (!visual) {
      return
    }
    const body = message && message.length > 0 ? message : ''
    const lineCount = Math.max(2, body.split('\n').length)
    const scaleY = Math.min(6.2, 2.1 + (lineCount - 2) * 0.72)
    try {
      const t = visual.getTransform()
      const s = t.getLocalScale()
      t.setLocalScale(new vec3(s.x > 0 ? s.x : 2.2, scaleY, s.z > 0 ? s.z : 2))
      const promptY = prompt ? prompt.getTransform().getLocalPosition().y : 12
      const visualY = t.getLocalPosition().y
      const bottom = promptY + visualY - scaleY * 1.85
      const controlsY = bottom - 3.4
      this.setButtonY('Btn_VoiceMode_Placeholder', controlsY)
      this.setButtonY('Btn_Keyboard_Placeholder', controlsY)
      this.setButtonY('Btn_ClearInputs', controlsY)
      this.setButtonY('Mic_Toggle', controlsY)
      const purposeY = controlsY - 5.2
      this.setButtonY('Btn_Occasion_Leisure_Placeholder', purposeY)
      this.setButtonY('Btn_Occasion_Bleisure_Placeholder', purposeY)
      this.setButtonY('Btn_Occasion_Business_Placeholder', purposeY)
      this.placePlanButton()
    } catch (e) {
      print(`[AIAssistantUIBridge] fitMainFrame: ${e}`)
    }
  }

  private setButtonY(name: string, y: number): void {
    const so = this.findNamed(name)
    if (!so) {
      return
    }
    try {
      const t = so.getTransform()
      const p = t.getLocalPosition()
      t.setLocalPosition(new vec3(p.x, y, p.z))
    } catch (e) {
      print(`[AIAssistantUIBridge] setButtonY ${name}: ${e}`)
    }
  }

  private hideLegacyVisuals(): void {
    const names = [
      'Left_Column_Placeholder',
      'Right_Column_Placeholder',
      'Top_AssistantPrompt_Placeholder',
      'Bottom_HUD_Placeholder',
      'Center_NIC_Compass_Placeholder',
      'TravelPlanner_UI',
      'DestinationViewSystem',
      'TopAssistVisual',
    ]
    for (let i = 0; i < names.length; i++) {
      this.setEnabled(this.findNamed(names[i]), false)
    }
  }

  private refreshLanding(): void {
    if (this.useTripOpticPrototype) {
      this.hideLegacyVisuals()
      return
    }
    const draft = this.geminiAssistant ? this.geminiAssistant.getTripDraft() : null
    const from = draft && draft.departureCity.trim().length > 0
    const to = draft && draft.destinationCity.trim().length > 0
    const dates =
      !!draft &&
      draft.departureDateTime.trim().length > 0 &&
      draft.arrivalDateTime.trim().length > 0
    const routeReady = !!(from && to && dates)
    const prompting = !this.planCycleReady

    this.setEnabled(this.findNamed('Btn_VoiceMode_Placeholder'), prompting)
    this.setEnabled(this.findNamed('Btn_Keyboard_Placeholder'), prompting)
    this.setEnabled(this.findNamed('Btn_ClearInputs'), prompting)
    this.setEnabled(this.findNamed('Mic_Toggle'), prompting)

    this.setEnabled(this.findNamed('Btn_Occasion_Leisure_Placeholder'), prompting && routeReady)
    this.setEnabled(this.findNamed('Btn_Occasion_Bleisure_Placeholder'), prompting && routeReady)
    this.setEnabled(this.findNamed('Btn_Occasion_Business_Placeholder'), prompting && routeReady)

    const showPlan = this.planCycleReady || routeReady
    this.setEnabled(this.findNamed('Btn_PlanTrip_Placeholder'), showPlan)
    this.setEnabled(this.findNamed('Btn_Scan_Pack'), !!to)
    this.setEnabled(this.findNamed('Btn_WhatToPack'), !!to)

    const weather = this.findWeatherBridge()
    if (weather && this.geminiAssistant) {
      weather.setHomeCity(this.geminiAssistant.getDetectedCity())
      weather.setTripDraft(draft)
    }
  }

  /**
   * Capsules arc around the portal: Stay, Transport, Food on the left;
   * Places, Weather, Pack on the right. Positions are local to
   * Left_Column_Placeholder, whose origin sits at world x -21.4, y -0.3.
   */
  private layoutCategoryRow(): void {
    const leftX = 1.4
    const rightX = 41.4
    const rows = [9.3, 2.3, -4.7]
    const slots: { name: string; x: number; y: number }[] = [
      { name: 'CategoryWidgetHolder_Stay', x: leftX, y: rows[0] },
      { name: 'CategoryWidgetHolder_Routes', x: leftX, y: rows[1] },
      { name: 'CategoryWidgetHolder_Food', x: leftX, y: rows[2] },
      { name: 'CategoryWidgetHolder_Places', x: rightX, y: rows[0] },
      { name: 'CategoryWidgetHolder_Weather', x: rightX, y: rows[1] },
      { name: 'CategoryWidgetHolder_Pack', x: rightX, y: rows[2] },
    ]
    for (let i = 0; i < slots.length; i++) {
      this.placeScaled(this.findNamed(slots[i].name), slots[i].x, slots[i].y, 0.75)
    }
  }

  private placeScaled(so: SceneObject | null, x: number, y: number, scale: number): void {
    if (!so) {
      return
    }
    try {
      const t = so.getTransform()
      const p = t.getLocalPosition()
      t.setLocalPosition(new vec3(x, y, p.z))
      t.setLocalScale(new vec3(scale, scale, scale))
    } catch (e) {
      print(`[AIAssistantUIBridge] placeScaled ${so.name}: ${e}`)
    }
  }

  /** Bottom center, under the portal label, clear of both capsule columns. */
  private placePlanButton(): void {
    const plan = this.findNamed('Btn_PlanTrip_Placeholder')
    if (!plan) {
      return
    }
    try {
      const t = plan.getTransform()
      const p = t.getLocalPosition()
      t.setLocalPosition(new vec3(0, -13, p.z))
    } catch (e) {
      print(`[AIAssistantUIBridge] placePlanButton: ${e}`)
    }
  }

  private orbLabel: Text | null = null

  /** City, trip length, and purpose under the portal. The portal itself is untouched. */
  private ensureOrbLabel(): Text | null {
    if (this.orbLabel) {
      return this.orbLabel
    }
    const source = this.findNamed('PromptSubtitle_Text_Placeholder')
    const root = this.findNamed('AI_UI_V2_Root')
    if (!source || !root) {
      return null
    }
    try {
      const copy = root.copyWholeHierarchy(source)
      copy.name = 'OrbLabel_Text'
      copy.getTransform().setLocalPosition(new vec3(0, -9, 0))
      this.orbLabel = this.findText(copy)
    } catch (e) {
      print(`[AIAssistantUIBridge] orb label: ${e}`)
    }
    return this.orbLabel
  }

  private refreshOrbLabel(): void {
    const label = this.ensureOrbLabel()
    if (!label || !this.geminiAssistant) {
      return
    }
    const draft = this.geminiAssistant.getTripDraft()
    const dest = draft.destinationCity.trim()
    const city = dest.length > 0 ? dest : this.geminiAssistant.getDetectedCity()
    const days = this.tripDays(draft.departureDateTime, draft.arrivalDateTime)
    const bits: string[] = []
    if (dest.length > 0 && days > 0) {
      bits.push(`${days} ${days === 1 ? 'day' : 'days'}`)
    }
    if (dest.length > 0 && this.geminiAssistant.isPurposeChosen()) {
      bits.push(draft.purpose.charAt(0).toUpperCase() + draft.purpose.slice(1))
    }
    try {
      label.text = bits.length > 0 ? `${city}\n${bits.join(' · ')}` : city
    } catch (e) {
      print(`[AIAssistantUIBridge] orb label text: ${e}`)
    }
  }

  private tripDays(depart: string, ret: string): number {
    const a = this.parseDate(depart)
    const b = this.parseDate(ret)
    if (!a || !b) {
      return 0
    }
    return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1)
  }

  private parseDate(text: string): Date | null {
    const m = (text || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (!m) {
      return null
    }
    return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10))
  }

  private bindTripOpticButton(): void {
    const title = this.findNamed('PromptTitle_Text_Placeholder')
    const label = title ? this.findText(title) : null
    if (label) {
      try {
        label.text = 'TripOptic'
      } catch (e) {
        print(`[AIAssistantUIBridge] TripOptic title: ${e}`)
      }
    }
    const glass = this.findNamed('TopAssistVisual')
    const inter = glass ? this.ensureInteractable(glass) : null
    if (!inter || !this.geminiAssistant) {
      return
    }
    inter.onInteractorTriggerEnd.add(() => {
      if (!this.geminiAssistant) {
        return
      }
      this.geminiAssistant.setTripOpticOpen(!this.geminiAssistant.isTripOpticOpen())
    })
  }

  private bindWeatherPinch(): void {
    const frame = this.findNamed('WeatherCard_Placeholder') || this.findNamed('weather Card')
    if (!frame) {
      return
    }
    const inter = this.ensureInteractable(frame)
    if (!inter) {
      return
    }
    inter.onInteractorTriggerEnd.add(() => {
      const weather = this.findWeatherBridge()
      if (!weather) {
        return
      }
      if (!weather.isDetailsOpen()) {
        weather.setDetailsOpen(true)
        this.seatWeatherFrame(true)
        return
      }
      if (!weather.isPackOpen()) {
        weather.showPackAdvice()
        this.seatWeatherFrame(true)
        return
      }
      weather.setDetailsOpen(false)
      this.seatWeatherFrame(false)
    })
  }

  private bindPackAdviceButton(): void {
    const root = this.findNamed('Btn_WhatToPack')
    if (!root) {
      return
    }
    const label = this.findText(root)
    if (label) {
      try {
        label.text = 'What to Pack'
      } catch (e) {
        print(`[AIAssistantUIBridge] pack label: ${e}`)
      }
    }
    const pinch = this.findPinch(root)
    if (pinch) {
      pinch.onButtonPinched.add(() => this.openPackAdvice())
      return
    }
    const inter = this.ensureInteractable(root)
    if (inter) {
      inter.onInteractorTriggerEnd.add(() => this.openPackAdvice())
    }
  }

  private openPackAdvice(): void {
    const weather = this.findWeatherBridge()
    if (!weather) {
      return
    }
    weather.showPackAdvice()
    this.seatWeatherFrame(true)
  }

  private seatWeatherFrame(open: boolean): void {
    const y = open ? -7 : -2
    const height = open ? 3.8 : 1.45
    this.moveLocal(this.findNamed('WeatherCard_Text_Body'), 0, y)
    const frame = this.findNamed('weather Card')
    this.moveLocal(frame, 0, y)
    if (!frame) {
      return
    }
    try {
      const s = frame.getTransform().getLocalScale()
      frame.getTransform().setLocalScale(new vec3(s.x, height, s.z))
    } catch (e) {
      print(`[AIAssistantUIBridge] weather frame: ${e}`)
    }
  }

  private moveLocal(so: SceneObject | null, x: number, y: number): void {
    if (!so) {
      return
    }
    try {
      const t = so.getTransform()
      const p = t.getLocalPosition()
      t.setLocalPosition(new vec3(x, y, p.z))
    } catch (e) {
      print(`[AIAssistantUIBridge] moveLocal: ${e}`)
    }
  }

  private ensureInteractable(so: SceneObject): Interactable | null {
    try {
      if (!so.getComponent('Physics.ColliderComponent')) {
        const collider = so.createComponent('Physics.ColliderComponent') as any
        if (collider && collider.shape) {
          collider.shape.fitVisual = true
        }
      }
      let inter = so.getComponent(Interactable.getTypeName()) as Interactable
      if (!inter) {
        inter = so.createComponent(Interactable.getTypeName()) as Interactable
      }
      return inter
    } catch (e) {
      print(`[AIAssistantUIBridge] interactable: ${e}`)
      return null
    }
  }

  private findPinch(root: SceneObject): PinchButton | null {
    try {
      const direct = root.getComponent(PinchButton.getTypeName()) as PinchButton
      if (direct) {
        return direct
      }
    } catch (_) {
      /* walk */
    }
    const count = root.getChildrenCount()
    for (let i = 0; i < count; i++) {
      const found = this.findPinch(root.getChild(i))
      if (found) {
        return found
      }
    }
    return null
  }

  private setPlanLabel(label: string): void {
    if (!this.planButtonLabel) {
      return
    }
    try {
      this.planButtonLabel.text = label
    } catch (e) {
      print(`[AIAssistantUIBridge] plan label: ${e}`)
    }
  }

  private placePanel(panel: SceneObject | null, x: number, y: number): void {
    if (!panel) {
      return
    }
    try {
      const t = panel.getTransform()
      const p = t.getLocalPosition()
      t.setLocalPosition(new vec3(x, y, p.z))
      t.setLocalScale(new vec3(1, 1, 1))
    } catch (e) {
      print(`[AIAssistantUIBridge] placePanel: ${e}`)
    }
  }

  private findText(root: SceneObject): Text | null {
    try {
      const direct = root.getComponent('Component.Text') as Text
      if (direct) {
        return direct
      }
    } catch (_) {
      /* walk children */
    }
    const count = root.getChildrenCount()
    for (let i = 0; i < count; i++) {
      const found = this.findText(root.getChild(i))
      if (found) {
        return found
      }
    }
    return null
  }

  private setEnabled(so: SceneObject | null, enabled: boolean): void {
    if (!so) {
      return
    }
    try {
      so.enabled = enabled
    } catch (e) {
      print(`[AIAssistantUIBridge] setEnabled: ${e}`)
    }
  }

  private findWeatherBridge(): WeatherAccuBridge | null {
    const host = this.findNamed('WeatherAccuBridge')
    if (!host) {
      return null
    }
    try {
      return host.getComponent(WeatherAccuBridge.getTypeName()) as WeatherAccuBridge
    } catch (e) {
      print(`[AIAssistantUIBridge] WeatherAccuBridge: ${e}`)
      return null
    }
  }

  private findNamed(name: string): SceneObject | null {
    try {
      const scene = (global as any).scene
      if (!scene || typeof scene.getRootObjectsCount !== 'function') {
        return this.searchFrom(this.getSceneObject(), name)
      }
      const count = scene.getRootObjectsCount()
      for (let i = 0; i < count; i++) {
        const found = this.searchFrom(scene.getRootObject(i), name)
        if (found) {
          return found
        }
      }
    } catch (e) {
      print(`[AIAssistantUIBridge] findNamed: ${e}`)
    }
    return null
  }

  private searchFrom(node: SceneObject | null, name: string): SceneObject | null {
    if (!node) {
      return null
    }
    if (node.name === name) {
      return node
    }
    const count = node.getChildrenCount()
    for (let i = 0; i < count; i++) {
      const found = this.searchFrom(node.getChild(i), name)
      if (found) {
        return found
      }
    }
    return null
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
        if (!this.geminiAssistant) {
          return
        }
        if (this.planCycleReady) {
          this.planCycleReady = false
          this.keyboardModeEnabled = false
          this.keyboardStepIndex = 0
          this.dismissTripKeyboard()
          this.geminiAssistant.resetTripDraft()
          this.setPlanLabel('Plan Trip')
          this.setHint('New trip. Say where you are leaving from.')
          if (this.travelPlannerController) {
            this.travelPlannerController.syncFromTripDraft(this.geminiAssistant.getTripDraft())
          }
          this.refreshLanding()
          return
        }
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
        this.planCycleReady = false
        this.setPlanLabel('Plan Trip')
        this.geminiAssistant?.resetTripDraft()
        this.refreshLanding()
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
    if (step === 'departure date' || step === 'return date') {
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
        this.setKeyboardPrompt(`Use ${AIAssistantUIBridge.DATE_HINT} for return date (example: 20/05/2026 or 20052026).`)
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
