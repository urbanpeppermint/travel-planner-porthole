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
- **Start button** → `AIAssistantUIBridge.startAssistantButton` (starts voice assistant session)
- **Plan Trip button** → `AIAssistantUIBridge.planTripButton`
- **Mic button** → `ASRQueryController.button`
- **Keyboard toggle button (optional extra button)** → `AIAssistantUIBridge.keyboardToggleButton`
- **Keyboard confirm button (optional extra button)** → `AIAssistantUIBridge.keyboardConfirmButton`

### Keyboard entry mode (optional)
Assign these inspector fields on `AIAssistantUIBridge`:
- `keyboardEntryText`: text object that receives typed value
- `keyboardPromptText`: prompt line for step instructions
- `keyboardModeRoot`: panel root shown only while keyboard mode is on

Step sequence:
1. departure city
2. destination city
3. departure date (`dd/mm/yyyy`)
4. arrival date (`dd/mm/yyyy`)

Each step requires pinch confirm.

### Pack Scan HUD (wired)
- `CategoryPlanDetailController.packScanHud` -> `PackScanHUD_Placeholder`
- `PackScanController.scanButton` -> `Btn_ConfirmInput_Placeholder` PinchButton
- `PackScanController.packHudText` -> `PackScanHUD_Text`
- `PackScanController.detailBodyText` -> `CategoryDetail_Text`
- `PackScanController.observedItemsText` -> keyboard entry text object

Flow:
1. Open **Pack** category row (enables `PackScanHUD_Placeholder`).
2. Enter packed items in the keyboard entry text.
3. Pinch **Confirm Input** to run scan and generate packing feedback.

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
        │   ├── VoiceHint_Text_Placeholder (+ Text) ← wired to AIAssistantUIBridge.hintText
        │   └── VoiceListening_Status_Text_Placeholder (+ Text) ← wired to ASRQueryController.statusText
        ├── SecondaryActions_Row_Placeholder  ← optional Compare / Radar / Smart Pack / Map chips
        ├── Voice_Input_Controller           ← ASRQueryController (mic PinchButton still unassigned)
        ├── Btn_StartAssistant_Placeholder    ← add PinchButton prefab; assign to AIAssistantUIBridge.startAssistantButton
        ├── Btn_PlanTrip_Placeholder          ← add PinchButton prefab; assign to AIAssistantUIBridge.planTripButton
        └── Btn_MicToggle_Placeholder         ← add PinchButton prefab; assign to ASRQueryController.button
```

**Already wired in scene YAML:** `GeminiAssistant` category roots/titles, `DestinationVisualizer` link, `NewInCityAssistant.geminiAssistant` → `GeminiAssistant`, bridge hint + ASR status texts.

**You still add:** PinchButton prefabs under the three `Btn_*_Placeholder` objects and assign them on **`AIAssistantUIBridge`** / **`ASRQueryController`**. Optional: swap placeholder **`Image`** materials/textures for real card chrome.

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
