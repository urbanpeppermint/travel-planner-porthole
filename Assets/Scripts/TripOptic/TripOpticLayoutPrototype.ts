require('LensStudio:RawLocationModule')

import { Imagen } from 'RemoteServiceGateway.lspkg/HostedExternal/Imagen'
import { GoogleGenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes'
import { ASRQueryController } from '../TravelPlanner/ASRQueryController'
import { GeminiAssistant } from '../TravelPlanner/GeminiAssistant'
import { GlassKit, Rgb } from './TripOpticGlassKit'
import { DetailCardData, DetailPanelData, PanelSide, TripOpticDetailPanel } from './TripOpticDetailPanel'
import { PlaceResult, TripOpticPlaces } from './TripOpticPlaces'
import { TripOpticPortal } from './TripOpticPortal'
import { MapPin, TripOpticMap } from './TripOpticMap'

/**
 * TripOptic mockup layout, built at runtime. Put this on an object at world
 * (0, 0, -60), the same frame as App_TravelRoot in Travel_Planner.
 * Card data below is placeholder until the Places / Imagen feeds are wired.
 */

interface Category {
  key: string
  title: string
  subtitle: string
  color: Rgb
  icon: Texture
}

interface BokehDot {
  holder: SceneObject
  mats: Material[]
  homeAng: number
  homeRad: number
  phase: number
  spin: number
  breath: number
  wander: number
  colorShift: number
}

const WHITE: Rgb = [1, 1, 1]
const SOFT: Rgb = [0.82, 0.86, 1]
const PANEL_RIM: Rgb = [0.5, 0.55, 1]
const CYAN: Rgb = [0.35, 0.85, 1]

const PORTAL_Y = 4.9
const PORTAL_Z = -10
const PORTAL_R = 8

const CAPSULE_W = 17.5
const CAPSULE_H = 5.2
const CAPSULE_D = 2.4
const CAPSULE_Z = 2.7
const CAPSULE_ROWS = [9, 2, -5]
const COLUMN_X = 22.5
const ARC_OUT = 1.5

const WAVE_HEIGHTS = [0.6, 1.2, 2.0, 1.4, 2.4, 1.6, 1.0, 1.8, 0.8]

@component
export class TripOpticLayoutPrototype extends BaseScriptComponent {
  @input city: string = 'Paris'
  @input purpose: string = 'Leisure'
  @input days: number = 3

  @input glassMaterial: Material
  @input iconMaterial: Material
  @input @allowUndefined photoMaterial: Material
  @input @allowUndefined titleFont: Font

  @input internetModule: InternetModule
  @input remoteMediaModule: RemoteMediaModule
  @input
  @allowUndefined
  @hint('Snap Map Module asset (Resources > Map Module). Used for the street map.')
  mapModule: MapModule
  @input
  @hint('Google Places API (New) key. Keep it in the scene only; never commit it.')
  placesApiKey: string = ''

  @input
  @allowUndefined
  @hint('Existing 5.15 Gemini assistant. Ask bar starts the same trip session.')
  geminiAssistant: GeminiAssistant

  @input
  @allowUndefined
  @hint('Existing 5.15 speech capture. Ask bar pinch toggles listen/stop.')
  asrQueryController: ASRQueryController

  @input iconStay: Texture
  @input iconTransport: Texture
  @input iconFood: Texture
  @input iconPlaces: Texture
  @input iconWeather: Texture
  @input iconPack: Texture
  @input iconMic: Texture
  @input iconTip: Texture
  @input iconClose: Texture
  @input iconStar: Texture
  @input iconPhoto: Texture

  private kit: GlassKit
  private places: TripOpticPlaces
  private portal: TripOpticPortal
  private tripMap: TripOpticMap
  private portalCredit: Text | null = null
  private cityLabel: Text | null = null
  private metaLabel: Text | null = null
  private lastPortalCity = ''
  private categories: Category[] = []
  private panel: TripOpticDetailPanel
  private liveData: { [key: string]: DetailPanelData } = {}
  private sampleCache: { [key: string]: DetailPanelData } = {}
  private capsuleGlow: { [key: string]: Material } = {}
  private waveBars: SceneObject[] = []
  private askLabel: Text | null = null
  private listening = false
  private sessionStarted = false
  private spiral: SceneObject | null = null
  private spiralDots: BokehDot[] = []

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.build())
    this.createEvent('UpdateEvent').bind(() => {
      if (this.asrQueryController) {
        const rec = this.asrQueryController.getIsRecording()
        if (rec !== this.listening) {
          this.listening = rec
          if (this.askLabel) {
            this.askLabel.text = rec ? 'Listening…' : 'Ask TripOptic'
          }
        }
      }
      this.animateWave()
      this.animatePortalAura()
      if (this.portal) {
        this.portal.tick()
      }
    })
  }

  private build(): void {
    this.kit = new GlassKit(this.glassMaterial, this.iconMaterial, this.titleFont || null, this.photoMaterial || null)
    this.places = new TripOpticPlaces(
      this.internetModule || (require('LensStudio:InternetModule') as InternetModule),
      this.remoteMediaModule || (require('LensStudio:RemoteMediaModule') as RemoteMediaModule),
      this.placesApiKey,
      this,
    )
    print(`[TripOptic] Places ${this.places.enabled ? 'enabled' : 'disabled (no API key)'}`)
    const root = this.getSceneObject()
    this.categories = this.makeCategories()
    this.panel = new TripOpticDetailPanel(this.kit, root, { close: this.iconClose, star: this.iconStar, photo: this.iconPhoto }, this)
    this.panel.onClosed = (key) => this.setCapsuleActive(key, false)
    this.panel.onMap = () => this.toggleMap()
    this.tripMap = new TripOpticMap(
      this.kit,
      root,
      this.internetModule || (require('LensStudio:InternetModule') as InternetModule),
      this.remoteMediaModule || (require('LensStudio:RemoteMediaModule') as RemoteMediaModule),
      { close: this.iconClose, pin: this.iconPlaces },
      this,
      this.mapModule,
    )
    this.buildPortal(root)
    this.buildMapButton()
    this.buildPrompt(root)
    this.buildCapsules(root)
    this.buildWeatherChip(root)
    this.buildTipCard(root)
    this.buildAskBar(root)
    this.prefetchLive()
    this.lastPortalCity = this.city
    if (this.geminiAssistant) {
      this.geminiAssistant.onTripDraftUpdated.add(() => this.syncFromDraft())
      this.syncFromDraft()
    }
    this.welcomeAssistant()
  }

  /** Spoken + on-screen hello after TTS has subscribed, without starting the trip form. */
  private welcomeAssistant(): void {
    const ev = this.createEvent('DelayedCallbackEvent')
    ev.bind(() => {
      if (this.geminiAssistant) {
        this.geminiAssistant.greetTripOptic()
      }
    })
    ev.reset(0.85)
  }

  /** Open a category's panel beside its capsule column; pinching again closes it. */
  openCategory(key: string): void {
    const index = this.indexOf(key)
    if (index < 0) {
      return
    }
    const current = this.panel.openKey
    if (current === key) {
      this.panel.hide()
      return
    }
    if (current) {
      this.panel.hide()
    }
    const side: PanelSide = index < 3 ? 'left' : 'right'
    const cat = this.categories[index]
    const data = this.liveData[key] || this.cachedSample(cat)
    this.panel.show(data, side)
    this.setCapsuleActive(key, true)
    this.fillMissingPhotos(data)
    this.loadLive(cat)
  }

  private cachedSample(cat: Category): DetailPanelData {
    if (!this.sampleCache[cat.key]) {
      this.sampleCache[cat.key] = this.sampleData(cat)
    }
    return this.sampleCache[cat.key]
  }

  private placesSpec(key: string): { query: string; type: string } | null {
    switch (key) {
      case 'Stay':
        return { query: `hotels in ${this.city}`, type: 'lodging' }
      case 'Food':
        return { query: `best restaurants in ${this.city}`, type: 'restaurant' }
      case 'Places':
        return { query: `top attractions in ${this.city}`, type: 'tourist_attraction' }
      default:
        return null
    }
  }

  private prefetchLive(): void {
    if (!this.places.enabled) {
      print('[TripOptic] Places API key is empty — paste a Google Places API (New) key on TripOptic_Proto.placesApiKey for real photos and reviews.')
      return
    }
    for (let i = 0; i < this.categories.length; i++) {
      this.loadLive(this.categories[i])
    }
  }

  private loadLive(cat: Category): void {
    const spec = this.placesSpec(cat.key)
    if (!spec || !this.places.enabled || this.liveData[cat.key]) {
      return
    }
    this.places
      .search(spec.query, 3, spec.type)
      .then((results) => {
        print(`[TripOptic] Places ${cat.key}: ${results.length} results`)
        const data: DetailPanelData = {
          key: cat.key,
          title: cat.title,
          subtitle: cat.key === 'Places' ? `Top sights in ${this.city}` : `Top picks in ${this.city}`,
          color: cat.color,
          icon: cat.icon,
          cards: results.map((r) => this.cardFromPlace(r)),
        }
        this.liveData[cat.key] = data
        if (this.tripMap) {
          this.tripMap.refresh(this.collectPins())
        }
        this.panel.refresh(data)
        for (let i = 0; i < results.length; i++) {
          const photo = results[i].photo
          if (!photo) {
            continue
          }
          this.places
            .photoTexture(photo, 800)
            .then((tex) => {
              data.cards[i].photo = tex
              data.cards[i].photoAttribution = photo.attribution ? `Photo: ${photo.attribution} · Google` : 'Google'
              this.panel.refresh(data)
            })
            .catch((e) => {
              print(`[TripOptic] photo ${results[i].name}: ${e}`)
              this.fillOnePhoto(data, i)
            })
        }
        this.fillMissingPhotos(data)
      })
      .catch((e) => print(`[TripOptic] Places ${cat.key}: ${e}`))
  }

  private fillMissingPhotos(data: DetailPanelData): void {
    for (let i = 0; i < data.cards.length; i++) {
      if (!data.cards[i].photo) {
        this.fillOnePhoto(data, i)
      }
    }
  }

  private fillOnePhoto(data: DetailPanelData, i: number): void {
    const card = data.cards[i]
    if (card.photo) {
      return
    }
    const ascii = card.name.replace(/[’‘]/g, "'").replace(/[–—]/g, '-')
    const queries = card.photoQuery
      ? [card.photoQuery]
      : [`${ascii} ${this.city}`, ascii]
    this.wikiFirst(queries)
      .then((tex) => {
        if (card.photo) {
          return
        }
        card.photo = tex
        print(`[TripOptic] wiki photo ${card.name}`)
        this.panel.refresh(data)
      })
      .catch((e) => {
        print(`[TripOptic] wiki ${card.name}: ${e}`)
        this.imagenPhoto(card.name, data.key)
          .then((tex) => {
            if (card.photo) {
              return
            }
            card.photo = tex
            this.panel.refresh(data)
          })
          .catch((err) => print(`[TripOptic] imagen ${card.name}: ${err}`))
      })
  }

  private wikiFirst(queries: string[]): Promise<Texture> {
    let chain: Promise<Texture> = Promise.reject(new Error('no query'))
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i]
      chain = chain.catch(() => this.places.wikiPhoto(q))
    }
    return chain
  }

  private imagenPhoto(name: string, key: string): Promise<Texture> {
    const kind = key === 'Food' ? 'restaurant exterior' : key === 'Stay' ? 'hotel facade' : 'landmark'
    const prompt = `Photorealistic travel photograph of ${name} in ${this.city}, ${kind}, natural daylight, no text, no logos, no people in the foreground.`
    const request = {
      model: 'imagen-3.0-generate-002',
      body: {
        parameters: { sampleCount: 1, addWatermark: false, aspectRatio: '4:3', enhancePrompt: true, language: 'en', seed: 0 },
        instances: [{ prompt }],
      },
    } as GoogleGenAITypes.Imagen.ImagenRequest
    return Imagen.generateImage(request).then((response) => {
      const b64 = response.predictions && response.predictions.length > 0 ? response.predictions[0].bytesBase64Encoded : ''
      if (!b64) {
        throw new Error('no image in Imagen response')
      }
      const marker = 'base64,'
      const idx = b64.indexOf(marker)
      const clean = idx >= 0 ? b64.substring(idx + marker.length) : b64
      return new Promise<Texture>((resolve, reject) => {
        Base64.decodeTextureAsync(clean, resolve, () => reject(new Error('decodeTextureAsync failed')))
      })
    })
  }

  private cardFromPlace(r: PlaceResult): DetailCardData {
    return {
      name: r.name,
      price: TripOpticPlaces.priceSymbol(r.priceLevel),
      area: r.address,
      details: r.summary,
      rating: r.rating,
      ratingCount: r.ratingCount !== undefined ? this.compactCount(r.ratingCount) : undefined,
      ratingSource: r.rating !== undefined ? 'places' : undefined,
      photoAttribution: r.photo ? (r.photo.attribution ? `Photo: ${r.photo.attribution} · Google` : 'Google') : undefined,
      reviews: r.reviews && r.reviews.length > 0 ? r.reviews : undefined,
      lat: r.lat,
      lng: r.lng,
    }
  }

  private compactCount(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}k` : `${n}`
  }

  private indexOf(key: string): number {
    for (let i = 0; i < this.categories.length; i++) {
      if (this.categories[i].key === key) {
        return i
      }
    }
    return -1
  }

  private setCapsuleActive(key: string, active: boolean): void {
    const mat = this.capsuleGlow[key]
    if (!mat) {
      return
    }
    try {
      const pass = mat.mainPass as any
      const a = active ? 0.26 : 0.12
      if (pass.tint) {
        pass.tint = new vec4(pass.tint.x, pass.tint.y, pass.tint.z, a)
      }
      pass.rimPower = active ? 1.15 : 1.5
      if (pass.edgeGlow !== undefined) {
        pass.edgeGlow = active ? 2.15 : 1.85
      }
    } catch (e) {
      print(`[TripOptic] setCapsuleActive: ${e}`)
    }
  }

  private makeCategories(): Category[] {
    return [
      { key: 'Stay', title: 'Stay', subtitle: 'Hotels & stays', color: [1, 0.74, 0.3], icon: this.iconStay },
      { key: 'Transport', title: 'Transport', subtitle: 'Flights & transit', color: [0.64, 0.46, 1], icon: this.iconTransport },
      { key: 'Food', title: 'Food', subtitle: 'Restaurants & cuisine', color: [1, 0.38, 0.72], icon: this.iconFood },
      { key: 'Places', title: 'Places', subtitle: 'Attractions & culture', color: [0.36, 0.62, 1], icon: this.iconPlaces },
      { key: 'Weather', title: 'Weather', subtitle: 'Forecast & tips', color: [0.28, 0.95, 0.82], icon: this.iconWeather },
      { key: 'Pack', title: 'Pack', subtitle: 'Checklist & scan', color: [0.9, 0.44, 1], icon: this.iconPack },
    ]
  }

  private sampleData(cat: Category): DetailPanelData {
    const base = { key: cat.key, title: cat.title, color: cat.color, icon: cat.icon }
    const data = this.sampleCards(cat, base)
    if (this.placesSpec(cat.key)) {
      data.subtitle = this.places.enabled ? 'Loading from Google Places…' : 'Sample · add a Places API key'
    }
    return data
  }

  private sampleCards(cat: Category, base: { key: string; title: string; color: Rgb; icon: Texture }): DetailPanelData {
    switch (cat.key) {
      case 'Stay':
        return {
          ...base,
          subtitle: 'Top picks in Paris',
          cards: [
            {
              name: 'Hotel Le Bellevue',
              price: '€120 / night',
              area: 'Near Eiffel Tower · 1.2 km',
              details: 'Boutique hotel with city views, breakfast included, 10 min walk to the Eiffel Tower and Trocadéro metro.',
              photoQuery: 'Hotel Paris Eiffel Tower',
              lat: 48.858,
              lng: 2.293,
            },
            { name: 'Hôtel des Arts', price: '€98 / night', area: 'Montmartre', photoQuery: 'Montmartre', lat: 48.8865, lng: 2.337 },
            { name: 'Maison Marais', price: '€110 / night', area: 'Le Marais', photoQuery: 'Le Marais Paris', lat: 48.8575, lng: 2.3615 },
          ],
        }
      case 'Transport':
        return {
          ...base,
          subtitle: 'Berlin → Paris',
          cards: [
            {
              name: 'Flight BER → CDG',
              price: '€89',
              area: 'Fri 08:40 · 1 h 50 min',
              details: 'Direct flight. RER B from CDG to the city centre takes about 35 minutes.',
              photoQuery: 'Charles de Gaulle Airport',
              lat: 49.0097,
              lng: 2.5479,
            },
            { name: 'Train ICE + TGV', price: '€119', area: '8 h 10 min', photoQuery: 'TGV', lat: 48.8767, lng: 2.359 },
            { name: 'Metro pass', price: '€30', area: '3 days · zones 1–5', photoQuery: 'Paris Metro' },
          ],
        }
      case 'Food':
        return {
          ...base,
          subtitle: 'Restaurants near your stay',
          cards: [
            {
              name: 'Le Petit Bistro',
              price: '€€',
              area: 'French · 400 m',
              details: 'Classic bistro menu, open late. Book ahead for Friday evening.',
              photoQuery: 'French bistro',
              lat: 48.8555,
              lng: 2.2985,
            },
            { name: 'Café Lumière', price: '€', area: 'Brunch', photoQuery: 'Paris cafe', lat: 48.854, lng: 2.3335 },
            { name: 'Marché Saint-Germain', price: '€', area: 'Market hall', photoQuery: 'Marché Saint-Germain', lat: 48.8532, lng: 2.3354 },
          ],
        }
      case 'Places':
        return {
          ...base,
          subtitle: 'Indoor picks for a rainy afternoon',
          cards: [
            {
              name: 'Musée d’Orsay',
              price: '€16',
              area: 'Left Bank',
              details: 'Impressionist collection in a former railway station. Allow 2–3 hours; quieter after 3 pm.',
              photoQuery: "Musee d'Orsay",
              lat: 48.86,
              lng: 2.3266,
            },
            { name: 'Louvre', price: '€22', area: '1st arr.', photoQuery: 'Louvre', lat: 48.8606, lng: 2.3376 },
            { name: 'Sainte-Chapelle', price: '€13', area: 'Île de la Cité', photoQuery: 'Sainte-Chapelle', lat: 48.8554, lng: 2.345 },
          ],
        }
      case 'Weather':
        return {
          ...base,
          subtitle: 'Departure · stay · return',
          cards: [
            {
              name: 'Fri · Berlin',
              price: '14°C · cloudy',
              area: 'Departure',
              details: 'Light jacket for the airport. Rain expected in Paris on Saturday afternoon.',
              photoQuery: 'Berlin',
            },
            { name: 'Sat · Paris', price: '18°C · rain PM', area: 'Stay', photoQuery: 'Rain' },
            { name: 'Sun · Paris', price: '20°C · sunny', area: 'Return', photoQuery: 'Paris' },
          ],
        }
      default:
        return {
          ...base,
          subtitle: 'What to pack',
          cards: [
            {
              name: 'Umbrella',
              area: 'Rain on Saturday',
              details: 'Scan your bag to check the cabin size class and fee risk for your airline.',
              photoQuery: 'Umbrella',
            },
            { name: 'Light jacket', area: '14–20°C', photoQuery: 'Jacket' },
            { name: 'Travel adapter', area: 'Type E', photoQuery: 'Travel adapter' },
          ],
        }
    }
  }

  /** Glass sphere with a circular city photo. */
  private buildPortal(root: SceneObject): void {
    this.kit.sphere(root, 'PortalGlass', 0, PORTAL_Y, PORTAL_Z, PORTAL_R, { color: [0.62, 0.5, 1], tintAlpha: 0.055, rimPower: 1.8 })
    this.cityLabel = this.kit.text(root, 'OrbLabel_City', this.city, 0, -5.2, 0, 1.3, WHITE, 1, 'center', true)
    this.metaLabel = this.kit.text(root, 'OrbLabel_Meta', `${this.days} days · ${this.purpose}`, 0, -7.3, 0, 0.75, SOFT, 0.9, 'center')
    this.portalCredit = this.kit.text(root, 'OrbLabel_Credit', '', 0, -8.8, 0, 0.32, SOFT, 0.7, 'center')
    this.portal = new TripOpticPortal(
      this.kit,
      root,
      new vec3(0, PORTAL_Y, PORTAL_Z),
      PORTAL_R * 1.7,
      this.places,
      this.internetModule || (require('LensStudio:InternetModule') as InternetModule),
      this.remoteMediaModule || (require('LensStudio:RemoteMediaModule') as RemoteMediaModule),
    )
    this.portal.onImage = () => {}
    this.portal.load(this.city, this.purpose)
    this.buildPortalAura(root)
  }

  /** Soft bokeh along a spiral — clones of NeonGlass_Capsule, same as the button rims. */
  private buildPortalAura(root: SceneObject): void {
    this.spiral = this.kit.node(root, 'PortalSpiral', 0, PORTAL_Y, PORTAL_Z)
    this.spiralDots = []
    const n = 16
    const turns = 1.5
    const rInner = PORTAL_R * 1.04
    const rOuter = PORTAL_R * 1.22
    for (let i = 0; i < n; i++) {
      const t = (i + 0.4) / n
      const ang = t * turns * Math.PI * 2
      const rad = rInner + (rOuter - rInner) * t
      const size = 0.58 + t * 0.42 + this.frac(i, 3) * 0.22
      const holder = this.kit.node(this.spiral, `Bokeh_${i}`, Math.cos(ang) * rad, Math.sin(ang) * rad, 0.6)
      const pal: Rgb = this.categories.length > 0 ? this.categories[i % this.categories.length].color : [0.78, 0.62, 1]
      const ball = this.kit.panel(holder, 'Glow', 0, 0, 0, size, size, {
        color: pal,
        tintAlpha: 0.42,
        rimAlpha: 1,
        rimPower: 1.35,
        bodyAlpha: 0.4,
        edgeGlow: 2.1,
        edgeWidthCm: 0.22,
        cornerRadiusCm: size * 0.5,
      })
      const vis = ball.getComponent('Component.RenderMeshVisual') as RenderMeshVisual
      if (vis) {
        vis.setRenderOrder(8)
      }
      this.spiralDots.push({
        holder,
        mats: this.collectMats(holder),
        homeAng: ang,
        homeRad: rad,
        phase: this.frac(i, 1) * Math.PI * 2,
        spin: 0.07 + this.frac(i, 2) * 0.11,
        breath: 0.55 + this.frac(i, 4) * 0.7,
        wander: 0.28 + this.frac(i, 5) * 0.35,
        colorShift: this.frac(i, 6) * 6,
      })
    }
  }

  private collectMats(so: SceneObject): Material[] {
    const out: Material[] = []
    const vis = so.getComponent('Component.RenderMeshVisual') as RenderMeshVisual
    if (vis && vis.mainMaterial) {
      out.push(vis.mainMaterial)
    }
    for (let i = 0; i < so.getChildrenCount(); i++) {
      const kids = this.collectMats(so.getChild(i))
      for (let k = 0; k < kids.length; k++) {
        out.push(kids[k])
      }
    }
    return out
  }

  private frac(i: number, salt: number): number {
    const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
    return x - Math.floor(x)
  }

  private mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
    const s = t < 0 ? 0 : t > 1 ? 1 : t
    return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]
  }

  private paletteColor(time: number, shift: number): Rgb {
    const pal: Rgb[] = []
    for (let i = 0; i < this.categories.length; i++) {
      pal.push(this.categories[i].color)
    }
    if (pal.length === 0) {
      return [0.78, 0.62, 1]
    }
    const n = pal.length
    let u = time * 0.13 + shift
    u = u - n * Math.floor(u / n)
    const i0 = Math.floor(u)
    const i1 = (i0 + 1) % n
    const f = u - i0
    const s = f * f * (3 - 2 * f)
    return this.mixRgb(pal[i0], pal[i1], s)
  }

  private paintDot(mats: Material[], color: Rgb): void {
    for (let i = 0; i < mats.length; i++) {
      try {
        const pass = (mats[i] as any).mainPass
        if (!pass) {
          continue
        }
        pass.tint = new vec4(color[0] * 0.6 + 0.2, color[1] * 0.6 + 0.2, color[2] * 0.6 + 0.2, 0.72)
        pass.rimColor = new vec4(Math.min(1, color[0] * 1.28), Math.min(1, color[1] * 1.28), Math.min(1, color[2] * 1.28), 1)
        pass.rimPower = 1.35
        pass.mainColor = new vec4(color[0], color[1], color[2], 0.48)
        pass.baseColor = new vec4(color[0], color[1], color[2], 0.48)
      } catch (e) {
        // Material clone without a live pass — skip this frame.
      }
    }
  }

  private animatePortalAura(): void {
    if (!this.spiral || this.spiralDots.length === 0) {
      return
    }
    const t = getTime()
    this.spiral.getTransform().setLocalRotation(quat.fromEulerAngles(0, 0, t * 0.045))
    for (let i = 0; i < this.spiralDots.length; i++) {
      const d = this.spiralDots[i]
      const ang = d.homeAng + t * d.spin + Math.sin(t * d.wander + d.phase) * 0.12
      const rad =
        d.homeRad +
        Math.sin(t * 0.38 + d.phase) * 0.32 +
        Math.sin(t * d.wander * 1.4 + d.phase * 1.4) * 0.14
      const z = 0.5 + Math.sin(t * 0.55 + d.phase * 1.8) * 0.22
      const pulse =
        0.68 +
        0.34 * (0.5 + 0.5 * Math.sin(t * d.breath + d.phase)) +
        0.1 * Math.sin(t * d.breath * 0.41 + d.phase * 2.3)
      d.holder.getTransform().setLocalPosition(new vec3(Math.cos(ang) * rad, Math.sin(ang) * rad, z))
      d.holder.getTransform().setLocalScale(new vec3(pulse, pulse, pulse))
      this.paintDot(d.mats, this.paletteColor(t, d.colorShift))
    }
  }

  private syncFromDraft(): void {
    if (!this.geminiAssistant) {
      return
    }
    const draft = this.geminiAssistant.getTripDraft()
    const dest = draft && draft.destinationCity ? draft.destinationCity.trim() : ''
    const purpose = draft && draft.purpose ? String(draft.purpose) : ''
    if (purpose.length > 0) {
      this.purpose = purpose.substring(0, 1).toUpperCase() + purpose.substring(1)
    }
    const city = dest.length > 0 ? dest : this.city
    if (this.cityLabel) {
      this.cityLabel.text = city
    }
    if (this.metaLabel) {
      this.metaLabel.text = `${this.days} days · ${this.purpose}`
    }
    if (this.portal && city.length > 0 && city !== this.lastPortalCity) {
      this.lastPortalCity = city
      this.city = city
      this.portal.load(this.city, this.purpose)
    }
  }

  private buildPrompt(root: SceneObject): void {
    const y = 18
    this.kit.panel(root, 'Prompt_Glass', 0, y, -1, 26, 6.2, { color: PANEL_RIM, tintAlpha: 0.1, edgeGlow: 1.35 })
    this.kit.text(root, 'Prompt_Title', 'Welcome to TripOptic', 0, y + 0.9, -0.8, 0.95, WHITE, 1, 'center')
    this.kit.text(root, 'Prompt_Sub', "I'm your assistant — pinch Ask to talk.", 0, y - 1.0, -0.8, 0.6, SOFT, 0.85, 'center')
  }

  private buildCapsules(root: SceneObject): void {
    const counts: { [key: string]: number } = { Stay: 3, Transport: 3, Food: 3, Places: 3, Weather: 3, Pack: 3 }
    for (let i = 0; i < this.categories.length; i++) {
      const cat = this.categories[i]
      const side = i < 3 ? -1 : 1
      const row = i % 3
      const x = side * (COLUMN_X + (row === 1 ? ARC_OUT : 0))
      const y = CAPSULE_ROWS[row]
      const holder = this.kit.node(root, `Capsule_${cat.key}`, x, y, CAPSULE_Z)
      const glass = this.kit.panel(holder, 'Glass', 0, 0, 0, CAPSULE_W, CAPSULE_H, {
        color: cat.color,
        tintAlpha: 0.12,
        rimPower: 1.5,
        edgeGlow: 1.85,
        edgeWidthCm: 0.78,
      })
      this.capsuleGlow[cat.key] = (glass.getComponent('Component.RenderMeshVisual') as RenderMeshVisual).mainMaterial
      const face = 0.12
      const badgeX = -CAPSULE_W * 0.5 + 2.7
      this.kit.panel(holder, 'Badge', badgeX, 0, face, 3.4, 3.4, { color: cat.color, tintAlpha: 0.18, edgeGlow: 1.15 })
      this.kit.icon(holder, 'Icon', cat.icon, badgeX, 0, face + 0.05, 2.0, WHITE)
      const textX = badgeX + 2.3
      this.kit.text(holder, 'Title', cat.title, textX, 0.75, face, 0.85, WHITE, 1, 'left')
      this.kit.text(holder, 'Count', `${counts[cat.key]}`, CAPSULE_W * 0.5 - 2.6, 0.75, face, 0.7, cat.color, 1, 'right')
      this.kit.text(holder, 'Subtitle', cat.subtitle, textX, -1.0, face, 0.5, SOFT, 0.85, 'left')
      this.kit.text(holder, 'Chevron', '›', CAPSULE_W * 0.5 - 1.5, 0.1, face, 1.1, WHITE, 0.9, 'center')
      this.kit.pressable(holder, CAPSULE_W, CAPSULE_H, CAPSULE_D, () => this.openCategory(cat.key))

      const innerX = x - side * (CAPSULE_W * 0.5)
      const dy = y - PORTAL_Y
      const len = Math.sqrt(innerX * innerX + dy * dy) || 1
      this.kit.line(root, `Line_${cat.key}`, innerX, y, (innerX / len) * PORTAL_R, PORTAL_Y + (dy / len) * PORTAL_R, -3, 0.36, cat.color, 1)
    }
  }

  /** Folded-map logo on the top-right rim of the destination photo. */
  private buildMapButton(): void {
    const size = 3.2
    const r = PORTAL_R * 0.85
    const btn = this.kit.node(this.portal.content(), 'MapButton', r * 0.78, r * 0.78, 0.55)
    this.kit.card(btn, 'Glass', 0, 0, 0, size, size, { color: [0.36, 0.62, 1], tintAlpha: 0.16, edgeGlow: 1.05 })
    this.kit.icon(btn, 'Icon', requireAsset('../../Icons/map.png') as Texture, 0, 0, 0.08, 1.85, WHITE)
    this.kit.pressable(btn, size, size, 1.2, () => this.toggleMap())
  }

  private toggleMap(): void {
    if (this.tripMap) {
      this.tripMap.toggle(this.collectPins())
    }
  }

  private collectPins(): MapPin[] {
    const keys = ['Stay', 'Food', 'Places', 'Transport']
    const pins: MapPin[] = []
    for (let i = 0; i < keys.length; i++) {
      const index = this.indexOf(keys[i])
      if (index < 0) {
        continue
      }
      const cat = this.categories[index]
      const data = this.liveData[cat.key] || this.cachedSample(cat)
      for (let c = 0; c < data.cards.length; c++) {
        const card = data.cards[c]
        if (typeof card.lat !== 'number' || typeof card.lng !== 'number') {
          continue
        }
        pins.push({ name: card.name, category: cat.key, color: cat.color, lat: card.lat, lng: card.lng })
      }
    }
    return pins
  }

  private buildWeatherChip(root: SceneObject): void {
    const chip = this.kit.node(root, 'WeatherChip', 33, 20, 2)
    chip.getTransform().setLocalRotation(quat.fromEulerAngles(0, -15 * MathUtils.DegToRad, 0))
    this.kit.panel(chip, 'Glass', 0, 0, 0, 16, 4.2, { color: PANEL_RIM, tintAlpha: 0.1, edgeGlow: 1 })
    this.kit.icon(chip, 'Icon', this.iconWeather, -6, 0, 0.1, 2.2, [0.28, 0.95, 0.82])
    this.kit.text(chip, 'Temp', '18°C', -4.4, 0.65, 0.1, 0.7, WHITE, 1, 'left')
    this.kit.text(chip, 'City', 'Berlin', -4.4, -0.8, 0.1, 0.5, SOFT, 0.85, 'left')
    this.kit.panel(chip, 'Divider', 0.9, 0, 0.1, 0.12, 2.6, { color: SOFT, tintAlpha: 0.5, edgeGlow: 0.01 })
    this.kit.text(chip, 'Days', '3 days', 2.0, 0.65, 0.1, 0.7, WHITE, 1, 'left')
    this.kit.text(chip, 'Plan', 'Trip plan', 2.0, -0.8, 0.1, 0.5, SOFT, 0.85, 'left')
    this.kit.pressable(chip, 16, 4.2, 1, () => this.openCategory('Weather'))
  }

  private buildTipCard(root: SceneObject): void {
    const tip = this.kit.node(root, 'TipCard', 0, -21.5, 2)
    this.kit.panel(tip, 'Glass', 0, 0, 0, 24, 5.6, { color: [1, 0.82, 0.4], tintAlpha: 0.08, edgeGlow: 1.2, cornerRadiusCm: 1.15 })
    this.kit.icon(tip, 'Icon', this.iconTip, -10, 0, 0.1, 2.4, [1, 0.88, 0.45])
    this.kit.text(tip, 'Line1', "It's going to rain this afternoon.", -8.2, 0.8, 0.1, 0.5, WHITE, 1, 'left')
    this.kit.text(tip, 'Line2', "I've found 3 indoor options near you.", -8.2, -0.9, 0.1, 0.45, SOFT, 0.85, 'left')
    this.kit.text(tip, 'Chevron', '›', 10.8, 0.1, 0.1, 1.1, WHITE, 0.9, 'center')
    this.kit.pressable(tip, 24, 5.6, 1, () => this.openCategory('Places'))
  }

  private buildAskBar(root: SceneObject): void {
    const bar = this.kit.node(root, 'AskBar', 0, -14.5, 2)
    this.kit.panel(bar, 'Glass', 0, 0, 0, 26, 4.8, { color: [0.55, 0.5, 1], tintAlpha: 0.1, edgeGlow: 1.35 })
    this.kit.panel(bar, 'MicBadge', -10.6, 0, 0.1, 3.6, 3.6, { color: CYAN, tintAlpha: 0.18, edgeGlow: 1.2 })
    this.kit.icon(bar, 'Mic', this.iconMic, -10.6, 0, 0.15, 2.1, CYAN)
    for (let i = 0; i < WAVE_HEIGHTS.length; i++) {
      const holder = this.kit.node(bar, `Wave_${i}`, -7.6 + i * 0.55, 0, 0.1)
      this.kit.panel(holder, 'Bar', 0, 0, 0, 0.26, WAVE_HEIGHTS[i], { color: CYAN, tintAlpha: 0.9, edgeGlow: 0.01 })
      this.waveBars.push(holder)
    }
    this.askLabel = this.kit.text(bar, 'Label', 'Ask TripOptic', -1.4, 0, 0.1, 0.8, WHITE, 1, 'left')
    this.kit.pressable(bar, 26, 4.8, 1, () => this.setListening(!this.listening))
  }

  private setListening(on: boolean): void {
    this.listening = on
    if (this.askLabel) {
      this.askLabel.text = on ? 'Listening…' : 'Ask TripOptic'
    }
    if (on && !this.sessionStarted && this.geminiAssistant) {
      this.sessionStarted = true
      this.geminiAssistant.beginAssistantSessionFromContext()
    }
    if (this.asrQueryController && this.asrQueryController.getIsRecording() !== on) {
      this.asrQueryController.toggleRecording()
    }
  }

  private animateWave(): void {
    if (this.waveBars.length === 0) {
      return
    }
    const t = getTime()
    for (let i = 0; i < this.waveBars.length; i++) {
      const s = this.listening ? 0.55 + 0.75 * Math.abs(Math.sin(t * 7 + i * 0.9)) : 1
      this.waveBars[i].getTransform().setLocalScale(new vec3(1, s, 1))
    }
  }
}
