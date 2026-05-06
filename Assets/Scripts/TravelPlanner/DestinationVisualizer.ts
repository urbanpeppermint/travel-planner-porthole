import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'

/**
 * Phase 16 — Porthole: RSG image → layered spatial planes + head parallax.
 * Configure a `generate_image` endpoint on your Remote Service Module (RSG).
 * Use a separate material instance per plane if you add `uvOffset` / `uvScale` to the Image shader.
 */
@component
export class DestinationVisualizer extends BaseScriptComponent {
  @input
  @hint('Remote Service Module asset with generate_image endpoint')
  remoteServiceModule: RemoteServiceModule

  @input
  skyPlane: SceneObject

  @input
  midPlane: SceneObject

  @input
  foregroundPlane: SceneObject

  @input
  @allowUndefined
  vignettePlane: SceneObject

  @input
  @allowUndefined
  @hint('Defaults to first root Camera (usually Camera Object) if unset')
  camera: Camera

  @input
  @hint('Sky layer local Z in cm (negative = forward in typical Spectacles UI)')
  skyDepth: number = -600

  @input
  midDepth: number = -300

  @input
  fgDepth: number = -150

  @input
  skyParallax: number = 0.02

  @input
  midParallax: number = 0.06

  @input
  fgParallax: number = 0.12

  @input
  @hint('Multiplies yaw/pitch parallax offset')
  parallaxSensitivity: number = 100

  /** Subscribe with `onImageGenerated.add((name) => { ... })` */
  readonly onImageGenerated: Event<string> = new Event<string>()

  private isVisible: boolean = false
  private headOriginRotation: quat | null = null
  private readonly planeBaseLocal: vec3[] = [new vec3(0, 0, 0), new vec3(0, 0, 0), new vec3(0, 0, 0)]

  onAwake(): void {
    this.createEvent('UpdateEvent').bind(() => {
      this.updateParallax()
    })
  }

  buildImagePrompt(destination: string, occasion: string, weather: string): string {
    const mood =
      occasion === 'romantic'
        ? 'golden hour, warm light'
        : occasion === 'adventure'
          ? 'dramatic mountain light'
          : 'bright midday, vivid colors'
    return [
      `Photorealistic travel scene of ${destination}.`,
      `Mood: ${mood}.`,
      `Weather context: ${weather}.`,
      `Wide establishing shot, no people, architectural detail, high detail.`,
      `Style: travel photography, clean horizon, rich saturation.`,
    ].join(' ')
  }

  generateDestinationImage(
    destination: string,
    occasion: string,
    weatherCtx: string,
    onComplete: (textureBase64: string | null) => void,
  ): void {
    if (!this.remoteServiceModule) {
      print('[Porthole] remoteServiceModule not assigned')
      onComplete(null)
      return
    }

    const prompt = this.buildImagePrompt(destination, occasion, weatherCtx)
    const request = RemoteApiRequest.create()
    request.endpoint = 'generate_image'
    request.body = JSON.stringify({
      prompt: prompt,
      width: 1024,
      height: 512,
      steps: 20,
      guidance_scale: 7.5,
    })

    print(`[Porthole] Requesting image for: ${destination}`)

    this.remoteServiceModule.performApiRequest(request, (response: RemoteApiResponse) => {
      if (response.statusCode !== 1) {
        print(`[Porthole] Image gen failed, statusCode=${response.statusCode}`)
        onComplete(null)
        return
      }

      try {
        const data = JSON.parse(response.body) as Record<string, string>
        const base64 = data.image ?? data.result ?? data.b64 ?? null
        if (base64 && base64.length > 0) {
          onComplete(this.stripDataUrlIfPresent(base64))
          return
        }
        const url = (data.imageUrl ?? data.url ?? '').trim()
        if (url.length > 0) {
          print(
            '[Porthole] Response contained a URL, not base64. Point RSG to return base64 in JSON, or extend this script with RemoteMediaModule + your fetch flow (see SCENE_SETUP.md).',
          )
        } else {
          print('[Porthole] Response JSON missing image / result / b64 field')
        }
        onComplete(null)
      } catch (e) {
        print(`[Porthole] JSON parse error: ${e}`)
        onComplete(null)
      }
    })
  }

  applyToPlanes(base64Image: string, destination: string): void {
    Base64.decodeTextureAsync(
      base64Image,
      (texture: Texture) => {
        this.finishApplyPlanes(texture, destination)
      },
      () => {
        print('[Porthole] Base64.decodeTextureAsync failed')
      },
    )
  }

