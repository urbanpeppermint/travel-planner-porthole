# PORTHOLE — Complete Build Spec & SDK Reference
### Lens Studio / Spectacles 2024 Developer Edition
### Version: May 2026 · Lens Studio 5.15.x (final Spectacles 2024 series)

> **Using this repo:** Treat this file as a **technical reference** (RSG, Camera, WebView, Spatial Image APIs). This codebase uses **neutral scene names** (`App_TravelRoot`, `DestinationViewSystem`) and does not depend on any product codename.

---

## TABLE OF CONTENTS

1. [Project Vision & Naming](#1-project-vision--naming)
2. [SDK & API Capability Audit](#2-sdk--api-capability-audit)
3. [RSG Services Deep Dive](#3-remote-service-gateway-rsg---complete-service-map)
4. [Spatial Image Pipeline](#4-spatial-image-pipeline)
5. [Complete File Architecture](#5-complete-file-architecture)
6. [Phase-by-Phase Cursor Instructions](#6-phase-by-phase-cursor-instructions)
7. [Import Reference Cheatsheet](#7-import-reference-cheatsheet)
8. [Constraints & Gotchas](#8-constraints--gotchas)
9. [Resource Links](#9-resource-links)

---

## 1. PROJECT VISION & NAMING

**Name: PORTHOLE**
A porthole is a window you look through to see somewhere else — which is exactly what this app does.
Confirm a destination → a spatial "window" opens in AR showing you a Gemini/Imagen-generated scene of that place.
Anti-tracking price search, real weather, packing AI, and multi-source comparison live underneath the magic.

**Core loop:**
1. User speaks destination + dates → Gemini Live parses → `saveTripDetails()`
2. RSG Imagen generates a destination scene → Spatial Image API spatializes it into AR "porthole window"
3. Six category cards appear (Stay / Routes / Places / Food / Weather / Pack)
4. Each category tap opens: anti-tracking WebView search, AccuWeather data, or camera packing analysis
5. Inflation detector monitors search frequency; rotates UA automatically

---

## 2. SDK & API CAPABILITY AUDIT

### 2.1 Minimum Requirements
| Requirement | Version |
|---|---|
| Lens Studio | 5.15.x (last for Spectacles 2024 — use this for all builds) |
| Spectacles OS | 5.062 or later |
| TypeScript | 5.x (Lens Studio built-in compiler) |

---

### 2.2 SPECTACLES INTERACTION KIT (SIK)
**Package:** `SpectaclesInteractionKit.lspkg`
**Install:** Asset Library → Spectacles → Spectacles Interaction Kit
**Prefab:** `Assets/SpectaclesInteractionKit/Prefabs/SpectaclesInteractionKit.prefab` → drag into scene root

| Feature | Import Path | What It Gives You |
|---|---|---|
| SIK root | `SpectaclesInteractionKit.lspkg/SIK` | `SIK.HandInputData`, `SIK.InteractionManager` |
| Hand tracking data | `SIK.HandInputData` | `getHand('left'/'right')` → `TrackedHand` |
| TrackedHand events | `.onPinchDown`, `.onPinchUp` | Pinch gesture callbacks |
| TrackedHand keypoints | `.indexTip`, `.thumbTip`, `.wrist` → `.position` (vec3) | World-space joint positions |
| Interactors | `SIK.InteractionManager.getInteractorsByType(InteractorInputType.LeftHand)` | Ray-cast interactors |
| Interactable | Component.Interactable on SceneObject | Makes objects tappable/pinchable |
| UI Kit | `SpectaclesInteractionKit.lspkg/Components/UI/*` | Buttons, sliders, toggles |
| Event system | `SpectaclesInteractionKit.lspkg/Utils/Event` | `new Event<T>()`, `.add()`, `.invoke()` |

**Usage for category card tap:**
```typescript
import { SIK } from 'SpectaclesInteractionKit.lspkg/SIK';
// In onAwake:
const handInputData = SIK.HandInputData;
const rightHand = handInputData.getHand('right');
rightHand.onPinchDown.add(() => {
  // check which card interactable is focused
});
```

---

### 2.3 REMOTE SERVICE GATEWAY (RSG)
**Package:** `RemoteServiceGateway.lspkg`
**Install:** Asset Library → Spectacles → Remote Service Gateway
**Credentials component:** `RemoteServiceGatewayCredentials` — attach to a SceneObject, paste tokens

**Token generation:** Lens Studio → Windows → Remote Service Gateway Token
- **Snap Token** — for Snap-hosted services
- **Google Token** — for Gemini, Imagen, Lyria
- **OpenAI Token** — for GPT, DALL-E, Realtime, TTS

> All RSG APIs only work on physical Spectacles hardware. Cannot be tested in simulator.

Full service list — see Section 3.

---

### 2.4 REMOTE SERVICE MODULE (RSM)
**Require:** `const rsm = require('LensStudio:RemoteServiceModule')`
**Use case:** Custom third-party APIs (AccuWeather, your own backend)

```typescript
const request = RemoteApiRequest.create();
request.endpoint = "your_endpoint_name";   // must match Asset Library spec name
request.body = JSON.stringify({ key: value });
remoteServiceModule.performApiRequest(request, (response: RemoteApiResponse) => {
  if (response.statusCode === 1) {
    const data = JSON.parse(response.body);
  }
});
```

**Limits:**
- Max 3 concurrent API calls (keep to 1 where possible)
- Response body max ~800 KB
- No `async/await` — callback only
- Do NOT fetch images dynamically via RSM — use Remote Assets for images known at build time

---

### 2.5 CAMERA MODULE
**Require:** `const cameraModule = require('LensStudio:CameraModule')`

| Method | Use |
|---|---|
| `CameraModule.createCameraRequest()` | Create request object |
| `request.id = CameraModule.CameraId.Left_Color` | Select left RGB camera |
| `cameraModule.requestCamera(request)` → `Texture` | Continuous live feed texture |
| `cameraModule.requestImage(request, callback)` | Single still at 3200×2400 for AI vision |

**For packing analysis (AI Vision via RSG):**
```typescript
const cameraModule = require('LensStudio:CameraModule');
const req = CameraModule.createCameraRequest();
req.id = CameraModule.CameraId.Left_Color;
const liveTex = cameraModule.requestCamera(req);
// liveTex → attach to Image component for passthrough, or encode for RSG AI Vision
```

---

### 2.6 INTERNET MODULE (WebView)
**Require:** `const internetModule = require('LensStudio:InternetModule')`

```typescript
const provider = internetModule.createWebPageTextureProvider({
  url: "https://www.booking.com/...",
  size: new vec2(1024, 768)
});
imageComponent.mainPass.baseTex = provider.getTexture();
// Destroy by nulling: provider = null
// User agent rotation:
if (provider.setUserAgent) provider.setUserAgent(uaString);
```

**Anti-tracking pattern:** null the provider → DelayedCallbackEvent(0.1s) → create fresh provider → new session, no cookies.

---

### 2.7 DEVICE LOCATION
**Component:** `DeviceLocationTrackingComponent` (add via Inspector)
**Import:** none (built-in component)

```typescript
// @input deviceLocation: DeviceLocationTrackingComponent
deviceLocation.onLocationUpdated.add((loc) => {
  const lat = loc.latitude;
  const lng = loc.longitude;
});
// Synchronous access:
const loc = deviceLocation.location; // LocationCoordinate
```

**Permission:** requires user to accept location permission prompt on Spectacles.

---

### 2.8 VOICE ML / MICROPHONE
**RSG helper:** `RemoteServiceGateway.lspkg/Helpers/MicrophoneRecorder`

```typescript
import { MicrophoneRecorder } from 'RemoteServiceGateway.lspkg/Helpers/MicrophoneRecorder';
// @input microphoneRecorder: MicrophoneRecorder
microphoneRecorder.setSampleRate(16000);           // 16kHz for Gemini
microphoneRecorder.startRecording();
microphoneRecorder.onAudioFrame.add((frame) => {   // PCM frame callback
  audioProcessor.processFrame(frame);
});
microphoneRecorder.stopRecording();
```

**For Gemini Live ASR:** frames stream through `AudioProcessor` → base64 PCM chunks → WebSocket to Gemini.

---

### 2.9 AUDIO OUTPUT
**RSG helper:** `RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput`

```typescript
import { DynamicAudioOutput } from 'RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput';
// @input dynamicAudioOutput: DynamicAudioOutput
dynamicAudioOutput.initialize(24000);              // 24kHz for Gemini TTS output
dynamicAudioOutput.addAudioFrame(pcmBytes);        // feed decoded PCM from Gemini
dynamicAudioOutput.interruptAudioOutput();         // stop current speech
```

---

### 2.10 VIDEO / FRAME ENCODING
**RSG helper:** `RemoteServiceGateway.lspkg/Helpers/VideoController`

```typescript
import { VideoController } from 'RemoteServiceGateway.lspkg/Helpers/VideoController';
const videoController = new VideoController(
  1500,                        // capture interval ms
  CompressionQuality.HighQuality,
  EncodingType.Jpg
);
videoController.startRecording();
videoController.onEncodedFrame.add((base64: string) => {
  // send to Gemini as image/jpeg for AI vision (packing analysis)
});
videoController.stopRecording();
```

---

### 2.11 AUDIO PROCESSOR
**RSG helper:** `RemoteServiceGateway.lspkg/Helpers/AudioProcessor`

```typescript
import { AudioProcessor } from 'RemoteServiceGateway.lspkg/Helpers/AudioProcessor';
const audioProcessor = new AudioProcessor();
audioProcessor.onAudioChunkReady.add((chunk: string) => {
  // chunk = base64 PCM, send to Gemini WebSocket
});
// Feed mic frames:
microphoneRecorder.onAudioFrame.add((frame) => audioProcessor.processFrame(frame));
```

---

### 2.12 SNAPML (On-Device ML)
**Component:** ML Component (Inspector → Add Component → ML)
**Asset type:** `.snapml` model file
**Use for:** Custom object detection, luggage item classification (offline, no network needed)

```typescript
// Via component reference:
// @input mlComponent: MLComponent
mlComponent.onRunningFinished.add(() => {
  const outputTensor = mlComponent.getOutput("output_name");
  const results = outputTensor.data; // Float32Array
});
mlComponent.runImmediate(inputTexture);
```

**For packing:** Could supplement RSG AI Vision with an on-device clothing/luggage classifier to reduce API calls.

---

### 2.13 SPATIAL AUDIO
**Component:** `AudioComponent` with `AudioEffectComponent`
**Import:** none (built-in)
- Add spatial audio to destination preview: ambient soundscape (café, street market, ocean) matched to destination type.
- Position `AudioComponent` at the same world position as the Porthole planes.

---

### 2.14 SNAP CLOUD (NEW in 5.15)
**Backend:** Integrated Supabase — database, storage, edge functions, realtime
**Use for:** Persisting price history across sessions, shared price alerts between users

```typescript
// Available through Lens Studio editor integration — no external SDK needed
// Setup via Lens Studio → Project → Snap Cloud
```

---

### 2.15 CONNECTED LENSES / COLOCATED
**Use for:** Optional — share Porthole destination view with a travel companion in the same physical space. Both users see the same AR "porthole" to Paris.

---

### 2.16 BATTERY LEVEL API (NEW in 5.15)
**Use for:** Reduce search frequency / disable ambient price drift detection when battery < 20%

```typescript
const batteryModule = require('LensStudio:BatteryModule');
const level = batteryModule.getBatteryLevel(); // 0.0 to 1.0
```

---

### 2.17 UI KIT (NEW in 5.15)
**Package:** Snap OS 2.0 design system components
**Install:** Asset Library → Spectacles → UI Kit
**Use for:** Category cards, status bar, packing result cards — native OS-consistent styling

---

## 3. REMOTE SERVICE GATEWAY (RSG) — COMPLETE SERVICE MAP

### 3.1 GEMINI (Google Token Required)

#### Gemini Live (WebSocket) — PRIMARY AI ENGINE
```typescript
import { Gemini, GeminiLiveWebsocket } from 'RemoteServiceGateway.lspkg/HostedExternal/Gemini';
import { GeminiTypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GeminiTypes';

const GeminiLive: GeminiLiveWebsocket = Gemini.liveConnect();
GeminiLive.onOpen.add(() => { /* send setup config */ });
GeminiLive.onMessage.add((msg) => { /* route messages */ });
GeminiLive.onError.add(() => { /* handle error */ });
GeminiLive.onClose.add(() => { /* handle disconnect */ });

// Setup config shape:
const config = {
  setup: {
    model: "models/gemini-2.0-flash-live-preview-04-09",
    generation_config: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }
    },
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    tools: [{ function_declarations: [...] }],
    output_audio_transcription: {}
  }
} as GeminiTypes.Live.Setup;

GeminiLive.send(config);

// Send audio:
GeminiLive.send({
  realtime_input: {
    media_chunks: [{ mime_type: "audio/pcm", data: base64PCM }]
  }
} as GeminiTypes.Live.RealtimeInput);

// Send video frame (for packing analysis):
GeminiLive.send({
  realtime_input: {
    media_chunks: [{ mime_type: "image/jpeg", data: base64Jpg }]
  }
} as GeminiTypes.Live.RealtimeInput);

// Send function response:
GeminiLive.send({
  tool_response: {
    function_responses: [{ name: "funcName", response: { content: JSON.stringify(result) } }]
  }
} as GeminiTypes.Live.ToolResponse);
```

#### Message routing (all cases):
```typescript
function handleMessage(msg: any): void {
  if (msg.setupComplete) { /* session ready */ }

  // Audio output from Gemini TTS
  if (msg?.serverContent?.modelTurn?.parts?.[0]?.inlineData?.mimeType?.startsWith("audio/pcm")) {
    const audio = Base64.decode(msg.serverContent.modelTurn.parts[0].inlineData.data);
    dynamicAudioOutput.addAudioFrame(audio);
  }

  // Transcription text
  const text = msg?.serverContent?.outputTranscription?.text
            || msg?.serverContent?.modelTurn?.parts?.[0]?.text;
  if (text) { /* update UI */ }

  // Function calls
  if (msg.toolCall) {
    msg.toolCall.functionCalls.forEach((fc: any) => handleFunction(fc.name, fc.args));
  }
}
```

---

### 3.2 GOOGLE IMAGEN (Google Token Required) — DESTINATION IMAGE GENERATION

```typescript
import { Imagen } from 'RemoteServiceGateway.lspkg/HostedExternal/Imagen';
// OR via RSG performApiRequest with endpoint "generate_image"

// Method A — Direct RSG endpoint:
const request = RemoteApiRequest.create();
request.endpoint = "imagen_generate";
request.body = JSON.stringify({
  prompt: "Photorealistic travel scene of Paris, golden hour, Eiffel Tower, no people",
  width: 1024,
  height: 512,
  model: "imagen-3.0-generate-002"   // latest Imagen 3
});
remoteServiceModule.performApiRequest(request, (response) => {
  const data = JSON.parse(response.body);
  const base64Image = data.image;    // base64 JPEG/PNG
  spatialImageFrame.setImage(textureFromBase64(base64Image), true); // true = auto-spatialize
});
```

**Prompt engineering for destination scenes:**
```typescript
const SCENE_PROMPTS: Record<string, string> = {
  overview:   "Wide establishing shot of {city}, travel photography, golden hour, no people, architectural detail",
  stay:       "Luxury hotel room interior in {city}, warm ambient light, cozy atmosphere, travel aesthetic",
  food:       "Colorful local food market in {city}, street food stalls, vibrant produce, photorealistic",
  places:     "Famous landmark in {city}, dramatic sky, wide angle, no crowds, travel photography",
  adventure:  "Epic outdoor landscape near {city}, mountains or coast, dramatic lighting",
  weather:    "Aerial cityscape of {city} on a {weather} day, photorealistic drone shot"
};
```

---

### 3.3 SPATIAL IMAGE API — THE PORTHOLE EFFECT

**Package:** Available via RSG + SpatialImage components in Asset Library
**Docs:** `developers.snap.com/spectacles/about-spectacles-features/apis/spatial-image`

This is the core magic. Snap's server-side spatializer converts a flat 2D image into a depth-aware spatial image that displays with 3D parallax on Spectacles automatically.

```typescript
// Required components on a SceneObject:
// - SikSpatialImageFrame (extends container frame)
// - SpatialImageSwapper (manages flat → spatial swap)
// - RemoteServiceGatewayCredentials (Google token for spatialization service)

// Script:
import { SikSpatialImageFrame } from 'path/to/SikSpatialImageFrame';
// @input spatialImageFrame: SikSpatialImageFrame

// Call with swapWhenSpatialized = true:
// 1. Immediately shows flat image
// 2. Sends to Snap spatialization service
// 3. When depth map returns, automatically swaps to spatial version
spatialImageFrame.setImage(flatTexture, true);

// Full setImage signature:
public setImage(image: Texture, swapWhenSpatialized: boolean = false): void
// - Updates container size to match image aspect ratio
// - If swapWhenSpatialized=true: registers onLoaded callback → calls setSpatialized(true)
// - Passes flat image to spatialImageSwapper immediately (user sees it right away)
// - Sends to spatializer service in background

// Depth scale (how 3D it looks):
spatialImageDepthAnimator.setBaseDepthScale(1.5); // 1.0 default, higher = more depth
```

**Full Porthole pipeline:**
```
User confirms destination
    ↓
Gemini buildImagePrompt(destination, occasion, weather)
    ↓
RSG Imagen.generate(prompt) → base64 JPEG
    ↓
textureFromBase64(base64) → Texture
    ↓
sikSpatialImageFrame.setImage(texture, true)
    ↓ (immediate)            ↓ (async ~2-4s)
Show flat image          Snap spatializer returns depth map
    ↓                         ↓
User sees destination    Swap to spatial version (auto-parallax)
scene immediately        Full 3D effect kicks in
```

**SpatialGallery (multiple destination shots):**
```typescript
// Organize images as Texture[] array
const gallery: Texture[] = [overviewTex, stayTex, foodTex, placesTex];
let index = 0;

function setIndex(newIndex: number) {
  index = newIndex;
  spatialImageFrame.setImage(gallery[index], true);  // auto-spatialize each
}

// On category card tap, call setIndex() with matching scene
```

---

### 3.4 OPENAI REALTIME (OpenAI Token) — ALTERNATIVE VOICE OPTION
```typescript
import { OpenAIRealtime } from 'RemoteServiceGateway.lspkg/HostedExternal/OpenAI';
// WebSocket-based, similar to Gemini Live pattern
// Use if Gemini Live has latency issues — GPT-4o Realtime is also excellent
```

---

### 3.5 OPENAI VISION / CHAT COMPLETIONS — PACKING ANALYSIS ALTERNATIVE
```typescript
import { OpenAI } from 'RemoteServiceGateway.lspkg/HostedExternal/OpenAI';

// Send camera frame + packing prompt to GPT-4o Vision:
const request = RemoteApiRequest.create();
request.endpoint = "openai_chat";
request.body = JSON.stringify({
  model: "gpt-4o",
  messages: [{
    role: "user",
    content: [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frameBase64}` } },
      { type: "text", text: `Analyze these packed items for a ${tripType} trip to ${destination} (${weatherCtx}). For each visible item, categorize as: ✅ Good to Go, ⚠️ Passes, or ❌ Needs Work. Return JSON array.` }
    ]
  }],
  max_tokens: 500
});
```

---

### 3.6 OPENAI TEXT-TO-SPEECH (OpenAI Token)
```typescript
request.endpoint = "openai_tts";
request.body = JSON.stringify({
  model: "tts-1",
  input: "Your flight to Paris costs €320 with Skyscanner today",
  voice: "nova"  // alloy, echo, fable, onyx, nova, shimmer
});
// Returns audio bytes → DynamicAudioOutput
```

---

### 3.7 DEEPSEEK R1 REASONING (Snap Token)
```typescript
// Chat completions with transparent step-by-step reasoning
// Use for: complex trip planning logic, multi-leg routing analysis
request.endpoint = "deepseek_chat";
```

---

### 3.8 GOOGLE LYRIA (Google Token) — AMBIENT AUDIO
```typescript
// Generate destination-matched ambient music/soundscape
// Paris → accordion ambience; Tokyo → subtle electronic; Bali → gamelan
import { Lyria } from 'RemoteServiceGateway.lspkg/HostedExternal/Lyria';
// Send music prompt, receive streaming audio → DynamicAudioOutput
```

---

## 4. SPATIAL IMAGE PIPELINE

### Scene Hierarchy for Porthole Effect

```
PortholeSystem (SceneObject)
├── RemoteServiceGatewayCredentials  ← Google Token required
├── SikSpatialImageFrame             ← Main spatial image container
│   ├── SpatialImageSwapper          ← Manages flat↔spatial swap
│   └── Spatializer                  ← Sends to Snap depth service
├── SpatialImageDepthAnimator        ← Controls depth intensity
├── SpatialImageAngleValidator       ← Monitors optimal viewing angle
└── VignettePlane                    ← Porthole frame overlay (circular mask shader)
```

### Category-Reactive Scene Generation

When a category card is tapped, regenerate the spatial image with a matching prompt variant and crossfade:

```typescript
function onCategoryTapped(category: string): void {
  const promptTemplate = SCENE_PROMPTS[category] || SCENE_PROMPTS.overview;
  const prompt = promptTemplate.replace('{city}', tripData.destination)
                               .replace('{weather}', currentWeather?.condition || 'clear');

  generateAndDisplay(prompt, () => {
    sendVoicePrompt(CATEGORY_VOICE_PROMPTS[category]);
  });
}

function generateAndDisplay(prompt: string, onReady?: () => void): void {
  // Show loading state immediately
  uiController.updateStatus("Opening porthole...");

  const request = RemoteApiRequest.create();
  request.endpoint = "imagen_generate";
  request.body = JSON.stringify({ prompt, width: 1024, height: 512 });

  remoteServiceModule.performApiRequest(request, (response) => {
    const data = JSON.parse(response.body);
    const texture = textureFromBase64(data.image);
    spatialImageFrame.setImage(texture, true);  // spatialize immediately
    uiController.updateStatus("Ready");
    onReady?.();
  });
}
```

### Porthole Frame Shader (VignettePlane material)

Create a Graph Material in Lens Studio:
- `UV → distance from center → smoothstep(0.4, 0.5, dist) → alpha`
- Result: opaque border, transparent center = porthole window
- Add subtle specular to give it a "glass" quality

---

## 5. COMPLETE FILE ARCHITECTURE

```
Assets/
  Scripts/
    Core/
      NewInCityAssistant.ts       ← Root @component, wires everything
      TripState.ts                ← Typed interfaces: TripData, PriceRecord, etc.
      ToolDefinitions.ts          ← All 7 Gemini function_declarations
    
    AI/
      GeminiSessionManager.ts     ← GeminiLive session, message routing
      PackingAnalyzer.ts          ← Camera frames → Gemini Vision → ✅⚠️❌
    
    Search/
      AntiTrackingEngine.ts       ← WebView lifecycle, UA rotation
      PriceAggregator.ts          ← URL builders, 5 hotel + 4 flight sources
      InflationDetector.ts        ← Search history, warn at ≥3 searches
    
    Visualization/
      DestinationVisualizer.ts    ← RSG Imagen → Spatial Image pipeline
      PortholeController.ts       ← SikSpatialImageFrame wrapper
      CategorySceneManager.ts     ← Swaps spatial scene per category tap
    
    Services/
      WeatherService.ts           ← AccuWeather via RSM
      LocationService.ts          ← DeviceLocationTracking wrapper
    
    UI/
      UIController.ts             ← All Text, category cards, status
      PackingResultsView.ts       ← ✅⚠️❌ results display
  
  Prefabs/
    CategoryCard.lso              ← SIK Interactable + Text child
    PackingResultCard.lso         ← Three-section ✅⚠️❌ layout
    WebViewFrame.lso              ← Image component for WebView texture
    PortholeFrame.lso             ← SikSpatialImageFrame + VignettePlane
  
  Materials/
    PortholeMask.graphmat         ← Circular vignette shader
    GlassRefraction.graphmat      ← Optional glass edge effect
  
  RemoteServiceModules/
    AccuWeatherRSM                ← Custom RSM for AccuWeather endpoints
    ImagenRSM                     ← RSG Imagen endpoint
```

---

## 6. PHASE-BY-PHASE CURSOR INSTRUCTIONS

### PHASE 1 — Project Bootstrap
```
Create a Lens Studio Spectacles project using the Base Template.
Install from Asset Library:
  - SpectaclesInteractionKit (latest)
  - Remote Service Gateway package
  - UI Kit
  - Spatial Image sample (for reference — do not use sample scripts directly)

Set: Lens Studio → Project Settings → Lens Is Made For → Spectacles
Set: Preview → Device Type Override → Spectacles
```

### PHASE 2 — Type System (TripState.ts)
Define all interfaces: TripData, PriceRecord, PriceSource, WeatherCurrent, WeatherForecastDay, PackingItem, PackingCategory. Export all. No implementation, only types.

### PHASE 3 — Tool Definitions (ToolDefinitions.ts)
Export `createTools(): GeminiTypes.Common.Tool[]` with all 7 function_declarations:
saveTripDetails, showCategories, getAccuWeatherData, searchHotelPrices, searchFlightPrices, closeWebView, startPackingAnalysis.
Import GeminiTypes from `RemoteServiceGateway.lspkg/HostedExternal/GeminiTypes`.

### PHASE 4 — Gemini Session Manager (GeminiSessionManager.ts)
Full GeminiLive WebSocket session. Model: `models/gemini-2.0-flash-live-preview-04-09`.
Events: onSetupComplete, onTranscript, onText, onTurnComplete, onFunctionCall.
Methods: sendText, sendAudioChunk, sendVideoFrame, sendFunctionResponse.
No async/await — all callbacks.

### PHASE 5 — Anti-Tracking Engine (AntiTrackingEngine.ts)
WebView lifecycle: destroy → 100ms delay → create fresh provider.
UA pool: 5 browser strings. Rotation: `(index++) % 5`.
URL template builder: replace {city}, {checkIn}, {checkOut}, {adults}, {origin} — encodeURIComponent for city/origin only.
Hotel sources: Booking.com, Agoda, Hotels.com, Airbnb, Expedia.
Flight sources: Google Flights, Skyscanner, Kayak, Momondo.

### PHASE 6 — Inflation Detector (InflationDetector.ts)
PriceRecord[] history. recordSearch(). getWarning(destination) → warn at ≥3. reset().

### PHASE 7 — Weather Service (WeatherService.ts)
Two-step AccuWeather: geoposition lookup → current conditions + 5-day forecast.
CITY_COORDS map for 15 cities. DeviceLocation fallback.
buildPackingTips(current, forecast) → string[].

### PHASE 8 — Destination Visualizer (DestinationVisualizer.ts)
generateDestinationImage(destination, occasion, weather, callback) → RSG Imagen endpoint.
SCENE_PROMPTS map for 6 categories.
applyToSpatialFrame(base64, destination) → decode base64 → Texture → sikSpatialImageFrame.setImage(texture, true).
Category-reactive: re-generate on each category tap with matching prompt.

### PHASE 9 — Packing Analyzer (PackingAnalyzer.ts)
VideoController at 1500ms, HighQuality, Jpg.
start(destination, weatherCtx, tripType) → enable camera, enable packingContainer.
parsePackingResponse(text) → split on newlines, detect ✅/⚠️/❌ prefix → PackingItem[].
isActive() → boolean.

### PHASE 10 — UI Controller (UIController.ts)
All @input decorated fields. 6 category labels with emoji. Methods:
showCategories, hideCategories, updateStatus, updateResponse (max 150 chars),
showPackingResults (partition + format), updateWeatherDisplay, updateTripInfo.

### PHASE 11 — Main Orchestrator (NewInCityAssistant.ts)
onAwake: require InternetModule, instantiate all services, init WebView, setup location, hide categories.
UpdateEvent: call destinationVisualizer.updateParallax().
handleFunction switch: 7 cases, all call sendFunctionResponse.
onCategoryTapped: 6 prompt strings using tripData values + trigger scene regeneration.
reset(): clear all state, close WebView, dismiss Porthole.

### PHASE 12 — Scene Hierarchy
```
Root
├── RemoteServiceGatewayCredentials  (SceneObject)
├── WebSocketRequirements            (SceneObject, required WS component)
├── PortholeSystem                   (SceneObject)
│   ├── SikSpatialImageFrame
│   └── VignettePlane
├── WebViewParent                    (disabled by default)
│   └── WebViewImage                 (Image)
├── AssistantUI
│   ├── ResponseText, StatusText, WeatherDisplay, TripInfoDisplay, PriceAlertText
│   └── CategoryCards[0..5]          (each disabled by default, each has Text child)
├── PackingContainer                 (disabled by default)
│   ├── PackingGoodText, PackingPassesText, PackingBadText
└── NewInCityAssistant               (SceneObject with root component)
```

### PHASE 13 — Remote Service Module Setup
In Lens Studio editor:
- Create RemoteServiceModule asset for AccuWeather
- Endpoint 1: `geoposition_search` → GET `https://dataservice.accuweather.com/locations/v1/cities/geoposition/search`
- Endpoint 2: `current_conditions` → GET `https://dataservice.accuweather.com/currentconditions/v1/{Key}`
- Endpoint 3: `forecast_5day` → GET `https://dataservice.accuweather.com/forecasts/v1/daily/5day/{Key}`
- Add AccuWeather API key to endpoint headers

### PHASE 14 — RSG Token Setup
In Lens Studio: Windows → Remote Service Gateway Token
- Generate Google Token (for Gemini + Imagen + spatialization)
- Generate OpenAI Token (optional — for GPT Vision packing fallback + TTS)
- Add component RemoteServiceGatewayCredentials to scene, paste tokens

---

## 7. IMPORT REFERENCE CHEATSHEET

```typescript
// ===== GEMINI =====
import { Gemini, GeminiLiveWebsocket } from 'RemoteServiceGateway.lspkg/HostedExternal/Gemini';
import { GeminiTypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GeminiTypes';

// ===== RSG HELPERS =====
import { AudioProcessor }     from 'RemoteServiceGateway.lspkg/Helpers/AudioProcessor';
import { DynamicAudioOutput } from 'RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput';
import { MicrophoneRecorder } from 'RemoteServiceGateway.lspkg/Helpers/MicrophoneRecorder';
import { VideoController }    from 'RemoteServiceGateway.lspkg/Helpers/VideoController';

// ===== SIK =====
import { SIK }   from 'SpectaclesInteractionKit.lspkg/SIK';
import Event     from 'SpectaclesInteractionKit.lspkg/Utils/Event';

// ===== NATIVE MODULES (require, not import) =====
const internetModule  = require('LensStudio:InternetModule');
const cameraModule    = require('LensStudio:CameraModule');
const batteryModule   = require('LensStudio:BatteryModule');
// RemoteServiceModule comes as @input, not require

// ===== BASE64 =====
// Built-in global — no import needed:
Base64.decode(str)  // string → Uint8Array
Base64.encode(arr)  // Uint8Array → string
```

---

## 8. CONSTRAINTS & GOTCHAS

### TypeScript Rules
- No `async/await` anywhere — Lens Studio runtime does not support it
- All async operations use callbacks (performApiRequest, DelayedCallbackEvent)
- Use `print()` not `console.log()`
- No `npm` packages — Lens Studio native only
- All types must be explicit — no implicit `any` except Gemini message payloads
- Guard all optional @input fields: `if (this.statusText) this.statusText.text = value`

### RSG Rules
- RSG APIs **only work on physical Spectacles hardware** — cannot test in simulator
- RSG requires `RemoteServiceGatewayCredentials` component in scene with valid tokens
- Tokens are per-developer-account — never commit to version control
- Max ~3 concurrent RSM calls — keep to 1 for best performance
- RSM response body max ~800 KB

### Spatial Image Rules
- `SikSpatialImageFrame.setImage(texture, true)` shows flat image immediately, spatializes async
- Spatialization requires Google Token (calls Snap's depth estimation service)
- Test on device — spatial effect doesn't render in simulator
- `SpatialImageDepthAnimator.setBaseDepthScale()` controls how "3D" it looks (default 1.0)

### WebView Rules
- Always destroy old provider before creating new one (anti-tracking requires this)
- Use `DelayedCallbackEvent(0.1)` between destroy and create — gives runtime time to clean up
- `provider.setUserAgent()` — guard with existence check before calling
- Setting `provider = null` destroys the WebView and clears all cookies/cache/localStorage

### Audio Pipeline
- `dynamicAudioOutput.initialize(24000)` must be called BEFORE any audio frames arrive
- `microphoneRecorder.setSampleRate(16000)` must be called BEFORE startRecording()
- Both must be set up before the Gemini session setup config is sent

### Lens Studio 5.15 Specific
- This is the **last supported version for Spectacles 2024** — do not upgrade to 5.16+ if released
- TypeScript interfaces can now implement other interfaces (fixed in recent update)
- MCP server available for Cursor integration: Lens Studio → Windows → MCP Server

---

## 9. RESOURCE LINKS

All resources any agent needs for this build:

| Resource | URL |
|---|---|
| Remote Service Gateway docs | https://developers.snap.com/spectacles/about-spectacles-features/apis/remoteservice-gateway |
| RSG Token Generator | Lens Studio → Windows → Remote Service Gateway Token |
| Spatial Image API | https://developers.snap.com/spectacles/about-spectacles-features/apis/spatial-image |
| SIK Hand Tracking | https://developers.snap.com/spectacles/spectacles-frameworks/spectacles-interaction-kit/features/handtracking |
| SIK Getting Started | https://developers.snap.com/spectacles/spectacles-frameworks/spectacles-interaction-kit/get-started |
| Compatibility List | https://developers.snap.com/spectacles/about-spectacles-features/compatibility-list |
| Lens Scripting API | https://developers.snap.com/lens-studio/api/lens-scripting/ |
| CameraModule API | https://developers.snap.com/lens-studio/api/lens-scripting/classes/Built-In.CameraModule.html |
| Spectacles intro | https://developers.snap.com/spectacles/get-started/introduction |
| Lens Studio download | https://ar.snap.com/spectacles (v5.15.x) |
| Asset Library | Lens Studio → Window → Asset Library |
| AI Playground sample | Lens Studio → Home → Sample Projects → AI Playground |
| Gemini Live model | models/gemini-2.0-flash-live-preview-04-09 |
| Imagen model | imagen-3.0-generate-002 |
| AccuWeather API | https://developer.accuweather.com |
| Snap Cloud (Supabase) | Lens Studio → Project → Snap Cloud |
| SnapML | https://developers.snap.com/lens-studio/features/machine-learning |

---

## APPENDIX: PORTHOLE SYSTEM PROMPT (for Gemini Live)

```
You are PORTHOLE, a smart travel assistant running on Snap Spectacles AR glasses.

Your personality: Confident, efficient, subtly witty. You're the travel-savvy friend who knows how to get real prices.

CAPABILITIES:
1. Real-time AccuWeather forecasts via getAccuWeatherData
2. Anti-tracking hotel search — fresh browser session, rotated identity, no cookie trail
3. Anti-tracking flight search — same fresh-session approach
4. Multi-source price comparison (5 hotel sites, 4 flight sites)
5. Packing analysis via your camera — show your bag, I'll check it
6. Destination visualization — I open a spatial "porthole" to your destination when confirmed

PRICING INTELLIGENCE:
- We clear all cookies before every search
- We rotate browser identity after 2+ searches for the same route
- We compare multiple sources to find real market price (not inflated repeat-search pricing)
- Always tell the user when a fresh session is being used: "Searching with a clean session"
- Warn the user when inflation risk is detected

PACKING RATINGS:
- ✅ Good to Go: Perfect for this destination, weather, and trip type
- ⚠️ Passes: Acceptable but not ideal
- ❌ Needs Work: Wrong for conditions, consider replacing

SPATIAL EXPERIENCE:
When a destination is confirmed, I generate a visual "porthole" — a spatial AR window showing the destination.
Each category you explore (Stay, Food, Places etc.) changes the scene behind the porthole.

Keep responses SHORT for AR glasses — 1-3 sentences max unless doing a detailed search.
Never say "As an AI" or similar.
```

---

*Document generated for Porthole build — Lens Studio 5.15.x — Spectacles 2024 Developer Edition*
*All RSG APIs require physical Spectacles hardware. Spatial Image requires Google Token.*
