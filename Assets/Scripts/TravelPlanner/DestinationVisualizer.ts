import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { Imagen } from 'RemoteServiceGateway.lspkg/HostedExternal/Imagen'
import { GoogleGenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes'
import { buildCategoryPrompt, parseSceneCategory } from './DestinationScenePrompts'

/**
 * Destination preview: **RSG Imagen** (`Imagen.generateImage`) → decode texture → either Snap **Spatial Image**
 * (`setImage(texture)`) or layered Image planes. Matches Remote Service Gateway examples, not raw `performApiRequest`
 * on Gemini_Sync (that path has no image API spec).
 *
 * AccuWeather RSM must never be assigned here — see Snap AccuWeather asset docs:
 * https://developers.snap.com/lens-studio/features/remote-apis/remote-apis-templates/weather-api#weather-api---accuweather-asset
 */
@component
export class DestinationVisualizer extends BaseScriptComponent {
  @input
  @hint('Vertex model id (RSG Imagen proxy).')
  imagenModel: string = 'imagen-3.0-generate-002'

  @input
  @hint('Imagen aspect ratio (e.g. 1:1, 4:3, 16:9).')
  imagenAspectRatio: string = '16:9'

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
  @hint('Assign the Spatial Image template ScriptComponent (SpatialImage.setImage).')
  spatialImageFrame: ScriptComponent

  @input
  useSpatialImageFrame: boolean = false

  @input
  @hint('Ignored for stock SpatialImage (single-arg setImage). Kept for SikSpatialImageFrame swap flag if you swap prefabs.')
  swapSpatialWhenReady: boolean = true

  @input
  @allowUndefined
  @hint('Defaults to first Camera under scene roots if unset')
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
  @hint('Multiplies yaw/pitch parallax offset (layered mode only)')
  parallaxSensitivity: number = 100

  @input
  @hint('Use category templates from DestinationScenePrompts')
  useCategoryPrompt: boolean = false

  @input
  @hint('overview | stay | routes | food | places | adventure | weather')
  sceneCategory: string = 'overview'

  @input
  @hint('Fills {weather} when sceneCategory is weather')
  promptWeatherPhrase: string = 'clear'

  /** Subscribe with `onImageGenerated.add((name) => { ... })` */
  readonly onImageGenerated: Event<string> = new Event<string>()

  private readonly log = new NativeLogger('DestinationVisualizer')
  private isVisible: boolean = false
  private headOriginRotation: quat | null = null
  private readonly planeBaseLocal: vec3[] = [new vec3(0, 0, 0), new vec3(0, 0, 0), new vec3(0, 0, 0)]

  onAwake(): void {
    this.createEvent('UpdateEvent').bind(() => {
      this.updateParallax()
    })
  }

  buildImagePrompt(destination: string, occasion: string, weather: string): string {
    if (this.useCategoryPrompt) {
      const category = parseSceneCategory(this.sceneCategory)
      return buildCategoryPrompt(destination, category, weather.length > 0 ? weather : this.promptWeatherPhrase)
    }

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
    const prompt = this.buildImagePrompt(destination, occasion, weatherCtx)
    this.log.i(`Imagen.generateImage model=${this.imagenModel} dest=${destination}`)

    const request = {
      model: this.imagenModel,
      body: {
        parameters: {
          sampleCount: 1,
          addWatermark: false,
          aspectRatio: this.imagenAspectRatio,
          enhancePrompt: true,
          language: 'en',
          seed: 0,
        },
        instances: [{ prompt }],
      },
    } as GoogleGenAITypes.Imagen.ImagenRequest

    Imagen.generateImage(request)
      .then((response) => {
        if (!response.predictions || response.predictions.length === 0) {
          this.log.e('Imagen response had no predictions')
          onComplete(null)
          return
        }
        const b64 = response.predictions[0].bytesBase64Encoded
        if (b64 && b64.length > 0) {
          onComplete(this.stripDataUrlIfPresent(b64))
          return
        }
        this.log.e('Imagen prediction missing bytesBase64Encoded')
        onComplete(null)
      })
      .catch((err) => {
        this.log.e(`Imagen.generateImage failed: ${err}`)
        onComplete(null)
      })
  }

  applyToPlanes(base64Image: string, destination: string): void {
    Base64.decodeTextureAsync(
      base64Image,
      (texture: Texture) => {
        this.finishApplyPlanes(texture, destination)
      },
      () => {
        this.log.e('Base64.decodeTextureAsync failed')
      },
    )
  }

  private finishApplyPlanes(texture: Texture, destination: string): void {
    if (this.useSpatialImageFrame && this.spatialImageFrame) {
      const framed = this.spatialImageFrame as {
        setImage?: (a: Texture, b?: boolean) => void
      }
      if (typeof framed.setImage === 'function') {
        this.spatialImageFrame.sceneObject.enabled = true
        if (framed.setImage.length >= 2) {
          framed.setImage(texture, this.swapSpatialWhenReady)
        } else {
          framed.setImage(texture)
        }
        this.disableLayeredPlanes()
        this.isVisible = false
        this.headOriginRotation = null
        this.onImageGenerated.invoke(destination)
        this.log.i(`Spatial frame setImage: ${destination}`)
        return
      }
      this.log.w('spatialImageFrame has no setImage(); falling back to layered planes')
    }

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
    this.log.i(`Layered planes active: ${destination}`)
  }

  private disableLayeredPlanes(): void {
    const planes = [this.skyPlane, this.midPlane, this.foregroundPlane, this.vignettePlane]
    for (let i = 0; i < planes.length; i++) {
      const p = planes[i]
      if (p) {
        p.enabled = false
      }
    }
  }

  updateParallax(): void {
    if (!this.isVisible || (this.useSpatialImageFrame && this.spatialImageFrame)) {
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
    if (this.useSpatialImageFrame && this.spatialImageFrame) {
      this.spatialImageFrame.sceneObject.enabled = false
    }
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
      this.log.w(`SceneObject "${plane.name}" needs an Image component`)
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
