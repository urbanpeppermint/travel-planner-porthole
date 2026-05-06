# Porthole — scene wiring

This guide matches `Assets/Scripts/TravelPlanner/`. The lens display name in the project file is **Porthole**.

## What you already have

The default Spectacles scene includes **SIK** (`MobileInteractor`, `HandVisual`, `MouseInteractor`, etc.). Do not delete those objects; `TravelPlannerController` expects `SIK.InteractionManager` at runtime.

---

## Part A — Planner UI (`TravelPlannerController`)

### 1. UI root (placeholders already in scene)

The scene includes **`App_Porthole`** at root with **`TravelPlanner_UI`** and **`PortholeSystem`**. Children **`SummaryText_Placeholder`**, **`Btn_Dest_*_Placeholder`**, **`Btn_Activity_*_Placeholder`**, **`Btn_ClearActivities_Placeholder`**, and the four **`_*Plane_Placeholder`** objects are empty **SceneObjects** for you to add **Text**, **Image + Screen Transform**, **Interactable** (SIK), and **Script** components in Lens Studio.

1. Select **`App_Porthole`** and tune **Transform** (defaults to about **Z = -60** cm in front of the user).
2. Or reparent **`TravelPlanner_UI`** / **`PortholeSystem`** as you prefer.

### 2. Summary text

Under `TravelPlanner_UI`, add **Text** (`SummaryText`), multiline, readable size.

### 3. Buttons

- Three **destination** objects with **Interactable** (e.g. SIK Pinch Button prefabs).
- Optional two **activity** buttons + optional **clear** button, each with **Interactable**.

### 4. Controller script

On `TravelPlanner_UI`, add **`TravelPlannerController`** and assign:

| Field | Assign |
| --- | --- |
| Summary Text | Your `Text` component |
| Destination Button A / B / C | SceneObjects with Interactable |
| Destination Name A / B / C | City strings (defaults Paris / Tokyo / New York) |
| Activity Button A / B, names | Optional |
| Clear Activities Button | Optional |
| **Destination Visualizer** | Optional — `DestinationVisualizer` on `PortholeSystem` (Part B) |
| **Enable Porthole On Destination Select** | On to open Porthole when a city is pinched |
| **Default Occasion** | `romantic`, `adventure`, or anything else (general mood in prompt) |
| **Default Weather Context** | Short phrase for the RSG prompt |

---

## Part B — Phase 16: Porthole (`DestinationVisualizer`)

### Overview

When RSG returns a **base64** image (JPEG/PNG), the script decodes it to a `Texture`, assigns it to three **Image** layers at different local **Z** depths, and applies **head parallax** from the device **Camera** rotation. A fourth optional **vignette** quad acts as the round “porthole” frame.

### 1. Remote Service Module (RSG)

1. In **Asset Browser**, add or select your **Remote Service Module** asset (authorized Snap remote service).
2. In the RSG / gateway configuration, add an API endpoint:

| Field | Value |
| --- | --- |
| Endpoint name | `generate_image` |
| Method | POST |
| Body (JSON) | `{ "prompt", "width", "height", "steps", "guidance_scale" }` |
| Success response | JSON with **base64** in `image`, `result`, or `b64` (optional `data:image/jpeg;base64,...` prefix is stripped). |

If your service returns only an **image URL**, either change the gateway to inline base64 or extend `DestinationVisualizer.generateDestinationImage` with **RemoteMediaModule** `loadResourceAsImageTexture` after resolving a `DynamicResource` from your own fetch endpoint (the script currently logs a hint when it sees `url` / `imageUrl` without base64).

### 2. Hierarchy

Create a sibling group (world or parented under your UI root):

```
PortholeSystem (SceneObject + DestinationVisualizer)
├── SkyPlane            (Image, start disabled)
├── MidPlane            (Image, start disabled)
├── ForegroundPlane     (Image, start disabled)
└── VignettePlane       (Image + circular mask material, optional, start disabled)
```

- Each plane: **Scene Object** with **Image** (and **Screen Transform** / mesh as your template requires).
- **Disable** all four by default so nothing flashes before the first generation.
- **Materials**: use a **separate material instance** per plane if you add `uvOffset` / `uvScale` uniforms for vertical cropping; otherwise all layers show the full frame (parallax depth still reads well).

**VignettePlane:** build a simple material (dark border, clear center, alpha blend) slightly closer to the user than the stack (e.g. less negative Z than `fgDepth`).

### 3. `DestinationVisualizer` inputs

Add **`DestinationVisualizer`** to `PortholeSystem` and wire:

| Field | Assign |
| --- | --- |
| Remote Service Module | Your RSG asset |
| Sky / Mid / Foreground Plane | The three SceneObjects with **Image** |
| Vignette Plane | Optional frame object |
| Camera | Optional — if empty, first **Camera** found under scene roots is used |
| Sky / Mid / Fg Depth | Local Z in cm (defaults −600 / −300 / −150) |
| Sky / Mid / Fg Parallax | Multipliers on yaw/pitch shift |
| Parallax Sensitivity | Scales lateral motion (default 100) |

Parallax runs on **`UpdateEvent`** inside the component (no extra wiring).

### 4. `NewInCityAssistant` (optional orchestrator)

For Gemini / WebView flows, add **`NewInCityAssistant`** to a logic object and assign **`Destination Visualizer`**. Call **`saveTripDetails(destination, occasion, weatherCtx)`** after trip confirmation, and **`dismissPorthole()`** when closing the WebView / clearing anti-tracking (same moment you clear browser state).

---

## Part C — Multi-shot prompts (optional)

`PortholePromptCatalog.ts` exports **`buildCategoryPrompt(destination, category)`** for overview / stay / food / places / adventure. Point a future category UI at these strings, or merge them into `DestinationVisualizer.buildImagePrompt` when you add tabs.

---

## Verify

1. **Preview** on device: pinch a destination → summary updates; if Porthole is wired, RSG runs and layers enable after decode.
2. Move head: foreground should drift more than sky.
3. Call **`dismiss()`** on `DestinationVisualizer` (or `NewInCityAssistant.dismissPorthole()`) to hide layers.

---

## Next steps

- **Headlock** / **Billboard** on `PortholeSystem` so the window stays readable.
- **Persistent storage** or backend for real trips.
- **Crossfade** between category prompts (material alpha or dual stacks) when you wire `PortholePromptCatalog`.
