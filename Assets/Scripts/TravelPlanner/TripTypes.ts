/**
 * Shared trip / service types (no runtime logic). Extend as you wire RSG, weather, and search.
 * Aligns with the phased build checklist in `travel-lens-master-spec.md`.
 */

export interface TripData {
  destination: string
  checkIn?: string
  checkOut?: string
  occasion?: string
  adults?: number
  originAirport?: string
}

export type PriceSource = 'hotel' | 'flight' | 'other'

export interface PriceRecord {
  source: PriceSource
  label: string
  amount: number
  currency: string
  capturedAt: number
  destinationKey: string
}

export interface WeatherCurrent {
  tempC: number
  condition: string
  locationKey?: string
}

export interface WeatherForecastDay {
  date: string
  highC: number
  lowC: number
  condition: string
}

export interface PackingItem {
  name: string
  rating: 'good' | 'pass' | 'bad'
  note?: string
}

export type TripPlanningCategory =
  | 'transportation'
  | 'accommodation'
  | 'places'
  | 'restaurants'
  | 'weather'
  | 'pack'

export type TripPurpose = 'leisure' | 'business' | 'bleisure'

export interface TripDraft {
  departureCity: string
  destinationCity: string
  departureDateTime: string
  arrivalDateTime: string
  purpose: TripPurpose
  /** When user is already at destination / local-only: omit long-distance transport in planning. */
  skipLongDistanceTransport: boolean
  /** Hobbies, food prefs, transport prefs (shortest/cheapest), family/work context — merged from voice. */
  voicePreferenceNotes: string
}

export interface CategoryOption {
  provider: string
  title: string
  price?: string
  departureTime?: string
  arrivalTime?: string
  notes?: string
  /** e.g. booking.com, Skyscanner, GetYourGuide — shown as “source” in beta detail panel */
  sourceSite?: string
  /** Optional deep link or search URL string */
  bookingProductUrl?: string
  pricePerNight?: string
  /** When user gave trip dates, model may estimate full-stay total */
  totalStayPrice?: string
  airline?: string
  outboundSummary?: string
  inboundSummary?: string
  ticketUrl?: string
  ticketOfficeHint?: string
  pricePerPerson?: string
  neighborhood?: string
  dressCode?: string
  /** Weather card: practical tips (layers, rain gear, UV) */
  weatherPracticalTips?: string
  /** Pack card: hint for vision / checklist */
  luggageVisionHint?: string
}

export interface CategoryCardData {
  category: TripPlanningCategory
  options: CategoryOption[]
}

export interface TripPlanResponse {
  summary?: string
  cards?: Partial<Record<TripPlanningCategory, CategoryCardData>>
}
