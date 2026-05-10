/**
 * In-memory trip draft for the planner UI. Replace or extend when you add persistence or APIs.
 */
export class TripState {
  destination: string = ''
  /** Trip purpose / vibe from occasion buttons (leisure, business, bleisure). */
  occasion: string = ''

  setDestination(name: string): void {
    this.destination = name
  }

  setOccasion(label: string): void {
    this.occasion = label
  }

  toDisplayString(): string {
    const dest = this.destination.length > 0 ? this.destination : '(set via voice / assistant)'
    const occ = this.occasion.length > 0 ? this.occasion : '(pick occasion)'
    return `Occasion: ${occ}\nDestination: ${dest}\n\nUse voice or keyboard intake to add dates and trip details.`
  }
}
