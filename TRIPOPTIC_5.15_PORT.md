# TripOptic — Lens Studio 5.15 port playbook

**Visual source:** `TripOptic_5.24` (Lens Studio 5.24, Spectacles 27 / SIK 0.18).
**Ship target:** `Travel_Planner` (Lens Studio **5.15 only**, Spectacles 2024 / SIK **0.15**).

Never open `Travel_Planner` in 5.24. Copy files and rebuild shaders in 5.15. Do not rewrite existing 5.15 trip-plan / voice / weather / pack-scan scripts until you are ready to swap the UI layer over; this prototype lives beside them.

World units are **centimeters**. Editor rotations are **degrees**; runtime rotations are **radians**.

---

## 1. What you are porting

Runtime-built glass UI (no Spectacles UI Kit):

- Six 3D Fresnel capsules (Stay, Transport, Food, Places, Weather, Pack)
- Detail panel (hero + two small cards, View details, Reviews overlay)
- Ask bar, weather chip, tip card
- Glass portal sphere with a **circular-cropped** city photo that turns to face you, then Spatial Image inside the sphere
- Street map (Stay / Food / Places / Transport) with colored walking routes and a Start trip control
- Google Places photos + reviews (Stay / Food / Places) when a Places API key is set
- Imagen, then Wikipedia, as portal fallbacks

Scripts (copy as-is from 5.24 `Assets/Scripts/TripOptic/`):

| File | Role |
|---|---|
| `TripOpticGlassKit.ts` | MeshBuilder pills/quads, glass/icon/photo, Interactable+box collider |
| `TripOpticLayoutPrototype.ts` | Scene layout at world `(0, 0, -60)` |
| `TripOpticDetailPanel.ts` | Side panel, Reviews dropdown |
| `TripOpticPlaces.ts` | Places API (New): search, photos, reviews |
| `TripOpticPortal.ts` | Portal image, circle crop, camera-facing pivot, Spatial Image fit inside the sphere |
| `TripOpticMap.ts` | Street map, category-colored walks, Start / End trip |

Materials to rebuild in 5.15 (graphShader YAML from 5.24 often **will not open**):

- `TripOptic_Glass` — Fresnel capsules + UV edge glow on flat panels
- `TripOptic_Icon` — `baseTex * baseColor`
- `TripOptic_Photo` — center-crop + rounded-rect / circle mask

---

## 2. Hard constraints in 5.15

- **SIK 0.15 only.** Use `Interactable` via `createComponent(Interactable.getTypeName())`. Bind `onHoverEnter` / `onHoverExit` / `onTriggerEnd`. Do not use SIK 0.18-only APIs or Spectacles UI Kit.
- **`worldSpaceRect` on Text is required** in 5.15 (deprecated warning in 5.24 is OK).
- **`TEXT_SIZE_PER_CM = 100`** in `TripOpticGlassKit` — do not lower it.
- **Ratings only from Google Places** (`ratingSource === 'places'`). Never invent stars.
- **Never commit API keys.** Places key is an Inspector string on `TripOptic_Proto`.
- **No spatial-image portal ring object** (no `SikSpatialImageFrame`). Use the stock **Spatial Image** component inside the glass sphere.
- Layout is **script-driven**. Do not author the capsules in the Hierarchy by hand.

---

## 3. Packages to install (Asset Library, Spectacles)

Install in the **5.15** project if missing:

1. **Spectacles Interaction Kit** (keep the 0.15 line already in Travel_Planner)
2. **Remote Service Gateway** + **RemoteServiceGatewayCredentials** in the scene (Snap + Google tokens)
3. **Spatial Image** (`Spatial Image.lsc`) — not Spatial Image Advanced / not SikSpatialImageFrame
4. **Internet Module** and **Remote Media Module** assets (or `require('LensStudio:InternetModule')` / `require('LensStudio:RemoteMediaModule')`)

Confirm Device Type Override / preview device is **Spectacles**.

---

## 4. Scene objects (manual)

Create an empty object **`TripOptic_Proto`**:

- World position **`(0, 0, -60)`** (same frame as `App_TravelRoot`)
- Scale `(1, 1, 1)`
- Attach script **`TripOpticLayoutPrototype`**

