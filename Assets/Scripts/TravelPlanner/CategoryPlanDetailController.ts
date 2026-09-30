import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable'
import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { GeminiAssistant } from './GeminiAssistant'
import {
  formatModelPriceHint,
  PLAN_PRICE_FORMAT_REVISION,
  sanitizeEmbeddedPricesInText,
} from './PlanPriceFormat'
import { WeatherAccuBridge } from './WeatherAccuBridge'
import { MAP_PIN, optionShowsMapPin } from './TripMapPins'
import {
  CategoryCardData,
  CategoryOption,
  TripDraft,
  TripPlanResponse,
  TripPlanningCategory,
} from './TripTypes'

/**
 * Makes each category row (SceneObject with SIK **Interactable** + collider) open a **beta detail** panel.
 * Row order must match `geminiAssistant.getPlanningCategoriesResolved()` (transport → accommodation → …).
 *
 * **Pack**: clear **`packScanDetailText`** before toggling `packScanHud` / `packScanFullHudRoot` so `ensureDetailTextOwnerEnabled` does not **re-enable PackScanHUD** right after it was hidden. Enables `packScanHud` (and optional **`packScanFullHudRoot`**) only for the **pack** row; **`packScanFullHudRoot` is ignored** when it is an ancestor of `detailBodyText` (e.g. mis-wired **AI_UI_V2_Root**). Trip-plan refresh clears **`detailBodyText` only** — it does **not** toggle those roots.
 *
 * When **`packScanDetailText`** is set (e.g. `ScanDetail_Text_Body`), opening **any** category row
 * clears it so only **`detailBodyText`** shows — avoids overlapping two full-height panels without
 * disabling parents (which can crash when code still assigns `.text`).
 *
 * **Dropdown:** first pinch on a row opens a short menu (one line per option, map pin on places).
 * Each later pinch on the **same** row opens the next option only. After the last option, the panel collapses.
 *
 * **`onBeforeCategoryDetailChange`** runs first on each interaction so `AssistantTtsController` can cancel speech.
 */
@component
export class CategoryPlanDetailController extends BaseScriptComponent {
  @input
  @allowUndefined
  geminiAssistant: GeminiAssistant

  @input
  @hint('Six row roots (e.g. CategoryWidgetHolder_*), same order as planning categories.')
  categoryRowRoots: SceneObject[] = []

  @input
  @allowUndefined
  @hint('Multi-line beta copy (repurposed PriceWatch_Text in template scene).')
  detailBodyText: Text

  @input
  @allowUndefined
  @hint('Optional: live AccuWeather strip for Weather category detail.')
  weatherAccuBridge: WeatherAccuBridge

  @input
  @allowUndefined
  @hint('Optional: show a HUD object when Pack is opened (e.g. camera preview placeholder).')
  packScanHud: SceneObject

  @input
  @allowUndefined
  @hint(
    'Optional: **Pack-only** shell (e.g. a **Pack_HUD** object that does **not** contain `detailBodyText`). If this object is an ancestor of the category detail `Text` (e.g. **AI_UI_V2_Root**), it is **ignored** — wire a dedicated Pack parent instead.',
  )
  packScanFullHudRoot: SceneObject

  @input
  @allowUndefined
  @hint('Pack vision / status line (e.g. ScanDetail_Text_Body). Cleared when any category row opens so it does not overlap detailBodyText.')
  packScanDetailText: Text

  /** Last row the user opened — used to restore Pack copy after a cancelled Scan Pack session. */
  private lastOpenedCategory: TripPlanningCategory | null = null

  /** After first pinch on a row the panel is shown; later pinches step the dropdown, then collapse. */
  private categoryDetailPanelExpanded: boolean = false

  /**
   * -1 = compact menu of every option.
   * 0+ = only that option's short detail is open.
   */
  private dropdownFocusIndex: number = -1

  /** Fires before opening / refreshing / collapsing so TTS can cancel in-flight speech. */
  readonly onBeforeCategoryDetailChange: Event<TripPlanningCategory> = new Event<TripPlanningCategory>()

