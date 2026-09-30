# TripOptic_Glass — rebuild recipe for Lens Studio 5.15

**Full port playbook** (scripts, Spatial Image crop, Places, Icon/Photo shaders, scene wiring): see `TRIPOPTIC_5.15_PORT.md` at the Travel_Planner repo root (copied from TripOptic_5.24).

This file is the Glass shader only. Use this if 5.15 cannot open `TripOptic_Glass.graphShader` (authored in 5.24).
If that happens, delete the `TripOptic_Glass.*` files in this folder, then
rebuild with the steps below. `TripOptic_Icon` is the same idea: if it fails,
use the existing `image_unlit` material instead (same `baseTex` / `baseColor`).

Result: soft glass body (`tint`, low alpha) plus a neon rim (`rimColor`).
- 3D meshes (capsules, portal sphere): Fresnel rim, `edgeGlow = 0`.
- Flat quads (panels, cards, badges, lines): rounded-rect edge glow,
  `edgeGlow > 0`, with `aspect = width / height`. `TripOpticGlassKit.ts`
  sets these per object at runtime.

## 1. Graph Material and parameters

Asset Browser → **+** → **Graph Material**, name it `TripOptic_Glass`.
Add these parameter nodes at the root of the graph:

| Node | Title | Script Name | Default | Range |
|---|---|---|---|---|
| Color Parameter (rgba) | Tint | `tint` | set on material: `0.55, 0.70, 1.00, 0.12` | |
| Color Parameter (rgba) | Rim Color | `rimColor` | set on material: `0.75, 0.45, 1.00, 1.00` | |
| Float Parameter | Rim Power | `rimPower` | `2.5` | 0.5 – 8 |
| Float Parameter | Edge Glow | `edgeGlow` | `0` | 0 – 3 |
| Float Parameter | Aspect | `aspect` | `1` | 0.05 – 20 |
| Float Parameter | Corner Radius | `cornerRadius` | `1` | 0 – 1 |
| Float Parameter | Edge Width | `edgeWidth` | `0.08` | 0.005 – 1 |

The Color Parameter "Default" field is a single number, so set the real
colors in the material Inspector after saving the graph.

## 2. Custom Code node

Add **Custom Code** (Stage: Pixel), paste, apply (Cmd+Enter). Wire each
parameter to the matching `...In` port and `result` → Shader **Final Color**.

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

If 5.15 rejects `fwidth`, replace that line with `float aa = 0.02;`.

## 3. Material pass settings

- Blend Mode: **Normal**
- Depth Write: **off**, Depth Test: on
- Two Sided: **off**, Cull Mode: **Back**

## Runtime use

```ts
const mat = glassMaterial.clone()
const pass = mat.mainPass as any
pass.tint = new vec4(0.55, 0.7, 1.0, 0.12)
pass.rimColor = new vec4(0.75, 0.45, 1.0, 1.0)
pass.edgeGlow = 1.0
pass.aspect = widthCm / heightCm
pass.cornerRadius = 1.0
pass.edgeWidth = 0.35 / (heightCm * 0.5)
```

Always clone per object; the kit does this for you.
