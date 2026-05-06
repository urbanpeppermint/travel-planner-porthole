/**
 * In-memory trip draft for the planner UI. Replace or extend when you add persistence or APIs.
 */
export class TripState {
  destination: string = ''
  activities: string[] = []

  setDestination(name: string): void {
    this.destination = name
  }

  addActivity(label: string): void {
    if (!label || label.length === 0) {
      return
    }
    const maxItems = 8
    if (this.activities.length >= maxItems) {
      this.activities.shift()
    }
    this.activities.push(label)
  }

  clearActivities(): void {
    this.activities = []
  }

  toDisplayString(): string {
    const dest = this.destination.length > 0 ? this.destination : '(pick a destination)'
    let out = `Destination: ${dest}\n`
    if (this.activities.length === 0) {
      out += '\nAdd activities with the side buttons.'
    } else {
      out += '\nItinerary:\n'
      for (let i = 0; i < this.activities.length; i++) {
        out += `${i + 1}. ${this.activities[i]}\n`
      }
    }
    return out
  }
}
