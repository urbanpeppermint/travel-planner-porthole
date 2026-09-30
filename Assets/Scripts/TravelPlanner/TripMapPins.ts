/**
 * Shared map-pin extraction for the compact category dropdown and the floating map list.
 * Pins are labels, not live GPS routes.
 */

import { CategoryOption, TripPlanResponse, TripPlanningCategory } from './TripTypes'

/** Shown beside any suggested place, hotel, restaurant, or station. */
export const MAP_PIN = '⌖'

const PIN_CATEGORIES: TripPlanningCategory[] = ['accommodation', 'places', 'restaurants', 'transportation']

export interface TripMapPin {
  label: string
  category: TripPlanningCategory
  hint: string
}

export function optionShowsMapPin(option: CategoryOption, category: TripPlanningCategory): boolean {
  if (PIN_CATEGORIES.indexOf(category) < 0) {
    return false
  }
  if (category === 'transportation') {
    return !!(option.placeName && option.placeName.trim().length > 0)
  }
  const label = pinLabel(option)
  return label.length > 0
}

export function pinLabel(option: CategoryOption): string {
  const named = (option.placeName || '').trim()
  if (named.length > 0) {
    return named
  }
  const area = (option.neighborhood || '').trim()
  if (area.length > 0) {
    return area
  }
  return (option.title || '').trim()
}

export function collectMapPins(plan: TripPlanResponse | null, maxPins: number = 8): TripMapPin[] {
  const pins: TripMapPin[] = []
  if (!plan || !plan.cards) {
    return pins
  }
  for (let c = 0; c < PIN_CATEGORIES.length; c++) {
    const category = PIN_CATEGORIES[c]
    const card = plan.cards[category]
    if (!card || !card.options) {
      continue
    }
    for (let i = 0; i < card.options.length; i++) {
      const option = card.options[i]
      if (!optionShowsMapPin(option, category)) {
        continue
      }
      const label = pinLabel(option)
      if (label.length === 0 || hasPinLabel(pins, label)) {
        continue
      }
      pins.push({
        label: clip(label, 42),
        category,
        hint: clip((option.mapHint || option.neighborhood || '').trim(), 72),
      })
      if (pins.length >= maxPins) {
        return pins
      }
    }
  }
  return pins
}

function hasPinLabel(pins: TripMapPin[], label: string): boolean {
  const key = label.toLowerCase()
  for (let i = 0; i < pins.length; i++) {
    if (pins[i].label.toLowerCase() === key) {
      return true
    }
  }
  return false
}

function clip(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  return `${text.substring(0, max - 1)}…`
}