Child **`Spatial Image`** (from the Spatial Image component preset / custom component):

- Local position **`(0, 4.9, -10)`** — portal center, parented under `TripOptic_Proto`
- Local scale starts at **1**. Runtime fits the mesh inside the sphere after spatialization (`frameOn` off, `depthScale` about 70). Do not leave the default `frameOffset` of **-200**.
- Wire: Spatial Image Shader (mesh material), Remote Service Module, Internet Module, Remote Media Module
- Leave **Image Texture** empty (script calls `setImage`)

Do **not** parent Spatial Image at scene root. Do **not** add a separate Spatial Image Frame / gallery.

Disable or hide the old 5.15 destination visualizer **only when** you switch the live UI over. Until then, keep `App_TravelRoot` as-is and treat `TripOptic_Proto` as a parallel prototype.

---

## 5. Inspector wiring on `TripOpticLayoutPrototype`

| Input | What to assign |
|---|---|
| `city` / `purpose` / `days` | e.g. Paris / Leisure / 3 |
| `glassMaterial` | `TripOptic_Glass` |
| `iconMaterial` | `TripOptic_Icon` |
| `photoMaterial` | `TripOptic_Photo` |
| `titleFont` | Michroma (copy from Travel_Planner fonts if needed) |
| `internetModule` | Internet Module asset |
| `remoteMediaModule` | Remote Media Module asset |
| `placesApiKey` | Google Places API **(New)** key — scene only, never git |
| `spatialImage` | The Spatial Image **script component** (not the SceneObject) |
| Icons | `bed`, `train`, `restaurant`, `location_on`, `partly_cloudy_day`, `luggage`, `mic`, `lightbulb`, `close`, `star`, `image` |

RSG Google token is **not** a Places key. Places photos and restaurant reviews stay sample until that field is filled.

---

## 6. Rebuild shaders in 5.15

5.15 stores graphs as binary `.ss_graph`. If importing `*.graphShader` fails, delete the imported files and rebuild with **Graph Material**.

Color Parameter “Default” is a **scalar** in the graph. Set real `vec4` values on the **material** after saving.

All three materials:

- Blend: **Normal**
- Depth Write: **off**, Depth Test: **on**
- Two Sided: **off**, Cull: **Back**

### 6.1 `TripOptic_Glass`

Parameters:

| Title | Script name | Type | Default on material |
|---|---|---|---|
| Tint | `tint` | color rgba | `0.55, 0.70, 1.00, 0.12` |
| Rim Color | `rimColor` | color rgba | `0.75, 0.45, 1.00, 1.00` |
| Rim Power | `rimPower` | float 0.5–8 | `2.5` |
| Edge Glow | `edgeGlow` | float 0–3 | `0` |
| Aspect | `aspect` | float 0.05–20 | `1` |
| Corner Radius | `cornerRadius` | float 0–1 | `1` |
| Edge Width | `edgeWidth` | float 0.005–1 | `0.08` |

Custom Code, **Pixel** stage. Wire each `*In` port; `result` → Shader **Final Color**. Cmd+Enter to apply.

```glsl
input_vec4 tintIn;
input_vec4 rimColorIn;
input_float rimPowerIn;
input_float edgeGlowIn;
input_float aspectIn;
input_float cornerRadiusIn;
input_float edgeWidthIn;
output_vec4 result;

void main()
{
	vec3 n = normalize(system.getSurfaceNormalWorldSpace());
	vec3 v = normalize(system.getCameraPosition() - system.getSurfacePositionWorldSpace());
	float facing = clamp(abs(dot(n, v)), 0.0, 1.0);
	float fres = pow(1.0 - facing, max(rimPowerIn, 0.01));

	float edge = 0.0;
	float mask = 1.0;
	if (edgeGlowIn > 0.0) {
		vec2 uv = system.getSurfaceUVCoord0();
		float a = max(aspectIn, 0.01);
		vec2 q = vec2((uv.x - 0.5) * 2.0 * a, (uv.y - 0.5) * 2.0);
		float r = clamp(cornerRadiusIn, 0.0, 1.0);
		vec2 dq = abs(q) - vec2(a, 1.0) + vec2(r);
		float d = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - r;
		float aa = max(fwidth(d), 0.001);
		mask = clamp(-d / aa, 0.0, 1.0);
		float w = max(edgeWidthIn, 0.001);
		float line = 1.0 - smoothstep(0.0, w * 0.35, abs(d));
		float soft = exp(min(d, 0.0) / w);
		edge = (line + 0.6 * soft) * edgeGlowIn;
	}

	float rim = max(fres, edge) * rimColorIn.a;
	float sum = tintIn.a + rim;
	vec3 rgb = (tintIn.rgb * tintIn.a + rimColorIn.rgb * rim) / max(sum, 0.0001);
	result = vec4(rgb, clamp(sum, 0.0, 1.0) * mask);
}
```

