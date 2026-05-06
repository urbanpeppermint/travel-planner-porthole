/**
 * Optional multi-shot prompt variants for RSG. Swap `buildImagePrompt` in
 * `DestinationVisualizer` to use `buildCategoryPrompt` when you wire category UI.
 */
export type PortholeSceneCategory = 'overview' | 'stay' | 'food' | 'places' | 'adventure'

const SCENE_PROMPTS: Record<PortholeSceneCategory, string> = {
  overview: 'Wide establishing shot of {destination}, travel photography, no people',
  stay: 'Interior of a beautiful hotel room in {destination}, warm lighting, no people',
  food: 'Colorful local food market in {destination}, street food scene, no faces',
  places: 'Famous landmark in {destination}, golden hour, architectural detail, no people',
  adventure: 'Dramatic outdoor landscape near {destination}, adventure mood, no people',
}

export function buildCategoryPrompt(destination: string, category: PortholeSceneCategory): string {
  const template = SCENE_PROMPTS[category] ?? SCENE_PROMPTS.overview
  return template.replace(/\{destination\}/g, destination)
}
