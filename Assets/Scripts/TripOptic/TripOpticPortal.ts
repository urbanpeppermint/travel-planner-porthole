import { Imagen } from 'RemoteServiceGateway.lspkg/HostedExternal/Imagen'
import { GoogleGenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes'
import { GlassKit } from './TripOpticGlassKit'
import { TripOpticPlaces } from './TripOpticPlaces'
import { fetchTexture } from './TripOpticRemoteImage'

const IMAGEN_MODEL = 'imagen-3.0-generate-002'

export type PortalSource = 'places' | 'imagen' | 'wiki'

/**
 * City photo inside the portal sphere as a circular disc. No Spatial Image.
 */
export class TripOpticPortal {
  onImage: (source: PortalSource | null, attribution: string) => void = () => {}

  private disc: SceneObject | null = null
  private pivot: SceneObject | null = null
  private cameraRef: Camera | null = null
  private requestId = 0

  constructor(
    private kit: GlassKit,
    private parent: SceneObject,
    private center: vec3,
    private diameterCm: number,
    private places: TripOpticPlaces | null,
    private internetModule: InternetModule,
    private remoteMediaModule: RemoteMediaModule,
  ) {
    this.ensurePivot()
  }

  /** Photo pivot — attach chips that should sit on the destination orb. */
  content(): SceneObject {
    return this.ensurePivot()
  }

  /** Face the device camera so walking around the orb never shows a paper edge. */
  tick(): void {
    this.faceCamera()
  }

  async load(city: string, purpose: string): Promise<void> {
    const id = ++this.requestId
    const prompt = this.prompt(city, purpose)
    const attempts: { source: PortalSource; run: () => Promise<{ tex: Texture; attribution: string }> }[] = []
    if (this.places && this.places.enabled) {
      attempts.push({ source: 'places', run: () => this.fromPlaces(city) })
    }
    attempts.push({ source: 'wiki', run: () => this.fromWiki(city) })
    attempts.push({ source: 'imagen', run: () => this.fromImagen(prompt) })
    for (let i = 0; i < attempts.length; i++) {
      try {
        const result = await attempts[i].run()
        if (id !== this.requestId) {
          return
        }
        print(`[TripOpticPortal] image from ${attempts[i].source}`)
        this.show(result.tex)
        this.onImage(attempts[i].source, result.attribution)
        return
      } catch (e) {
        print(`[TripOpticPortal] ${attempts[i].source} failed: ${e}`)
      }
    }
    this.onImage(null, '')
  }

  private ensurePivot(): SceneObject {
    if (!this.pivot) {
      this.pivot = this.kit.node(this.parent, 'PortalContent', this.center.x, this.center.y, this.center.z)
      const r = this.diameterCm * 0.5
      this.kit.ring(this.pivot, 'PortalHalo', 0, 0, -0.28, r + 1.15, 1.15, { color: [0.62, 0.5, 1], tintAlpha: 0.1, rimPower: 2.6 })
      this.kit.ring(this.pivot, 'PortalRim', 0, 0, 0.28, r + 0.2, 0.42, { color: [0.72, 0.58, 1], tintAlpha: 0.16, rimPower: 2.3 })
    }
    return this.pivot
  }

  private faceCamera(): void {
    const pivot = this.pivot
    const cam = this.camera()
    if (!pivot || !cam) {
      return
    }
    const from = pivot.getTransform().getWorldPosition()
    const to = cam.getTransform().getWorldPosition()
    const look = new vec3(to.x - from.x, 0, to.z - from.z)
    if (look.length < 0.5) {
      return
    }
    pivot.getTransform().setWorldRotation(quat.lookAt(look.normalize(), vec3.up()))
  }

  private camera(): Camera | null {
    if (this.cameraRef && !isNull(this.cameraRef)) {
      return this.cameraRef
    }
    const n = global.scene.getRootObjectsCount()
    for (let i = 0; i < n; i++) {
      const found = this.findCamera(global.scene.getRootObject(i))
      if (found) {
        this.cameraRef = found
        return found
      }
    }
    return null
  }

  private findCamera(so: SceneObject): Camera | null {
    const cam = so.getComponent('Component.Camera') as Camera
    if (cam && cam.type === Camera.Type.Perspective) {
      const target = global.scene.liveTarget ?? global.scene.captureTarget
      if (!target || (cam.renderTarget && cam.renderTarget.isSame(target))) {
        return cam
      }
    }
    for (let i = 0; i < so.getChildrenCount(); i++) {
      const found = this.findCamera(so.getChild(i))
      if (found) {
        return found
      }
    }
    return null
  }

  private show(tex: Texture): void {
    if (this.disc) {
      this.disc.destroy()
    }
    this.disc = this.kit.image(this.ensurePivot(), 'PortalImage', tex, 0, 0, 0.35, this.diameterCm, this.diameterCm, this.diameterCm * 0.5)
    ;(this.disc.getComponent('Component.RenderMeshVisual') as RenderMeshVisual).setRenderOrder(3)
  }

  private prompt(city: string, purpose: string): string {
    const mood = purpose === 'Business' ? 'clean early-morning light' : 'blue hour, warm city lights'
    return [
      `Photorealistic travel photograph of ${city}, its most iconic skyline and landmark.`,
      `Mood: ${mood}. Wide establishing shot, centered composition, no people, no text.`,
    ].join(' ')
  }

  private async fromImagen(prompt: string): Promise<{ tex: Texture; attribution: string }> {
    const request = {
      model: IMAGEN_MODEL,
      body: {
        parameters: { sampleCount: 1, addWatermark: false, aspectRatio: '1:1', enhancePrompt: true, language: 'en', seed: 0 },
        instances: [{ prompt }],
      },
    } as GoogleGenAITypes.Imagen.ImagenRequest
    const response = await Imagen.generateImage(request)
    const b64 = response.predictions && response.predictions.length > 0 ? response.predictions[0].bytesBase64Encoded : ''
    if (!b64) {
      throw new Error('no image in Imagen response')
    }
    return { tex: await this.decode(b64), attribution: '' }
  }

  private async fromPlaces(city: string): Promise<{ tex: Texture; attribution: string }> {
    if (!this.places || !this.places.enabled) {
      throw new Error('Places API key missing')
    }
    const results = await this.places.search(`${city} most famous landmark`, 1, 'tourist_attraction')
    const photo = results.length > 0 ? results[0].photo : undefined
    if (!photo) {
      throw new Error('no Places photo')
    }
    const tex = await this.places.photoTexture(photo, 1024)
    return { tex, attribution: '' }
  }

  private async fromWiki(city: string): Promise<{ tex: Texture; attribution: string }> {
    if (this.places) {
      const tex = await this.places.wikiPhoto(city)
      return { tex, attribution: '' }
    }
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(city)}`
    const response = await this.internetModule.fetch(url, { method: 'GET' })
    if (response.status !== 200) {
      throw new Error(`wiki ${response.status}`)
    }
    const json = await response.json()
    const src: string =
      json && json.originalimage && json.originalimage.source
        ? json.originalimage.source
        : json && json.thumbnail && json.thumbnail.source
          ? json.thumbnail.source
          : ''
    if (!src) {
      throw new Error('wiki: no thumbnail')
    }
    return { tex: await fetchTexture(this.internetModule, src), attribution: '' }
  }

  private decode(b64: string): Promise<Texture> {
    const marker = 'base64,'
    const idx = b64.indexOf(marker)
    const clean = idx >= 0 ? b64.substring(idx + marker.length) : b64
    return new Promise<Texture>((resolve, reject) => {
      Base64.decodeTextureAsync(clean, resolve, () => reject(new Error('decodeTextureAsync failed')))
    })
  }
}