If 5.15 rejects `fwidth`, use `float aa = 0.02;`.

**Usage:** capsules/sphere set `edgeGlow = 0` (Fresnel only). Flat panels set `edgeGlow > 0`, `aspect = width/height`. Always `material.clone()` per object (`TripOpticGlassKit` does this).

Premultiply is in the shader (`tint.rgb * tint.a + rim`). Do not skip it or rims clip to white.

### 6.2 `TripOptic_Icon`

If rebuild fails, use existing `image_unlit` (`baseTex` / `baseColor`).

Parameters: Texture2D `baseTex`, Color `baseColor` (rgba). Pixel code:

```glsl
input_texture_2d baseTexture;
input_vec4 colorInput1;
output_vec4 result;

void main()
{
	vec2 uv = system.getSurfaceUVCoord0();
	vec4 baseTexSample = baseTexture.sample(uv);
	result = baseTexSample * colorInput1;
}
```

Wire `baseTex` → `baseTexture`, `baseColor` → `colorInput1`. Script writes `pass.baseTex` and `pass.baseColor`.

### 6.3 `TripOptic_Photo`

Used for card photos **and** the portal disc.

| Title | Script name | Type | Default |
|---|---|---|---|
| Base Tex | `baseTex` | texture 2D | |
| Base Color | `baseColor` | color rgba | `1,1,1,1` |
| Slot Aspect | `slotAspect` | float | `1` |
| Texture Aspect | `texAspect` | float | `1` |
| Corner Radius | `cornerRadius` | float 0–1 | `0.15` (`1` = circle when slot is square) |

```glsl
input_texture_2d baseTexIn;
input_vec4 baseColorIn;
input_float slotAspectIn;
input_float texAspectIn;
input_float cornerRadiusIn;
output_vec4 result;

void main()
{
	vec2 uv = system.getSurfaceUVCoord0();
	float slot = max(slotAspectIn, 0.01);
	float s = slot / max(texAspectIn, 0.01);
	vec2 tuv = uv;
	if (s > 1.0) {
		tuv.y = (uv.y - 0.5) / s + 0.5;
	} else {
		tuv.x = (uv.x - 0.5) * s + 0.5;
	}
	vec4 c = baseTexIn.sample(tuv) * baseColorIn;

	vec2 q = vec2((uv.x - 0.5) * 2.0 * slot, (uv.y - 0.5) * 2.0);
	float r = clamp(cornerRadiusIn, 0.0, 1.0);
	vec2 dq = abs(q) - vec2(slot, 1.0) + vec2(r);
	float d = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - r;
	float aa = max(fwidth(d), 0.001);
	float mask = clamp(-d / aa, 0.0, 1.0);
	result = vec4(c.rgb, c.a * mask);
}
```

---

## 7. Spatial image — keep it inside the sphere

A 2D shader crop on the disc is **not** enough. Spatial Image uploads the **texture pixels** and returns a rectangular **3D GLTF**.

`TripOpticPortal` (port as-is):

1. **Disc** — original photo, circular via `TripOptic_Photo` corner radius. This is the “before spatializing” look.
2. **`setImage`** — opaque 512×512 **square** center crop only. Do **not** punch circular alpha into the spatial texture (transparent pixels make the depth model latch onto a random inner patch and shrink).
3. **Contain depth** — `frameOffset = -6` (default **−200** blows the mesh into the street), `depthScale = 18`, `frameOn = true`, `fadeBorder = true`.
4. **Scale** — parent Spatial Image to `diameterCm / 100` so it fills the orb (not 0.72). After `onLoaded` status 1, reset GLTF child local scale to `(1,1,1)` and hide the disc.

