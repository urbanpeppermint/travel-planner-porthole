/**
 * Optional category prompts for destination image generation (RSG / Imagen-style).
 * Enable “category prompt” mode on `DestinationVisualizer` and set `sceneCategory`.
 */
export type DestinationSceneCategory =
  | 'overview'
  | 'stay'
  | 'routes'
  | 'food'
  | 'places'
  | 'adventure'
  | 'weather'

const SCENE_PROMPTS: Record<DestinationSceneCategory, string> = {
  overview:
    'Wide establishing shot of {destination}, travel photography, no people',
  stay: 'Interior of a beautiful hotel room in {destination}, warm lighting, no people',
  routes:
    'Scenic transit or railway corridor near {destination}, travel photography, no people',
  food: 'Colorful local food market in {destination}, street food scene, no faces',
  places:
    'Famous landmark in {destination}, golden hour, architectural detail, no people',
  adventure:
    'Dramatic outdoor landscape near {destination}, adventure mood, no people',
  weather:
    'Aerial cityscape of {destination} on a {weather} day, photorealistic drone shot',
}

export function buildCategoryPrompt(
  destination: string,
  category: DestinationSceneCategory,
  weatherPhrase: string = 'clear',
): string {
  const template = SCENE_PROMPTS[category] ?? SCENE_PROMPTS.overview
  return template
    .replace(/\{destination\}/g, destination)
    .replace(/\{city\}/g, destination)
    .replace(/\{weather\}/g, weatherPhrase)
}

export function parseSceneCategory(value: string): DestinationSceneCategory {
  const normalized = (value || '').toLowerCase()
  switch (normalized) {
    case 'stay':
    case 'routes':
    case 'food':
    case 'places':
    case 'adventure':
    case 'weather':
      return normalized
    default:
      return 'overview'
  }
}
