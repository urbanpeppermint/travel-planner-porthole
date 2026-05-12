## Travel Planner Scene Setup (current)

Scripts live in `Assets/Scripts/TravelPlanner/`.

### Core flow
- `GeminiAssistant` captures draft (voice or keyboard), requests plan, updates category rows.
- `AIAssistantUIBridge` wires buttons and keyboard step flow.
- `CategoryPlanDetailController` opens beta details when category rows are pinched.
- `PackScanController` runs Pack HUD scan checks via Gemini when Pack is open.
- `WeatherAccuBridge` fetches real weather from `Accuweather.remoteServiceModule`.

### Purpose labels
Only these three purpose labels are supported now:
- `Leisure`
- `Business`
- `Bleisure`

### Bottom buttons (recommended wiring)
- **Voice Mode pinch** → `AIAssistantUIBridge.startAssistantButton` — runs `beginAssistantSessionFromContext()` **and** `ASRQueryController.toggleRecording()` on every pinch (listen ↔ stop). No PinchButton on `ASRQueryController` anymore (avoids dead refs / double subscriptions).
- **Mic mute (SIK Toggle on Btn_Mic)** → `AIAssistantUIBridge.micMuteToggle` — toggles mute inside `ASRQueryController` (`toggleMicMuted()`). **ON = muted.** It does **not** start STT; use **Voice Mode** pinch for capture.
- **Plan Trip button** → `AIAssistantUIBridge.planTripButton`
- **Keyboard pinch** → `AIAssistantUIBridge.keyboardToggleButton`
- **Keyboard confirm pinch** → `AIAssistantUIBridge.keyboardConfirmButton`
- **Swap pinch handlers** → enable **`swapVoiceAndKeyboardPinchButtons`** on `AIAssistantUIBridge` only if gaze consistently hits the wrong capsule (overlapping colliders); otherwise keep **off** and fix hierarchy / assignments.

### Voice / hint text (scene)
- **`ASRQueryController.statusText`** → subtitle (`PromptSubtitle_Text` / `…042`) — **Listening…**, errors, and “Heard: …” (does **not** share the same line as keyboard step prompts if you keep prompts on `…042`—then listening overwrites the prompt while the mic is open; that is expected).
- **`ASRQueryController.hintEchoText`** → **VoiceHint** (`…044`): welcome + **final transcript** only. “Listening…” is **not** copied here so the hint line is not wiped while you read keyboard instructions on the subtitle.
- **`AIAssistantUIBridge.hintText`** → same VoiceHint line: bridge writes welcome + **last accepted utterance** after `handleSpeechTranscript`.
- If **Voice** and **KEYBOARD** feel reversed, first re-drag PinchButtons as above; if layout cannot be fixed, enable **`swapVoiceAndKeyboardPinchButtons`** instead of crossing wires in the Inspector.
- Duplicate legacy **`ASRQueryController`** scene object at project root is **disabled** so only the controller on `Assistant_System` drives transcription.

### AR keyboard for typed trip fields (Spectacles pattern)