Editor: Imagen often 404s; Wikipedia is the portal fallback. Spatialization ~8–12 s.

**Do not** use Gemini image models (`gemini-*-image-*`) via RSG.

Card photos if Places is missing or a photo fails: Wikipedia thumbnail for the place name, then photorealistic **Imagen** (`imagen-3.0-generate-002`) so slots are never blank.

---

## 8. Google Places — which SKU and what to budget

Enable **Places API (New)** (not the legacy Places API). Billing is by **field mask**: the request is charged at the **highest** SKU of any requested field.

| You request | SKU |
|---|---|
| Name, address, photo *metadata* (`places.photos`) | **Text Search Pro** — $32 / 1k after **5,000 free**/month |
| + rating, priceLevel | **Text Search Enterprise** — $35 / 1k after **1,000 free**/month |
| + reviews, editorialSummary (what TripOptic’s mask uses today) | **Text Search Enterprise + Atmosphere** — $40 / 1k after **1,000 free**/month |
| Downloading each photo (`…/media`) | **Place Photos** — $7 / 1k after **1,000 free**/month |

**Demo video + test link (open source, tens of opens):** stay inside the free monthly quotas. Do not pre-charge the key. In Google Cloud: billing account, **budget alert $5**, API restriction to Places API (New) only.

- Full UI (stars + Reviews + photos): keep the current mask → **Enterprise + Atmosphere** + Place Photos. A recording session is typically **< 20 searches and < 50 photos → $0**.
- Cheapest demo that still shows pictures: drop `rating`, `userRatingCount`, `priceLevel`, `reviews`, `editorialSummary` from the mask → **Text Search Pro** + Place Photos. Names/photos only; no Reviews chip.

Google Maps often includes **$200/month** trial credit; still set a budget cap.

**Publishable Lens later:** do not bake the Places key into a public Snap. Prefer a small backend proxy, or ship with Wikipedia/Imagen fallbacks and treat Places as an optional key for local/dev builds.

Enable Places API (New) on the Google Cloud key. Restrict the key later for ship.

---

## 9. Copy checklist

From 5.24 → 5.15 `Assets/`:

- [x] `Scripts/TripOptic/*.ts` (all five)
- [x] Icon textures (or re-export Material icons)
- [x] Michroma font if not already in Travel_Planner
- [x] This playbook

Rebuild in 5.15 (do not rely on copied `.graphShader`):

- [x] `TripOptic_Glass` graph + material pass settings
- [x] `TripOptic_Icon` (or `image_unlit` fallback)
- [ ] `TripOptic_Photo` (copied YAML; rebuild in 5.15 if the graph will not open)

Scene:

- [x] `TripOptic_Proto` at `(0,0,-60)` + script + icons + modules
- [x] `Spatial Image` child wired as in §4
- [x] RSG credentials present
- [ ] Places key pasted in Inspector (optional for UI; required for live photos/reviews)

Compile TypeScript in 5.15. If `Interactable` import fails, the SIK 0.15 path is:

`import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable'`

(Adjust if Travel_Planner’s SIK package folder name differs.)

---

## 10. Verify in 5.15 preview

1. Capsules visible, rims not blown-out white, text readable.
2. Pinch Food / Stay / Places — panel opens beside the column.
3. Portal sphere shows a **circular** city image; spatial mesh must **not** fill the street / leave the orb.
4. With Places key: restaurant photos, stars, **Reviews** chip → overlay of real reviews.
5. Existing 5.15 voice / plan / pack-scan still run if you left `App_TravelRoot` enabled.

---

## 11. Known editor vs device

| Path | Editor | Spectacles 2024 |
|---|---|---|
| Spatial Image | Often works after ~10 s; can return server errors | Intended path |
| Imagen `imagen-3.0-generate-002` | Frequent 404 / rate limit | May work with RSG Google token |
| Places | Needs key + internet | Same |
| Wikipedia fallback | Used when Places/Imagen fail | Same |
