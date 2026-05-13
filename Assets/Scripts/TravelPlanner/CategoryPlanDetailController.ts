import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable'
import { GeminiAssistant } from './GeminiAssistant'
import { WeatherAccuBridge } from './WeatherAccuBridge'
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
 * **Pack**: enables `packScanHud` when the Pack row is opened. Copy is user-facing; wiring notes
 * belong in `SCENE_SETUP.md` / Logger only.
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

  private openCategoryDetail(category: TripPlanningCategory): void {
    const draft = this.geminiAssistant ? this.geminiAssistant.getTripDraft() : null
    const plan = this.geminiAssistant ? this.geminiAssistant.getLastTripPlan() : null
    const body = this.buildDetailBody(category, draft, plan)
    this.setDetail(body)
    if (category === 'pack' && this.packScanHud) {
      this.packScanHud.enabled = true
    }
  }

  private clearDetail(): void {
    if (this.packScanHud) {
      this.packScanHud.enabled = false
    }
    this.setDetail('')
  }

  private setDetail(msg: string): void {
    if (this.detailBodyText) {
      this.detailBodyText.text = msg
    }
  }

  private buildDetailBody(
    category: TripPlanningCategory,
    draft: TripDraft | null,
    plan: TripPlanResponse | null,
  ): string {
    const card = plan && plan.cards ? plan.cards[category] : undefined
    const lines: string[] = []
    const title =
      category === 'pack' ? `— ${this.capitalize(category)} —` : `— ${this.capitalize(category)} (beta) —`
    lines.push(title)
    lines.push('')

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

  /** Model sometimes prints "from 0400" without € — normalize for on-lens readability. */
  private prettifyModelPriceHint(raw: string): string {
    if (!raw || raw.length === 0) {
      return raw
    }
    let s = raw
    if (!/[€$£¥]/.test(s)) {
      s = s.replace(/\b(from|around|~|approx\.?)\s+0+(\d{2,5})\b/gi, (_m, p, n) => `${p} €${parseInt(n, 10)}`)
    } else {
      s = s.replace(/\b(from|around|~|approx\.?)\s+0+(\d{2,5})\b/gi, (_m, p, n) => `${p} ${parseInt(n, 10)}`)
    }
    return s
  }

  private formatAccommodation(card: CategoryCardData | undefined, draft: TripDraft | null): string[] {
    const out: string[] = []
    const hasDates = !!(draft && draft.departureDateTime && draft.arrivalDateTime)
    if (card && card.options && card.options.length > 0) {
      for (let i = 0; i < card.options.length; i++) {
        out.push(...this.formatOneAccommodation(card.options[i], i + 1, hasDates))
        out.push('')
      }
      return out
    }
    out.push('Example (no model rows yet):')
    out.push('Compare rates: Google Hotels · Trivago · Kayak Hotels')
    out.push(`Stay: Hotel near ${draft && draft.destinationCity ? draft.destinationCity : 'destination'}`)
    out.push(hasDates ? 'Price: from €X / night · full stay estimate when dates confirmed' : 'Price: from €X / night (add trip dates for stay total)')
    return out
  }

  private formatOneAccommodation(o: CategoryOption, index: number, hasDates: boolean): string[] {
    const title = o.title || 'Hotel option'
    const line: string[] = []
    line.push(`Option ${index}`)
    if (o.sourceSite && o.sourceSite.length > 0) {
      line.push(`Compare / book via: ${o.sourceSite}`)
    }
    if (o.provider && o.provider.length > 0 && o.provider !== o.sourceSite) {
      line.push(`Chain / property: ${o.provider}`)
    } else if (!o.sourceSite || o.sourceSite.length === 0) {
      line.push(`Source: ${o.provider || 'OTA / hotel site'}`)
    }
    line.push(`Stay: ${title}`)
    if (o.pricePerNight) {
      line.push(`Per night: ${this.prettifyModelPriceHint(o.pricePerNight)}`)
    }
    if (hasDates && o.totalStayPrice) {
      line.push(`Full stay (with your dates): ${this.prettifyModelPriceHint(o.totalStayPrice)}`)
    } else if (o.price) {
      line.push(`Price: ${this.prettifyModelPriceHint(o.price)}`)
    }
    if (o.bookingProductUrl) {
      line.push(`Link: ${o.bookingProductUrl}`)
    }
    if (o.notes) {
      line.push(`Note: ${o.notes}`)
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
      for (let i = 0; i < card.options.length; i++) {
        out.push(...this.formatOneTransport(card.options[i], i + 1, !!fullTrip, draft))
        out.push('')
      }
      return out
    }
    out.push('Example: Skyscanner-style')
    out.push(`Route: ${draft ? draft.departureCity : 'Origin'} → ${draft ? draft.destinationCity : 'Destination'}`)
    if (fullTrip) {
      out.push('Outbound / return: add airline + best price when plan returns rows.')
    } else {
      out.push('Local / day-trip transit — long-haul omitted or dates missing.')
    }
    return out
  }

  private formatOneTransport(o: CategoryOption, index: number, showLegs: boolean, draft: TripDraft | null): string[] {
    const line: string[] = []
    line.push(`Option ${index}`)
    if (o.sourceSite && o.sourceSite.length > 0) {
      line.push(`Compare / book via: ${o.sourceSite}`)
    }
    if (o.provider && o.provider.length > 0 && o.provider !== o.sourceSite) {
      line.push(`Provider / airline: ${o.provider}`)
    } else if (!o.sourceSite || o.sourceSite.length === 0) {
      line.push(`Source: ${o.provider || 'price comparison site'}`)
    }
    if (o.airline) {
      line.push(`Airline: ${o.airline}`)
    }
    line.push(`Offer: ${o.title}`)
    if (o.price) {
      line.push(`Best price: ${this.prettifyModelPriceHint(o.price)}`)
    }
    if (showLegs) {
      if (o.outboundSummary) {
        line.push(`Outbound: ${o.outboundSummary}`)
      } else if (o.departureTime) {
        line.push(`Outbound: ${o.departureTime}${draft ? ` from ${draft.departureCity}` : ''}`)
      }
      if (o.inboundSummary) {
        line.push(`Return: ${o.inboundSummary}`)
      } else if (o.arrivalTime) {
        line.push(`Return: ${o.arrivalTime}`)
      }
    }
    if (o.bookingProductUrl) {
      line.push(`Book: ${o.bookingProductUrl}`)
    }
    if (o.ticketUrl) {
      line.push(`Search link: ${o.ticketUrl}`)
    }
    if (o.notes) {
      line.push(`Note: ${o.notes}`)
    }
    return line
  }

  private formatPlaces(card: CategoryCardData | undefined, draft: TripDraft | null): string[] {
    const out: string[] = []
    if (card && card.options && card.options.length > 0) {
      for (let i = 0; i < card.options.length; i++) {
        const o = card.options[i]
        out.push(`Option ${i + 1}: ${o.title}`)
        if (o.ticketUrl) {
          out.push(`Tickets online: ${o.ticketUrl}`)
        }
        if (o.ticketOfficeHint) {
          out.push(`In person: ${o.ticketOfficeHint}`)
        }
        if (!o.ticketUrl && !o.ticketOfficeHint && o.notes) {
          out.push(`Tickets: ${o.notes}`)
        }
        if (o.price) {
          out.push(`From: ${o.price}`)
        }
        out.push('')
      }
      return out
    }
    out.push(`Attractions near ${draft && draft.destinationCity ? draft.destinationCity : 'destination'} — ticket links appear when the plan includes them.`)
    return out
  }

  private formatRestaurants(card: CategoryCardData | undefined, draft: TripDraft | null): string[] {
    const out: string[] = []
    if (card && card.options && card.options.length > 0) {
      for (let i = 0; i < card.options.length; i++) {
        const o = card.options[i]
        out.push(`Option ${i + 1}: ${o.title}`)
        if (o.pricePerPerson) {
          out.push(`Est. per person: ${o.pricePerPerson}`)
        } else if (o.price) {
          out.push(`Price: ${o.price}`)
        }
        if (o.neighborhood) {
          out.push(`Area: ${o.neighborhood}`)
        }
        if (o.dressCode) {
          out.push(`Dress code: ${o.dressCode}`)
        }
        if (o.notes) {
          out.push(`Info: ${o.notes}`)
        }
        out.push('')
      }
      return out
    }
    out.push(`Dining in ${draft && draft.destinationCity ? draft.destinationCity : 'destination'} — est. €/person + area + dress code when the model fills fields.`)
    return out
  }

  private formatWeather(card: CategoryCardData | undefined, draft: TripDraft | null): string[] {
    const out: string[] = []
    if (card && card.options && card.options.length > 0) {
      for (let i = 0; i < card.options.length; i++) {
        const o = card.options[i]
        out.push(`${o.title}`)
        if (o.weatherPracticalTips) {
          out.push(`Tips: ${o.weatherPracticalTips}`)
        }
        if (o.notes) {
          out.push(`${o.notes}`)
        }
        out.push('')
      }
    } else {
      out.push('What to show here:')
      out.push('• What to wear / pack for conditions')
      out.push('• Rain or heat spikes during your dates')
      out.push('• UV / daylight if outdoors-heavy trip')
      out.push('')
    }
    if (this.weatherAccuBridge) {
      const live = this.weatherAccuBridge.getLastSummary()
      if (live && live.length > 0) {
        out.push('Live strip (AccuWeather):')
        out.push(live)
      }
    }
    if (draft && draft.destinationCity) {
      out.push('')
      out.push(`Location context: ${draft.destinationCity}`)
    }
    return out
  }

  private formatPack(card: CategoryCardData | undefined, draft: TripDraft | null): string[] {
    const out: string[] = []
    out.push('Packed items')
    out.push('')
    out.push('Pinch Scan Pack in the HUD to open the session; status and results appear in this panel (same text as other categories). Use Capture when ready.')
    if (card && card.options && card.options.length > 0) {
      out.push('')
      out.push('Suggested items from plan:')
      for (let i = 0; i < card.options.length; i++) {
        const o = card.options[i]
        out.push(`• ${o.title}${o.luggageVisionHint ? ` — ${o.luggageVisionHint}` : ''}`)
        if (o.notes) {
          out.push(`  ${o.notes}`)
        }
      }
    } else if (draft) {
      out.push('')
      out.push(`Trip: ${draft.destinationCity || draft.departureCity} · ${draft.purpose}`)
    }
    return out
  }

  private fallbackOptionsBlock(card: CategoryCardData | undefined): string {
    if (!card || !card.options) {
      return 'No options in last plan.'
    }
    return card.options.map((o) => `${o.title} (${o.provider})`).join('\n')
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