  private finishApplyPlanes(texture: Texture, destination: string): void {
    this.setPlaneTexture(this.skyPlane, texture, { uvOffsetY: 0.0, uvScaleY: 1.0 })
    this.setPlaneTexture(this.midPlane, texture, { uvOffsetY: 0.2, uvScaleY: 0.6 })
    this.setPlaneTexture(this.foregroundPlane, texture, { uvOffsetY: 0.7, uvScaleY: 0.3 })

    this.positionPlanes()
    this.cachePlaneBases()

    if (this.vignettePlane) {
      this.vignettePlane.enabled = true
    }

    const cam = this.resolveCamera()
    this.headOriginRotation = cam ? cam.getTransform().getWorldRotation() : null

    this.isVisible = true
    this.onImageGenerated.invoke(destination)
    print(`[Porthole] Active view: ${destination}`)
  }

  updateParallax(): void {
    if (!this.isVisible) {
      return
    }
    const cam = this.resolveCamera()
    if (!cam || !this.headOriginRotation) {
      return
    }

    const currentRot = cam.getTransform().getWorldRotation()
    const delta = currentRot.multiply(this.headOriginRotation.invert())
    const euler = delta.toEulerAngles()
    const yaw = euler.y
    const pitch = euler.x
    const s = this.parallaxSensitivity

    this.shiftPlane(this.skyPlane, 0, yaw, pitch, this.skyParallax * s)
    this.shiftPlane(this.midPlane, 1, yaw, pitch, this.midParallax * s)
    this.shiftPlane(this.foregroundPlane, 2, yaw, pitch, this.fgParallax * s)
  }

  dismiss(): void {
    const planes = [this.skyPlane, this.midPlane, this.foregroundPlane, this.vignettePlane]
    for (let i = 0; i < planes.length; i++) {
      const p = planes[i]
      if (p) {
        p.enabled = false
      }
    }
    this.isVisible = false
    this.headOriginRotation = null
  }

  private resolveCamera(): Camera | null {
    if (this.camera) {
      return this.camera
    }
    const rootCount = global.scene.getRootObjectsCount()
    for (let i = 0; i < rootCount; i++) {
      const root = global.scene.getRootObject(i)
      const cam = this.findCameraDepthFirst(root)
      if (cam) {
        return cam
      }
    }
    return null
  }

  private findCameraDepthFirst(obj: SceneObject): Camera | null {
    const cam = obj.getComponent('Component.Camera') as Camera
    if (cam) {
      return cam
    }
    const n = obj.getChildrenCount()
    for (let i = 0; i < n; i++) {
      const found = this.findCameraDepthFirst(obj.getChild(i))
      if (found) {
        return found
      }
    }
    return null
  }

  private stripDataUrlIfPresent(value: string): string {
    const marker = 'base64,'
    const idx = value.indexOf(marker)
    if (idx >= 0) {
      return value.substring(idx + marker.length)
    }
    return value
  }

  private positionPlanes(): void {
    this.setPlaneZ(this.skyPlane, this.skyDepth)
    this.setPlaneZ(this.midPlane, this.midDepth)
    this.setPlaneZ(this.foregroundPlane, this.fgDepth)
  }

  private setPlaneZ(obj: SceneObject, z: number): void {
    if (!obj) {
      return
    }
    const t = obj.getTransform()
    const pos = t.getLocalPosition()
    t.setLocalPosition(new vec3(pos.x, pos.y, z))
    obj.enabled = true
  }

  private cachePlaneBases(): void {
    const planes = [this.skyPlane, this.midPlane, this.foregroundPlane]
    for (let i = 0; i < 3; i++) {
      const p = planes[i]
      this.planeBaseLocal[i] = p ? p.getTransform().getLocalPosition() : new vec3(0, 0, 0)
    }
  }

  private shiftPlane(plane: SceneObject, index: number, yaw: number, pitch: number, strength: number): void {
    if (!plane) {
      return
    }
    const base = this.planeBaseLocal[index]
    const t = plane.getTransform()
    t.setLocalPosition(new vec3(base.x + yaw * strength, base.y + pitch * strength, base.z))
  }

  private setPlaneTexture(
    plane: SceneObject,
    texture: Texture,
    uvParams: { uvOffsetY: number; uvScaleY: number },
  ): void {
    if (!plane) {
      return
    }
    const img = plane.getComponent('Component.Image') as Image
    if (!img) {
      print(`[Porthole] SceneObject "${plane.name}" needs an Image component`)
      return
    }
    img.mainPass.baseTex = texture
    const mp = img.mainPass as any
    if (mp.uvOffset !== undefined) {
      mp.uvOffset = new vec2(0, uvParams.uvOffsetY)
    }
    if (mp.uvScale !== undefined) {
      mp.uvScale = new vec2(1, uvParams.uvScaleY)
    }
  }
}