Snap’s **Spatial Persistence** sample shows editing note text with **`global.textInputSystem.requestKeyboard(...)`** and a **SIK `ToggleButton`** (not the Voice pinch). Reference project: [Spectacles-Sample / Spatial Persistence](https://github.com/Snapchat/Spectacles-Sample/tree/main/Spatial%20Persistence).

**Step-by-step (Lens Studio)**

1. Clone or open the Spatial Persistence project (Git LFS required per their README).
2. Inspect **`TextInputManager.ts`** — it builds `TextInputSystem.KeyboardOptions`, sets `onTextChanged` to push characters into the bound `Text`, and calls `global.textInputSystem.requestKeyboard(this.options)` when the toggle turns on.
3. In **Travel Planner**, add an empty Scene Object (e.g. `TripTextInputManager`) and attach a script **copied or adapted** from that sample (same `require("LensStudio:TextInputModule")` / `global.textInputSystem` usage).
4. In the Hierarchy, add a **Toggle Button** prefab from **Spectacles Interaction Kit** next to your keyboard row (or repurpose a chip meant for “Edit text”).
5. Assign **`registerTextInput(toggle, text)`** (or equivalent) so the toggle opens the AR keyboard for **`keyboardEntryText`** — the same `Text` `AIAssistantUIBridge` reads on Confirm.
6. Ensure **`keyboardModeRoot`** shows that toggle while keyboard capture is active if you want it visible only in keyboard flow.
7. Build to **Spectacles** — `textInputSystem` behavior matches the sample (desktop Interactive Preview is limited compared to device).

> Note: `TextInputSystem.KeyboardOptions` paths live in the Spectacles / Lens Studio typings; if TypeScript complains locally, mirror the sample’s imports or cast `(global as any).textInputSystem` like other scripts in this project use for optional globals.

### Keyboard entry `Text` (critical)
- **`keyboardEntryText`** must be the **typed-value line** — in the default hierarchy use **`VoiceListening_Status_Text`** (`…045`), **not** `PromptTitle_Text` (`…041`) and **not** `VoiceHint_Text` (`…044`). Wrong assignment overwrites the title or mixes voice hints with the keyboard buffer.
- If the Inspector shows **`VoiceListening_Status_Text_Placeholder`**, assign the **child `Text`** named **`VoiceListening_Status_Text`**, not the placeholder root.

### Keyboard entry mode (optional)
Assign on `AIAssistantUIBridge`:
- `keyboardPromptText` → `PromptSubtitle_Text` (`…042`) for step instructions
- `keyboardModeRoot` → panel root shown only while keyboard mode is on (optional)

Step sequence:
1. departure city
2. destination city
3. departure date (`dd/mm/yyyy`)
4. arrival date (`dd/mm/yyyy`)

Each step requires pinch confirm.

### Pack Scan HUD (single-controller, package-backed)

Pack scan uses **one** controller — `PackScanController` — and the **CropCameraTexture** Asset Library package for the camera/crop texture work. There are no separate `CameraFeedController` / `CropPackScanController` scripts (those were removed; if you previously added them as components, delete the broken script components in the Lens Studio Inspector).

**Two trigger points** for Pack details (both already work, nothing to add):
- Pinch the **Scan Pack** PinchButton → opens a scan session in `PackScanController`.
- Tap the **Pack category title** interactable → `CategoryPlanDetailController` opens the HUD + detail panel and shows the last scan result. No new scan runs from this path.

**One-time scene setup:**

1. From **Asset Library**, add **`Crop Camera Texture`**. Drag the package's prefab `Packages/CropCameraTexture.lspkg/Assets/CropCameraTextureTS__PLACE_IN_SCENE.prefab` under `PackScanHUD_Placeholder`. The package starts the camera on lens load and drives the preview image automatically — no per-frame code needed from us.
2. In the Inspector for the package's `CameraTexture` script, set the crop rectangle (`cropLeft`, `cropRight`, `cropTop`, `cropBottom`, all in `-1..1`) so the **Crop mode** snapshot focuses on where the user will hold the bag (typically a centered square slightly below eye level).
3. Add three new **PinchButtons** under `PackScanHUD_Placeholder`:
   - `Btn_Capture_Pack`
   - `Btn_Crop_Pack`
   - `Btn_Close_Pack`
4. (Optional) Add a `CropHint_Root` SceneObject with a Text + dotted box visual.

**`PackScanController` inputs (assign in Inspector):**

| Input | Wire to |
|---|---|
| `geminiAssistant` | `GeminiAssistant` on `Assistant_System` |
| `scanButton` | PinchButton on `Btn_Scan_Pack` (existing) |
| `captureButton` | PinchButton on `Btn_Capture_Pack` |
| `cropScanButton` | PinchButton on `Btn_Crop_Pack` |
| `closeButton` | PinchButton on `Btn_Close_Pack` |
| `packScanHud` | `PackScanHUD_Placeholder` |
| `packHudText` | `PackScanHUD_Text` |
| `detailBodyText` | `CategoryDetail_Text` (persistent mirror) |
| `observedItemsText` | leave empty unless you add a typed *“items I packed”* Text |
| `cameraPreviewRoot` | SceneObject `CropCameraTextureTS` (the package prefab root) |
| `originalCameraTexture` | `Packages/CropCameraTexture.lspkg/Assets/Render/Device Camera Texture.deviceCameraTexture` |
| `cropCameraTexture` | `Packages/CropCameraTexture.lspkg/Assets/Render/Screen Crop Texture.screenCropTexture` |
| `cropHintRoot` | optional `CropHint_Root` SceneObject |
| `geminiModel` | `gemini-2.0-flash` (default) |

**Runtime flow:**
1. Open the **Pack** category row → `PackScanHUD_Placeholder` enabled, last result (if any) still shown in `CategoryDetail_Text`.
2. Pinch **Scan Pack** → camera preview, Capture, Crop Scan, Close become visible.
3. Pinch **Capture** (FullFrame) → snapshot of `originalCameraTexture` → RSG `VideoController` → base64 JPEG → Gemini Vision (`inlineData`) → result mirrored to `PackScanHUD_Text` and `CategoryDetail_Text`.
4. Or pinch **Crop Scan** → live preview hides, **Crop hint** shows. Pinch **Capture** again → snapshot of `cropCameraTexture` (the cropped region only, no surroundings) → Gemini Vision.
5. Pinch **Close** → preview + buttons hide, inline HUD text cleared, detail-panel mirror preserved.
6. Pinching **Scan Pack** at any time restarts FullFrame mode and overwrites the next result.

**Notes:**
- Camera permission is requested by the package on lens start. The viewfinder is only **displayed** after Scan Pack is pinched; nothing is sent to any server until Capture.
- Setup hints are emitted via `NativeLogger("PackScanController")`, not painted on the HUD text — open the Logger panel to see them while debugging.
- Editor fallback: if `VideoController` or the camera is unavailable (Lens Studio preview without permission), Capture automatically falls back to a text-only Gemini call so the feature still produces a result.

### Loading bar while generating plan
On `GeminiAssistant`, assign:
- `generationLoadingBar` → scene object (image/bar/spinner)

It is enabled during `requestTripPlan()` and hidden on success/failure.

### Category rows as interactable buttons
Each `CategoryWidgetHolder_*` should have:
- `Interactable` component
- `ColliderComponent`

`CategoryPlanDetailController.categoryRowRoots` must be wired in this order:
1. Transportation (`CategoryWidgetHolder_Routes`)
2. Accommodation (`CategoryWidgetHolder_Stay`)
3. Places
4. Restaurants
5. Weather
6. Pack

### Voice notes
- In Lens Studio editor preview, `ASR error: 1` is common and expected.
- Voice parsing now handles freeform phrases like:
  - `Berlin to Tokyo, May 22nd to May 28th`
  - `from Berlin to Tokyo`
  - date ranges in `dd/mm/yyyy to dd/mm/yyyy`

### Fallback behavior
`Plan Trip` uses latest captured draft. Missing fields only fallback when absent:
- missing departure city → user/fallback city
- missing destination city → current city if local mode enabled
- missing dates → localized date fallback

### UI v2 HUD tree (in scene now under `AI_UI_V2_Root`)

Approximate layout: **left column** category strips, **center** compass anchor, **right column** cards, **top** prompt copy, **bottom** voice row + button stems. Local positions are in **world units** consistent with the rest of `App_TravelRoot` (same scale as `TravelPlanner_UI`).

```
App_TravelRoot
└── AI_UI_V2_Root  (local position z ≈ +15)
    ├── Assistant_System          ← GeminiAssistant + AIAssistantUIBridge
    ├── Left_Column_Placeholder
    │   ├── CategoryWidgetHolder_Stay      (+ Text)   [starts disabled]
    │   ├── CategoryWidgetHolder_Routes    (+ Text)
    │   ├── CategoryWidgetHolder_Places    (+ Text)
    │   ├── CategoryWidgetHolder_Food      (+ Text)
    │   ├── CategoryWidgetHolder_Weather   (+ Text)
    │   └── CategoryWidgetHolder_Pack      (+ Text)
    ├── Center_NIC_Compass_Placeholder    ← drop compass / brand mesh here
    ├── Right_Column_Placeholder
    │   ├── WeatherCard_Placeholder → WeatherCard_Image_BG (+ Image), WeatherCard_Text_Body (+ Text)
    │   ├── TripInfoCard_Placeholder → TripThumb_Image_Placeholder (+ Image), TripSummary_Text_Placeholder (+ Text) ← wired to GeminiAssistant.summaryText
    │   └── PriceWatchCard_Placeholder → PriceWatch_Image_BG (+ Image), PriceWatch_Text_Body (+ Text)
    ├── Top_AssistantPrompt_Placeholder
    │   ├── PromptTitle_Text_Placeholder (+ Text)
    │   ├── PromptSubtitle_Text_Placeholder (+ Text)
    │   └── AssistantStatus_Text_Placeholder (+ Text) ← wired to GeminiAssistant.statusText
    └── Bottom_HUD_Placeholder
        ├── VoiceBar_Placeholder
        │   ├── VoiceHint_Text_Placeholder (+ Text) ← AIAssistantUIBridge.hintText + keyboard prompts + ASR hintEcho
        │   └── VoiceListening_Status_Text_Placeholder (+ Text) ← ASRQueryController.statusText (listening / errors)
        ├── SecondaryActions_Row_Placeholder  ← optional Compare / Radar / Smart Pack / Map chips
        ├── Voice_Input_Controller           ← ASRQueryController (listen invoked from Voice Mode pinch via bridge)
        ├── Btn_PlanTrip_Placeholder          ← PinchButton → AIAssistantUIBridge.planTripButton
        └── (Voice Mode + Mic mute live under TravelPlanner_UI row — see below)
```

**Already wired in scene YAML:** `GeminiAssistant` category roots/titles, `DestinationVisualizer` link, `NewInCityAssistant.geminiAssistant` → `GeminiAssistant`, Voice Mode pinch → bridge + ASR toggle, optional mic mute pinch, ASR status + hint echo texts.

**Optional polish:** reparent mic mute PinchButton from template examples under `TravelPlanner_UI` so it sits next to Voice Mode visually; swap placeholder **`Image`** materials/textures for real card chrome.

---

## Remote Service Gateway (RSG) — common errors

These APIs are **not** generic HTTP: they go through **Snap-authorized** **Remote Service Module** assets and often need a **`RemoteServiceGatewayCredentials`** component in the scene with valid tokens (**Lens Studio → Window → Remote Service Gateway Token**). Many calls **only work on physical Spectacles**, not the desktop preview.

### 1. Wrong Remote Service Module on the script

- **`DestinationVisualizer`** must use an RSM whose API spec defines your **image** endpoint (e.g. `generate_image`, `imagen_generate`, or whatever you named it in the gateway).
- The **Weather – AccuWeather** package’s RSM (`Accuweather.remoteServiceModule`) is for **weather only**. Assigning it to **`DestinationVisualizer`** and calling an image endpoint will fail (wrong base URL / unknown endpoint / statusCode ≠ 1).

**Fix:** In **Asset Browser**, under **Remote Service Gateway**, duplicate or create an RSM asset wired to **Google / Imagen** (or your proxy), add the `generate_image` (or matching) operation, then assign **that** asset to **`DestinationVisualizer` → Remote Service Module**.

### 2. `imageGenEndpoint` does not match the RSM spec

The inspector field **`imageGenEndpoint`** must equal the **endpoint name** in the Remote Service Module asset (default in script: `generate_image`). If your gateway uses `imagen_generate`, set the field to that exact string.

### 3. Missing or invalid token

Errors mentioning auth, 401/403 mapped status codes, or “access denied” → generate a **Google** (or required) token in Lens Studio and assign **`RemoteServiceGatewayCredentials`** on a scene object (see Spatial Image / RSG samples).

### 4. Spatial Image sample vs layered quads

- **`Spatial Image`** prefab in the scene includes its own **`remoteServiceModule`** / **`internetModule`** / **`remoteMediaModule`** inputs — those are for **that** script, not automatically for **`DestinationVisualizer`**.
- To drive Snap’s spatializer from **`DestinationVisualizer`**, enable **`useSpatialImageFrame`**, assign the **`SpatialImageFrame`** (or equivalent) **ScriptComponent** to **`spatialImageFrame`**, and keep **`swapSpatialWhenReady`** as needed.

### 5. Auto image request on destination pinch

In the bundled scene, **`TravelPlannerController` → Enable Destination Image On Select** is set to **`false`** so pinches do not call the network until an **Imagen-capable RSM** is assigned. Turn it **`true`** after wiring **`DestinationVisualizer` → Remote Service Module**.

---

## Asset Browser checklist

Confirm these exist (packages are under **`Packages/`**):

| Asset / package | Purpose |
|-----------------|--------|
| **`SpectaclesInteractionKit.lspkg`** | SIK, Interactable, Pinch Button. |
| **`Remote Service Gateway.lspkg`** | Gemini, Imagen, helpers; create **RSM** + tokens. |
| **`Spatial Image.lsc`** / Spatial Image sample | Optional spatialized frame; see **`Spatial Image`** script on prefab in scene. |
| **`Internet Module.internetModule`** | WebView texture provider (anti-tracking flows). |
| **`Weather - AccuWeather API.lspkg`** | Weather only — **do not** use as `DestinationVisualizer` image RSM. |

**Scripts (TypeScript):** `TravelPlannerController`, `DestinationVisualizer`, `GeminiAssistant`, `AIAssistantUIBridge`, `ASRQueryController`, `WeatherAccuBridge`, `TripState`, `NewInCityAssistant`, `DestinationScenePrompts`, `TripTypes`, `ToolDefinitionsStub` — all under **`Assets/Scripts/TravelPlanner/`**.

---

## Part A — `TravelPlannerController`

Already on **`TravelPlanner_UI`**. Wires:

- **Summary Text** → `SummaryText_Placeholder`’s `Text`
- **Occasion buttons** → `Btn_Occasion_*_Placeholder` roots (interactables resolved on children); labels default **Leisure / Vacation / Business**
- **`geminiAssistant`** → `GeminiAssistant` on **`Assistant_System`** (keeps trip `purpose` in sync with pinches)
- **Activity B** → fixed scene ref was wrong before; now points to **`Btn_Activity_B_Placeholder`** (not the clear button)
- **Destination visualizer** → optional; **`enableDestinationImageOnSelect`** is **`false`** until you want Imagen on every voice destination update

**Cities & dates** come from **`GeminiAssistant`** (voice / `ExampleGeminiLive` transcript → `handleSpeechTranscript`), not from fixed city buttons.

---

## Part B — `DestinationVisualizer`

On **`DestinationViewSystem`**. Layered **Image** planes are assigned. **`Remote Service Module`** is **unset** in the default scene until you add an Imagen RSM asset.

---

## Part C — Voice assistant orchestration (`GeminiAssistant`)

Attach **`GeminiAssistant`** to a dedicated object (for example `AssistantSystem`) and wire:

- **`remoteServiceModule`** → Gemini-capable RSM (not weather)
- **`geminiEndpoint`** → endpoint name in that RSM (default: `gemini_plan_trip`)
- **`destinationVisualizer`** → optional link to `DestinationViewSystem` component
- **`summaryText`** / **`statusText`** → UI Text placeholders
- **`categoryWidgetRoots[0..5]`** → Transportation / Accommodation / Places / Restaurants / Weather / Pack cards (disabled by default)
- **`categoryTitleTexts[0..5]`** → optional labels for card headers
- **`defaultDestinationToCurrentCity`** → keep `true` to support "already at destination" local mode
- **`preferUserIdInWelcome`** → enable if you want user id instead of display name in greeting

Runtime flow:

1. `GeminiAssistant` auto-tries `global.userContextSystem.requestDisplayName()` and `requestCity()` on start.
2. Call `beginAssistantSession(userName, detectedCity)` after location/user info is available (or pass empty values and let User Context/fallback fill).
3. If user does not provide departure city, assistant defaults to current detected city.
4. If user says "already here"/"near me", destination defaults to current city so the first widget cycle can focus on local places/food/weather.
5. Feed STT results into `handleSpeechTranscript(transcript)`.
6. Once required fields exist (or local mode is active), call `requestTripPlan()`.
7. The assistant enables the category widgets and emits `onTripPlanReady` with parsed card data.

`NewInCityAssistant` can remain as a thin wrapper (`beginVoiceAssistant`, `handleVoiceTranscript`, `planTripFromCapturedDetails`) if you already call that component elsewhere.

---

## Part D — UI v2 holders and voice bridge (scene objects)

The HUD placeholders live under **`AI_UI_V2_Root`** (child of **`App_TravelRoot`**). Exact names match **Hierarchy** above (`Top_AssistantPrompt_Placeholder`, `TripInfoCard_Placeholder`, `Voice_Input_Controller`, etc.).

Scripts are on **`Assistant_System`** (child of `AI_UI_V2_Root`):

- **`GeminiAssistant`** — trip draft, widgets, RSM call (assign **`remoteServiceModule`** in Inspector).
- **`AIAssistantUIBridge`** — links assistant + ASR + hint text (`VoiceHint_Text_Placeholder`).

**`ASRQueryController`** is on **`Voice_Input_Controller`** (under **`Bottom_HUD_Placeholder`**):

- `statusText` → **`VoiceListening_Status_Text_Placeholder`**
- `button` → still **unassigned**; add a **PinchButton** under **`Btn_MicToggle_Placeholder`** and assign here.

**`AIAssistantUIBridge`** pinch inputs are **unassigned** until you add PinchButtons:

- `startAssistantButton` ← **`Btn_StartAssistant_Placeholder`**
- `planTripButton` ← **`Btn_PlanTrip_Placeholder`**

`AIAssistantUIBridge` routes ASR transcripts into `GeminiAssistant.handleSpeechTranscript(...)` and triggers `requestTripPlan()` for intents like "plan my trip" / "show options".

---

## User identity and welcome behavior

Use both identity sources when available:

- Lens User Context (`global.userContextSystem`) for display name and city.
- Spectacles user information framework for stable user id when needed.

Current `GeminiAssistant` behavior:

- **Lens Studio editor:** does **not** call `userContextSystem.requestDisplayName` / `requestCity` (those native APIs throw `InternalError: Value is not a native object` in preview). It uses **`fallbackDepartureCity`** (default Berlin) and **Traveler** until you run on **device** paired with Snapchat.
- **Device:** requests display name + city when available; Sync Kit user id when available.
- Welcome line uses display name by default, or user id if `preferUserIdInWelcome` is true.
- If user omits departure, assistant defaults to detected or fallback city.
- If user says "already here" / "near me" / similar → **local mode**: `skipLongDistanceTransport` is set; **`requestTripPlan`** omits the **transportation** category from the Gemini payload (places / food / weather / pack still run). Saying **yes** to “travelling from {city}?” clears that flag for a normal trip.

### AccuWeather vs Gemini for weather

- **AccuWeather** (via **`Accuweather.remoteServiceModule`** and endpoints like `current_condition_and_forecast`) is the right source for **real** forecasts in production.
- **Gemini** text is **not** a certified weather observation layer — use it for copy/suggestions only after you have real data, or for demos without the AccuWeather package.

**`WeatherAccuBridge`** is on **`WeatherCard_Placeholder`**: assigns the AccuWeather RSM + **`WeatherCard_Text_Body`**, default **Berlin** lat/lng in editor. Replace lat/lng when you wire **Location AR** / device GPS.

### `ExampleGeminiLive` (RemoteServiceGatewayExamples)

After importing the examples package, select **`ExampleGeminiLive`** and replace **Instructions** with a travel-assistant system prompt. Pipe **output transcription** into `GeminiAssistant.handleSpeechTranscript(...)` (small bridge script or extend the example) so the same trip draft drives the six category widgets.

Reference docs:

- Lens User Context: https://developers.snap.com/lens-studio/features/user-context/overview
- Spectacles user information: https://developers.snap.com/spectacles/spectacles-frameworks/spectacles-sync-kit/features/user-information

---

## Verify

1. Open scene: no missing script references on **`TravelPlanner_UI`** / **`DestinationViewSystem`** / assistant object.
2. Preview: summary updates on destination pinch; image request only if RSM is assigned and **Enable Destination Image On Select** is on.
3. Voice flow: run `beginAssistantSession(...)` or `beginAssistantSessionFromContext()`, speak details, confirm category widgets enable after `requestTripPlan()`.
4. Verify mic toggle (`ASRQueryController`) sends final transcript to assistant bridge.
5. On device: test RSG image + Spatial path + Gemini endpoint per Snap docs.