  /** Fires with the same multi-line body shown in `detailBodyText` (for optional TTS via `AssistantTtsController`). */
  readonly onCategoryDetailBody: Event<string> = new Event<string>()

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.bindRows()
      if (this.geminiAssistant) {
        this.geminiAssistant.onTripPlanReady.add(() => {
          this.clearDetail()
        })
      }
    })
  }

  private bindRows(): void {
    if (!this.geminiAssistant) {
      print('[CategoryPlanDetailController] Assign geminiAssistant.')
      return
    }
    const categories = this.geminiAssistant.getPlanningCategoriesResolved()
    for (let i = 0; i < this.categoryRowRoots.length && i < categories.length; i++) {
      const root = this.categoryRowRoots[i]
      const category = categories[i]
      if (!root) {
        continue
      }
      const inter = this.findInteractable(root)
      if (!inter) {
        print(
          `[CategoryPlanDetailController] No Interactable on "${root.name}". Add SIK Interactable + Collider to each category row (see scene CategoryWidgetHolder_*).`,
        )
        continue
      }
      inter.onInteractorTriggerEnd.add(() => {
        this.openCategoryDetail(category)
      })
    }
  }

  private openCategoryDetail(category: TripPlanningCategory, forceExpand: boolean = false): void {
    this.onBeforeCategoryDetailChange.invoke(category)

    const planForStep = this.geminiAssistant ? this.geminiAssistant.getLastTripPlan() : null
    const optionCount = this.optionCountFor(category, planForStep)
    const stepsDropdown = category !== 'pack' && category !== 'weather' && optionCount > 0

    if (
      !forceExpand &&
      this.lastOpenedCategory === category &&
      this.categoryDetailPanelExpanded
    ) {
      const nextFocus = this.dropdownFocusIndex + 1
      if (stepsDropdown && nextFocus < optionCount) {
        this.dropdownFocusIndex = nextFocus
      } else {
        this.dropdownFocusIndex = -1
        this.categoryDetailPanelExpanded = false
        this.clearDetailNow()
        if (this.packScanDetailText) {
          this.clearTextSafe(this.packScanDetailText)
        }
        if (category === 'pack') {
          this.setPackHudRootsEnabled(false)
        }
        this.setDetailBodySceneObjectEnabled(false)
        this.onCategoryDetailBody.invoke('')
        return
      }
    } else if (!forceExpand) {
      this.dropdownFocusIndex = -1
    }

    this.categoryDetailPanelExpanded = true
    this.lastOpenedCategory = category
    this.setDetailBodySceneObjectEnabled(true)

    const draft = this.geminiAssistant ? this.geminiAssistant.getTripDraft() : null
    const plan = this.geminiAssistant ? this.geminiAssistant.getLastTripPlan() : null
    const body = this.buildDetailBody(category, draft, plan, this.dropdownFocusIndex)
    if (category === 'accommodation' && plan && plan.cards && plan.cards.accommodation) {
      const opts = plan.cards.accommodation.options
      if (opts && opts.length > 0) {
        const o0 = opts[0]
        const sample = body.length > 320 ? `${body.substring(0, 320)}…` : body
        print(
          `[CategoryPlanDetail] open ${category} PlanPriceFormat r${PLAN_PRICE_FORMAT_REVISION} | opt0 pricePerNight=${JSON.stringify(
            o0.pricePerNight,
          )} | bodySample: ${sample.replace(/\n/g, ' | ')}`,
        )
      } else {
        print(`[CategoryPlanDetail] open ${category} but accommodation card has no options`)
      }
    } else if (category === 'accommodation') {
      print('[CategoryPlanDetail] open accommodation but getLastTripPlan() is null or missing card')
    }
    if (this.packScanDetailText) {
      this.clearTextSafe(this.packScanDetailText)
    }
    this.setPackHudRootsEnabled(category === 'pack')
    this.setDetail(body)
    this.onCategoryDetailBody.invoke(body)
  }

  private setPackHudRootsEnabled(enabled: boolean): void {
    if (this.packScanHud) {
      try {
        this.packScanHud.enabled = enabled
      } catch (e) {
        print(`[CategoryPlanDetailController] packScanHud.enabled: ${e}`)
      }
    }
    if (this.packScanFullHudRoot && !this.isPackScanFullHudRootAncestorOfDetailBody()) {
      try {
        this.packScanFullHudRoot.enabled = enabled
      } catch (e) {
        print(`[CategoryPlanDetailController] packScanFullHudRoot.enabled: ${e}`)
      }
    }
  }

  /**
   * If `packScanFullHudRoot` is an ancestor of `detailBodyText` (e.g. mis-wired **AI_UI_V2_Root**),
   * toggling it would blank the whole UI or fight `ensureDetailTextOwnerEnabled`. Skip in that case.
   */
  private isPackScanFullHudRootAncestorOfDetailBody(): boolean {
    if (!this.packScanFullHudRoot || !this.detailBodyText) {
      return false
    }
    try {
      let cur: SceneObject | null = this.detailBodyText.getSceneObject()
      let depth = 0
      while (cur && depth < 40) {
        if (cur === this.packScanFullHudRoot) {
          return true
        }
        cur = this.tryGetParentSceneObject(cur)
        depth++
      }
    } catch (_) {
      return false
    }
    return false
  }

  /**
   * Rebuilds the last opened category panel (e.g. after Scan Pack **Close** without a finished result).
   * Safe to call from `PackScanController` when optional wiring is present.
   */
  reapplyLastCategoryDetail(): void {
    if (this.lastOpenedCategory !== null) {
      this.openCategoryDetail(this.lastOpenedCategory, true)
    }
  }

  private clearDetail(): void {
    if (this.geminiAssistant && this.geminiAssistant.isPackScanDetailUiLocked()) {
      return
    }
    if (this.lastOpenedCategory !== null) {
      this.onBeforeCategoryDetailChange.invoke(this.lastOpenedCategory)
    }
    this.clearDetailNow()
  }

  private clearDetailNow(): void {
    this.categoryDetailPanelExpanded = false
    this.dropdownFocusIndex = -1
    this.setDetailBodySceneObjectEnabled(true)
    this.setDetail('')
  }

  private setDetailBodySceneObjectEnabled(enabled: boolean): void {
    if (!this.detailBodyText) {
      return
    }
    try {
      this.detailBodyText.getSceneObject().enabled = enabled
    } catch (e) {
      print(`[CategoryPlanDetailController] setDetailBodySceneObjectEnabled: ${e}`)
    }
  }

  private setDetail(msg: string): void {
    if (!this.detailBodyText) {
      return
    }
    if (this.packScanDetailText && this.detailBodyText === this.packScanDetailText) {
      print(
        '[CategoryPlanDetail] ERROR: detailBodyText and packScanDetailText reference the SAME Text. Category rows will fight Pack scan. Wire detailBodyText → CategoryDetailCard → CategoryDetail_Text (uuid differs from ScanDetail_Text_Body).',
      )
    }
    this.ensureDetailTextOwnerEnabled(this.detailBodyText)
    try {
      this.detailBodyText.text = msg
      this.logDetailBodyWriteIfNeeded(msg)
    } catch (e) {
      print(`[CategoryPlanDetailController] setDetail failed: ${e}`)
    }
  }

  /** Scene has two components named `CategoryDetail_Text`; only the card under CategoryDetailCard should be detailBodyText. */
  private describeTextParentChain(text: Text): string {
    const names: string[] = []
    try {
      let cur: SceneObject | null = text.getSceneObject()
      let depth = 0
      while (cur && depth < 14) {
        names.push(cur.name)
        cur = this.tryGetParentSceneObject(cur)
        depth++
      }
    } catch (_) {
      /* ignore */
    }
    return names.join(' < ')
  }

  private extractPerNightLine(block: string): string {
    const lines = block.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('Per night:') >= 0) {
        return lines[i].trim()
      }
    }
    return ''
  }

  private logDetailBodyWriteIfNeeded(msg: string): void {
    if (!msg || msg.indexOf('Per night:') < 0) {
      return
    }
    const chain = this.describeTextParentChain(this.detailBodyText)
    let runTarget = '?'
    try {
      const d = global.deviceInfoSystem
      runTarget = d && d.isEditor && d.isEditor() ? 'editor' : 'device'
    } catch (_) {
      runTarget = 'device'
    }
    const msgLine = this.extractPerNightLine(msg)
    let rbLine = ''
    let rbLen = 0
    try {
      const rb = this.detailBodyText.text
      rbLen = rb.length
      rbLine = this.extractPerNightLine(rb)
    } catch (e) {
      print(`[CategoryPlanDetail] readback failed after setDetail: ${e}`)
      return
    }
    print(`[CategoryPlanDetail] setDetail hostChain="${chain}" run=${runTarget}`)
    if (chain.indexOf('ScanDetail_Text_Body') >= 0 && chain.indexOf('CategoryDetailCard_Placeholder') < 0) {
      print(
        '[CategoryPlanDetail] ERROR: detailBodyText lives under ScanDetail_Text_Body. That is the Pack scan line — wire detailBodyText to CategoryDetailCard → CategoryDetail_Text_Body → CategoryDetail_Text instead.',
      )
    }
    print(`[CategoryPlanDetail] setDetail msg Per night line: ${msgLine}`)
    print(`[CategoryPlanDetail] setDetail readback (same frame) len=${rbLen} Per night line: ${rbLine}`)
    if (msgLine.length > 0 && msgLine !== rbLine) {
      print(
        `[CategoryPlanDetail] MISMATCH same frame — Text API dropped/changed content. msgLen=${msg.length} See hostChain above.`,
      )
    }
    const expect = msgLine
    const ev = this.createEvent('DelayedCallbackEvent')
    ev.bind(() => {
      let late = ''
      try {
        late = this.extractPerNightLine(this.detailBodyText.text)
      } catch (_) {
        return
      }
      print(`[CategoryPlanDetail] readback +150ms Per night line: ${late}`)
      if (expect.length > 0 && late !== expect) {
        print(
          '[CategoryPlanDetail] MISMATCH +150ms — another script likely overwrote this Text (e.g. PackScan setPackDetailBody to packScanResultText if mis-wired to same component).',
        )
      }
    })
    ev.reset(0.15)
  }

  private clearTextSafe(text: Text): void {
    if (!text) {
      return
    }
    this.ensureDetailTextOwnerEnabled(text)
    try {
      text.text = ''
    } catch (e) {
      print(`[CategoryPlanDetailController] clearTextSafe failed: ${e}`)
    }
  }

  /**
   * Same guard as `PackScanController`: assigning `.text` while any ancestor is disabled can
   * hard-crash some Spectacles builds.
   */
  private ensureDetailTextOwnerEnabled(text: Text): void {
    let cur: SceneObject | null = null
    try {
      cur = text.getSceneObject()
    } catch (e) {
      print(`[CategoryPlanDetailController] ensureDetailTextOwnerEnabled getSceneObject: ${e}`)
      return
    }
    let depth = 0
    while (cur && depth < 20) {
      try {
        if (!cur.enabled) {
          cur.enabled = true
        }
      } catch (e) {
        print(`[CategoryPlanDetailController] ensureDetailTextOwnerEnabled enable: ${e}`)
        break
      }
      cur = this.tryGetParentSceneObject(cur)
      depth++
    }
  }

  private tryGetParentSceneObject(so: SceneObject): SceneObject | null {
    try {
      const fn = (so as any).getParent as undefined | (() => SceneObject | null)
      if (typeof fn === 'function') {
        const p = fn.call(so) as SceneObject | null
        return p || null
      }
    } catch (_) {
      /* getParent unsupported */
    }
    return null
  }

  private optionCountFor(category: TripPlanningCategory, plan: TripPlanResponse | null): number {
    const card = plan && plan.cards ? plan.cards[category] : undefined
    if (!card || !card.options) {
      return 0
    }
    return card.options.length
  }

  private buildDetailBody(
    category: TripPlanningCategory,
    draft: TripDraft | null,
    plan: TripPlanResponse | null,
    focusIndex: number,
  ): string {
    const card = plan && plan.cards ? plan.cards[category] : undefined
    if (category !== 'pack' && category !== 'weather' && card && card.options && card.options.length > 0) {
      if (focusIndex < 0) {
        return this.buildDropdownMenu(category, card)
      }
      return this.buildFocusedOption(category, card, draft, focusIndex)
    }

    const lines: string[] = []
    const title = category === 'pack' ? this.capitalize(category) : this.capitalize(category)
    lines.push(title)

    switch (category) {
      case 'accommodation':
        lines.push(...this.formatAccommodation(card, draft))
        break
      case 'transportation':
        lines.push(...this.formatTransportation(card, draft))
        break
      case 'places':
        lines.push(...this.formatPlaces(card, draft))
        break
      case 'restaurants':
        lines.push(...this.formatRestaurants(card, draft))
        break
      case 'weather':
        lines.push(...this.formatWeather(card, draft))
        break
      case 'pack':
        lines.push(...this.formatPack(card, draft))
        break
      default:
        lines.push(this.fallbackOptionsBlock(card))
    }

    return lines.join('\n')
  }

  private buildDropdownMenu(category: TripPlanningCategory, card: CategoryCardData): string {
    const lines: string[] = []
    lines.push(this.capitalize(category))
    const options = card.options || []
    const limit = Math.min(options.length, 4)
    for (let i = 0; i < limit; i++) {
      lines.push(this.menuLine(options[i], i, category))
    }
    if (options.length > limit) {
      lines.push(`+${options.length - limit} more`)
    }
    lines.push('Pinch again to open 1')
    return lines.join('\n')
  }

  private menuLine(option: CategoryOption, index: number, category: TripPlanningCategory): string {
    const title = this.clip(sanitizeEmbeddedPricesInText(option.title || 'Option'), 36)
    const price = this.shortPrice(option)
    const priceBit = price.length > 0 ? ` · ${price}` : ''
    const pin = optionShowsMapPin(option, category) ? `  ${MAP_PIN}` : ''
    return `${index + 1}  ${title}${priceBit}${pin}`
  }

  private buildFocusedOption(
    category: TripPlanningCategory,
    card: CategoryCardData,
    draft: TripDraft | null,
    focusIndex: number,
  ): string {
    const options = card.options || []
    const safeIndex = focusIndex >= 0 && focusIndex < options.length ? focusIndex : 0
    const sliced: CategoryCardData = {
      category: card.category,
      options: [options[safeIndex]],
    }
    const lines: string[] = []
    lines.push(`${this.capitalize(category)} · ${safeIndex + 1}/${options.length}`)
    const option = options[safeIndex]
    if (optionShowsMapPin(option, category)) {
      const where = (option.placeName || option.neighborhood || option.title || '').trim()
      const hint = option.mapHint && option.mapHint.trim().length > 0 ? ` — ${this.clip(option.mapHint.trim(), 64)}` : ''
      lines.push(`${MAP_PIN} ${this.clip(sanitizeEmbeddedPricesInText(where), 48)}${hint}`)
    }
    switch (category) {
      case 'accommodation':
        lines.push(...this.formatAccommodation(sliced, draft))
        break
      case 'transportation':
        lines.push(...this.formatTransportation(sliced, draft))
        break
      case 'places':
        lines.push(...this.formatPlaces(sliced, draft))
        break
      case 'restaurants':
        lines.push(...this.formatRestaurants(sliced, draft))
        break
      default:
        lines.push(this.fallbackOptionsBlock(sliced))
    }
    if (safeIndex + 1 < options.length) {
      lines.push(`Pinch for ${safeIndex + 2}`)
    } else {
      lines.push('Pinch to close')
    }
    return lines.join('\n')
  }

  private shortPrice(option: CategoryOption): string {
    const raw = option.pricePerNight || option.price || option.pricePerPerson || option.totalStayPrice || ''
    if (!raw) {
      return ''
    }
    return this.clip(formatModelPriceHint(raw), 22)
  }

  private clip(text: string, max: number): string {
    const t = (text || '').replace(/\s+/g, ' ').trim()
    if (t.length <= max) {
      return t
    }
    return `${t.substring(0, max - 1)}…`
  }

  private formatAccommodation(card: CategoryCardData | undefined, draft: TripDraft | null): string[] {
    const out: string[] = []
    const hasDates = !!(draft && draft.departureDateTime && draft.arrivalDateTime)
    if (card && card.options && card.options.length > 0) {
      const blocks: string[] = []
      for (let i = 0; i < card.options.length; i++) {
        blocks.push(this.formatOneAccommodation(card.options[i], i + 1, hasDates).join('\n'))
      }
      return [blocks.join('\n\n')]
    }
    out.push('Example (no model rows yet):')
    out.push(`Stay: Hotel near ${draft && draft.destinationCity ? draft.destinationCity : 'destination'}`)
    out.push(hasDates ? 'Price: from €X / night when dates confirmed' : 'Price: from €X / night')
    return out
  }

  private formatOneAccommodation(o: CategoryOption, index: number, hasDates: boolean): string[] {
    const title = sanitizeEmbeddedPricesInText(o.title || 'Hotel option')
    const line: string[] = []
    line.push(`Option ${index}: ${title}`)
    if (o.sourceSite && o.sourceSite.length > 0 && o.sourceSite.length < 48) {
      line.push(`Book via: ${o.sourceSite}`)
    }
    if (o.provider && o.provider.length > 0 && o.provider !== o.sourceSite && o.provider.length < 48) {
      line.push(`${o.provider}`)
    }
    if (o.pricePerNight) {
      line.push(`Per night: ${formatModelPriceHint(o.pricePerNight)}`)
    }
    if (hasDates && o.totalStayPrice) {
      line.push(`Full stay: ${formatModelPriceHint(o.totalStayPrice)}`)
    } else if (o.price) {
      line.push(`Price: ${formatModelPriceHint(o.price)}`)
    }
    if (o.notes && o.notes.length > 0 && o.notes.length < 200) {
      line.push(`Note: ${sanitizeEmbeddedPricesInText(o.notes)}`)
    }
    return line
  }

  private formatTransportation(card: CategoryCardData | undefined, draft: TripDraft | null): string[] {
    const out: string[] = []
    const fullTrip =
      draft &&
      draft.departureCity &&
      draft.destinationCity &&
      draft.departureCity !== draft.destinationCity &&
      draft.departureDateTime &&
      draft.arrivalDateTime
    if (card && card.options && card.options.length > 0) {
      const blocks: string[] = []
      for (let i = 0; i < card.options.length; i++) {
        blocks.push(this.formatOneTransport(card.options[i], i + 1, !!fullTrip, draft).join('\n'))
      }
      return [blocks.join('\n\n')]
    }
    out.push('Example: Skyscanner-style')
    out.push(`Route: ${draft ? draft.departureCity : 'Origin'} → ${draft ? draft.destinationCity : 'Destination'}`)
    if (fullTrip) {
      out.push('Airline rows appear when the plan returns options.')
    } else {
      out.push('Local / day-trip transit when dates or route are partial.')
    }
    return out
  }

  private formatOneTransport(o: CategoryOption, index: number, showLegs: boolean, draft: TripDraft | null): string[] {
    const line: string[] = []
    line.push(`Option ${index}: ${sanitizeEmbeddedPricesInText(o.title || 'Offer')}`)
    if (o.airline) {
      line.push(`${o.airline}`)
    }
    if (o.sourceSite && o.sourceSite.length > 0 && o.sourceSite.length < 48) {
      line.push(`Via: ${o.sourceSite}`)
    } else if (o.provider && o.provider.length > 0 && o.provider.length < 48) {
      line.push(`${o.provider}`)
    }
    if (o.price) {
      line.push(`Best price: ${formatModelPriceHint(o.price)}`)
    }
    if (showLegs) {
      if (o.outboundSummary) {
        line.push(`Outbound: ${sanitizeEmbeddedPricesInText(o.outboundSummary)}`)
      } else if (o.departureTime) {
        line.push(`Outbound: ${o.departureTime}${draft ? ` from ${draft.departureCity}` : ''}`)
      }
      if (o.inboundSummary) {
        line.push(`Return: ${sanitizeEmbeddedPricesInText(o.inboundSummary)}`)
      } else if (o.arrivalTime) {
        line.push(`Return: ${o.arrivalTime}`)
      }
    }
    if (o.notes && o.notes.length > 0 && o.notes.length < 200) {
      line.push(`Note: ${sanitizeEmbeddedPricesInText(o.notes)}`)
    }
    return line
  }

  private formatPlaces(card: CategoryCardData | undefined, draft: TripDraft | null): string[] {
    const out: string[] = []
    if (card && card.options && card.options.length > 0) {
      const blocks: string[] = []
      for (let i = 0; i < card.options.length; i++) {
        const o = card.options[i]
        const chunk: string[] = []
        chunk.push(`Option ${i + 1}: ${sanitizeEmbeddedPricesInText(o.title)}`)
        if (o.ticketOfficeHint) {
          chunk.push(`In person: ${sanitizeEmbeddedPricesInText(o.ticketOfficeHint)}`)
        } else if (o.notes && !/^https?:/i.test(o.notes)) {
          chunk.push(`Tickets: ${sanitizeEmbeddedPricesInText(o.notes)}`)
        }
        if (o.price) {
          chunk.push(`From: ${formatModelPriceHint(o.price)}`)
        }
        blocks.push(chunk.join('\n'))
      }
      return [blocks.join('\n\n')]
    }
    out.push(`Attractions near ${draft && draft.destinationCity ? draft.destinationCity : 'destination'} — options fill when the plan returns rows.`)
    return out
  }

  private formatRestaurants(card: CategoryCardData | undefined, draft: TripDraft | null): string[] {
    const out: string[] = []
    if (card && card.options && card.options.length > 0) {
      const blocks: string[] = []
      for (let i = 0; i < card.options.length; i++) {
        const o = card.options[i]
        const chunk: string[] = []
        chunk.push(`Option ${i + 1}: ${sanitizeEmbeddedPricesInText(o.title)}`)
        if (o.pricePerPerson) {
          chunk.push(`Est. per person: ${formatModelPriceHint(o.pricePerPerson)}`)
        } else if (o.price) {
          chunk.push(`Price: ${formatModelPriceHint(o.price)}`)
        }
        if (o.neighborhood) {
          chunk.push(`Area: ${o.neighborhood}`)
        }
        if (o.dressCode) {
          chunk.push(`Dress: ${o.dressCode}`)
        }
        if (o.notes && o.notes.length > 0 && o.notes.length < 180) {
          chunk.push(`${sanitizeEmbeddedPricesInText(o.notes)}`)
        }
        blocks.push(chunk.join('\n'))
      }
      return [blocks.join('\n\n')]
    }
    out.push(`Dining in ${draft && draft.destinationCity ? draft.destinationCity : 'destination'} — prices and area fill when the plan returns rows.`)
    return out
  }

  private formatWeather(card: CategoryCardData | undefined, draft: TripDraft | null): string[] {
    const out: string[] = []
    if (card && card.options && card.options.length > 0) {
      const blocks: string[] = []
      for (let i = 0; i < card.options.length; i++) {
        const o = card.options[i]
        const chunk: string[] = []
        chunk.push(`${sanitizeEmbeddedPricesInText(o.title)}`)
        if (o.weatherPracticalTips) {
          chunk.push(`Tips: ${sanitizeEmbeddedPricesInText(o.weatherPracticalTips)}`)
        }
        if (o.notes) {
          chunk.push(`${sanitizeEmbeddedPricesInText(o.notes)}`)
        }
        blocks.push(chunk.join('\n'))
      }
      out.push(blocks.join('\n\n'))
    } else {
      out.push('Wear / layers for forecast, rain spikes, UV if outdoors-heavy.')
    }
    let liveStrip = ''
    if (this.weatherAccuBridge) {
      liveStrip = this.weatherAccuBridge.getLastSummary().trim()
      if (liveStrip.length > 0) {
        out.push(`Live: ${liveStrip}`)
      }
    }
    if (draft && draft.destinationCity && liveStrip.length === 0) {
      out.push(`Place: ${draft.destinationCity}`)
    }
    return out
  }

  private formatPack(card: CategoryCardData | undefined, draft: TripDraft | null): string[] {
    const out: string[] = []
    out.push('Bag face')
    out.push('Fill the frame with the front of the bag, then Capture.')
    out.push('You get a size class and a fee warning if it looks too big.')
    if (card && card.options && card.options.length > 0) {
      out.push('Suggested from plan:')
      for (let i = 0; i < card.options.length; i++) {
        const o = card.options[i]
        const hint = o.luggageVisionHint ? sanitizeEmbeddedPricesInText(o.luggageVisionHint) : ''
        out.push(`• ${sanitizeEmbeddedPricesInText(o.title)}${hint ? ` — ${hint}` : ''}`)
        if (o.notes) {
          out.push(`  ${sanitizeEmbeddedPricesInText(o.notes)}`)
        }
      }
    } else if (draft) {
      out.push(`Trip: ${draft.destinationCity || draft.departureCity} · ${draft.purpose}`)
    }
    return out
  }

  private fallbackOptionsBlock(card: CategoryCardData | undefined): string {
    if (!card || !card.options) {
      return 'No options in last plan.'
    }
    return card.options
      .map((o) => `${sanitizeEmbeddedPricesInText(o.title)} (${o.provider})`)
      .join('\n')
  }

  private capitalize(s: string): string {
    if (!s || s.length === 0) {
      return s
    }
    return s.substring(0, 1).toUpperCase() + s.substring(1)
  }

  private findInteractable(root: SceneObject): Interactable | null {
    const direct = root.getComponent(Interactable.getTypeName()) as Interactable
    if (direct) {
      return direct
    }
    const n = root.getChildrenCount()
    for (let i = 0; i < n; i++) {
      const nested = this.findInteractable(root.getChild(i))
      if (nested) {
        return nested
      }
    }
    return null
  }
}
