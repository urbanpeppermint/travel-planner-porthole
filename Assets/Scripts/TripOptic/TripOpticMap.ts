import { GlassKit, Rgb } from './TripOpticGlassKit'
import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable'
import { InteractableManipulation } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation'

require('LensStudio:RawLocationModule')

export interface MapPin {
  name: string
  category: string
  color: Rgb
  lat: number
  lng: number
}

interface PlacedPin extends MapPin {
  km: number
  onMap: boolean
}

interface WalkRoute {
  name: string
  color: Rgb
  seconds: number
  /** Next street on the walk, when the router provides one. */
  street: string
  stepMeters: number
  /** [lng, lat] along the walking path. */
  pts: number[][]
}

const WHITE: Rgb = [1, 1, 1]
const SOFT: Rgb = [0.82, 0.86, 1]
const PANEL_RIM: Rgb = [0.5, 0.55, 1]
const CYAN: Rgb = [0.35, 0.85, 1]
const PLACES: Rgb = [0.36, 0.62, 1]
const ROUTE_MINT: Rgb = [0.25, 0.95, 0.72]
const MAP_ORDER = 12
const MAP_TEXT = 15

const PANEL_W = 28
const PANEL_H = 26
const OPEN_SECONDS = 0.18
const CITY_KM = 8
const MIN_ZOOM = 11
const MAX_ZOOM = 16
const GRID = 3
const PLOT_X = -6.2
const PLOT_Y = -1.4
const PLOT_S = 12.2
const UA = 'TripOptic/1.0 (https://github.com; open-source Spectacles travel lens)'

/** Street paths from Hotel Le Bellevue, used when the live router is unreachable in preview. */
const SAMPLE_WALKS: { [name: string]: { seconds: number; street: string; stepMeters: number; pts: number[][] } } = {
  'Hôtel des Arts': { seconds: 4212, street: 'Allée des Refuzniks', stepMeters: 29, pts: [[2.29278,48.85799],[2.29237,48.85811],[2.29881,48.86186],[2.30125,48.86217],[2.30144,48.86407],[2.30193,48.86409],[2.30206,48.86468],[2.31043,48.86873],[2.31055,48.86911],[2.31494,48.87269],[2.31592,48.87293],[2.316,48.87401],[2.31929,48.87491],[2.32004,48.87498],[2.31981,48.87562],[2.32107,48.87612],[2.32328,48.87876],[2.32366,48.87921],[2.32687,48.8832],[2.32765,48.88331],[2.3298,48.8847],[2.33253,48.88646],[2.33657,48.8865],[2.337,48.8865]] },
  'Maison Marais': { seconds: 4676, street: 'Allée des Refuzniks', stepMeters: 29, pts: [[2.29278,48.85799],[2.29237,48.85811],[2.29623,48.86085],[2.29881,48.86186],[2.30125,48.86217],[2.30153,48.86256],[2.3039,48.8628],[2.30779,48.86297],[2.31601,48.86318],[2.31799,48.86309],[2.32958,48.85956],[2.33059,48.8606],[2.33659,48.85929],[2.34219,48.85845],[2.34562,48.85757],[2.3457,48.85771],[2.34743,48.85742],[2.348,48.85778],[2.35119,48.85746],[2.35652,48.85641],[2.3579,48.85789],[2.35842,48.85768],[2.35939,48.85827],[2.3615,48.8575]] },
  'Le Petit Bistro': { seconds: 558, street: 'Allée des Refuzniks', stepMeters: 140, pts: [[2.29278,48.85799],[2.29265,48.85792],[2.29298,48.85749],[2.29328,48.8573],[2.29379,48.85718],[2.29396,48.85709],[2.29354,48.85681],[2.29653,48.85489],[2.29657,48.85489],[2.29763,48.8556],[2.29777,48.85565],[2.29808,48.85571],[2.29844,48.85546]] },
  'Café Lumière': { seconds: 2835, street: 'Allée des Refuzniks', stepMeters: 150, pts: [[2.29278,48.85799],[2.29265,48.85792],[2.29406,48.85703],[2.29677,48.85887],[2.29884,48.85755],[2.29985,48.85771],[2.30039,48.85779],[2.3022,48.85845],[2.30226,48.85837],[2.30347,48.85868],[2.30811,48.85972],[2.31127,48.85991],[2.31327,48.8598],[2.31338,48.85988],[2.31801,48.85979],[2.31945,48.85937],[2.31951,48.85944],[2.32348,48.85792],[2.32459,48.85715],[2.32588,48.8562],[2.32768,48.85537],[2.3304,48.85458],[2.33346,48.8539],[2.3335,48.854]] },
  'Marché Saint-Germain': { seconds: 2973, street: 'Allée des Refuzniks', stepMeters: 150, pts: [[2.29278,48.85799],[2.29265,48.85792],[2.29406,48.85703],[2.29677,48.85887],[2.29884,48.85755],[2.29999,48.85783],[2.30039,48.85779],[2.3022,48.85845],[2.30226,48.85837],[2.30435,48.85902],[2.30811,48.85972],[2.31127,48.85991],[2.31338,48.85988],[2.31642,48.85991],[2.31801,48.85979],[2.31951,48.85944],[2.32348,48.85792],[2.32375,48.85805],[2.32459,48.85715],[2.32768,48.85537],[2.3304,48.85458],[2.33346,48.8539],[2.33365,48.8536],[2.3354,48.8532]] },
  'Musée d’Orsay': { seconds: 2460, street: 'Allée des Refuzniks', stepMeters: 29, pts: [[2.29278,48.85799],[2.29265,48.85792],[2.29237,48.85811],[2.29582,48.86058],[2.29696,48.86123],[2.29881,48.86186],[2.30032,48.86212],[2.30125,48.86217],[2.30127,48.86246],[2.30153,48.86256],[2.3021,48.86262],[2.3031,48.86252],[2.3039,48.8628],[2.31521,48.86317],[2.31799,48.86309],[2.32561,48.86082],[2.32554,48.86071],[2.32569,48.86061],[2.32791,48.85987],[2.32676,48.86022]] },
  'Louvre': { seconds: 3117, street: 'Allée des Refuzniks', stepMeters: 29, pts: [[2.29278,48.85799],[2.29237,48.85811],[2.29696,48.86123],[2.29881,48.86186],[2.30125,48.86217],[2.30153,48.86256],[2.3031,48.86252],[2.3039,48.8628],[2.31799,48.86309],[2.32958,48.85956],[2.33077,48.86074],[2.33308,48.86027],[2.33369,48.86106],[2.33719,48.86017],[2.33738,48.86064],[2.33759,48.86059]] },
  'Sainte-Chapelle': { seconds: 3633, street: 'Allée des Refuzniks', stepMeters: 29, pts: [[2.29278,48.85799],[2.29237,48.85811],[2.29623,48.86085],[2.29881,48.86186],[2.30125,48.86217],[2.30153,48.86256],[2.3031,48.86252],[2.3039,48.8628],[2.30779,48.86297],[2.31799,48.86309],[2.3325,48.85867],[2.33814,48.85756],[2.34417,48.85392],[2.34556,48.85515]] },
  'Train ICE + TGV': { seconds: 4897, street: 'Allée des Refuzniks', stepMeters: 29, pts: [[2.29278,48.85799],[2.29237,48.85811],[2.29881,48.86186],[2.30125,48.86217],[2.30156,48.86281],[2.30193,48.86409],[2.30198,48.86463],[2.30984,48.86874],[2.31055,48.86911],[2.31318,48.87037],[2.31486,48.87258],[2.32064,48.87345],[2.32821,48.873],[2.3288,48.87296],[2.33119,48.87276],[2.33175,48.87303],[2.33311,48.8732],[2.33372,48.87313],[2.34968,48.8773],[2.35588,48.87671],[2.3573,48.87637],[2.3583,48.87654],[2.35913,48.87685],[2.359,48.8767]] },
}

/**
 * Street map of the day's spots. Each category gets its own walking route.
 * Start follows one route the way a navigation preview does: "in 489 m" plus that path.
 */
export class TripOpticMap {
  private readonly root: SceneObject
  private content: SceneObject | null = null
  private shown = false
  private pins: MapPin[] = []
  private guiding: string | null = null
  private loadId = 0

  private mapTex: Texture | null = null
  private mapLocation: LocationAsset | null = null
  private mosaicKey = ''
  private mapModule: MapModule | null = null
  private routes: WalkRoute[] = []
  private routesFrom = ''
  private routeCacheKey = ''
  private routeLoadId = 0
  private openT = 1
  private opening = false
  private gps: { lat: number; lng: number } | null = null
  private lastGpsKey = ''

  constructor(
    private kit: GlassKit,
    parent: SceneObject,
    private internet: InternetModule,
    private media: RemoteMediaModule,
    private icons: { close: Texture; pin: Texture },
    script: BaseScriptComponent,
    mapModule?: MapModule,
  ) {
    try {
      this.mapModule = mapModule || (require('LensStudio:MapModule') as MapModule)
    } catch (e) {
      print(`[TripOpticMap] MapModule: ${e}`)
    }
    this.root = kit.node(parent, 'TripMap', 0, 0.2, 8)
    this.root.enabled = false
    this.makeDraggable()
    script.createEvent('UpdateEvent').bind(() => this.animate())
    this.startLocation(script)
  }

  private makeDraggable(): void {
    const collider = this.root.createComponent('Physics.ColliderComponent') as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(PANEL_W, PANEL_H, 2.4)
    collider.shape = shape
    const inter = this.root.createComponent(Interactable.getTypeName()) as Interactable
    inter.targetingMode = 3
    const manip = this.root.createComponent(InteractableManipulation.getTypeName()) as InteractableManipulation
    manip.setCanTranslate(true)
    manip.setCanRotate(false)
    manip.setCanScale(false)
  }

  get isOpen(): boolean {
    return this.shown
  }

  toggle(pins: MapPin[]): void {
    if (this.shown) {
      this.hide()
      return
    }
    this.show(pins)
  }

  show(pins: MapPin[]): void {
    this.shown = true
    this.root.enabled = true
    this.pins = pins
    this.guiding = null
    this.openT = 0
    this.opening = true
    this.rebuild()
  }

  hide(): void {
    this.shown = false
    this.guiding = null
    this.root.enabled = false
  }

  refresh(pins: MapPin[]): void {
    this.pins = pins
    if (this.shown) {
      this.rebuild()
    }
  }

  private animate(): void {
    if (!this.opening || !this.shown) {
      return
    }
    this.openT = Math.min(1, this.openT + getDeltaTime() / OPEN_SECONDS)
    const e = 1 - Math.pow(1 - this.openT, 3)
    const s = 0.88 + 0.12 * e
    this.root.getTransform().setLocalScale(new vec3(s, s, s))
    if (this.openT >= 1) {
      this.opening = false
    }
  }

  private raise(so: SceneObject): void {
    const vis = so.getComponent('Component.RenderMeshVisual') as RenderMeshVisual
    if (vis) {
      vis.setRenderOrder(MAP_ORDER + 1)
    }
    for (let i = 0; i < so.getChildrenCount(); i++) {
      this.raise(so.getChild(i))
    }
  }

  private rebuild(): void {
    if (this.content) {
      this.content.destroy()
      this.content = null
    }
    const pins = this.pins
    const kit = this.kit
    const c = kit.node(this.root, 'Content', 0, 0, 0)
    this.content = c
    kit.panel(
      c,
      'Glass',
      0,
      0,
      0,
      PANEL_W,
      PANEL_H,
      { color: [0.36, 0.4, 0.92], tintAlpha: 0.28, bodyAlpha: 0.5, rimAlpha: 0.85, edgeGlow: 0.9, cornerRadiusCm: 1.8 },
      MAP_ORDER,
    )
    const z = 0.12
    const stay = this.stayAnchor(pins)
    const origin = this.routeOrigin(pins)
    const guide = this.guidePin(pins)
    const headY = 11.2
    const badge = kit.panel(c, 'HeaderBadge', -11.2, headY, z, 3.2, 3.2, { color: PLACES, tintAlpha: 0.22, bodyAlpha: 0.28, edgeGlow: 0.9, cornerRadiusCm: 0.8 }, MAP_ORDER + 1)
    this.raise(badge)
    const pin = kit.icon(c, 'HeaderIcon', this.icons.pin, -11.2, headY, z + 0.05, 1.9, WHITE)
    this.raise(pin)
    if (guide) {
      const step = this.stepFor(guide.name)
      const dist =
        step > 0
          ? step / 1000
          : origin
            ? this.kmBetween(origin.lat, origin.lng, guide.lat, guide.lng)
            : 0
      const street = this.streetFor(guide.name)
      kit.text(c, 'Title', `in ${this.formatKm(dist)}`, -9.0, headY + 0.7, z, 1.0, WHITE, 1, 'left', true, 14, 1, MAP_TEXT)
      kit.text(c, 'Hint', street ? `${street} · ${guide.name}` : guide.name, -9.0, headY - 0.85, z, 0.48, SOFT, 0.9, 'left', false, 14, 1, MAP_TEXT)
    } else {
      kit.text(c, 'Title', 'Map', -9.0, headY + 0.7, z, 1.0, WHITE, 1, 'left', true, undefined, 1, MAP_TEXT)
      const hint = !stay
        ? 'Add a stay to start a route'
        : this.usingGps()
          ? 'From you · tap a place'
          : `From ${stay.name} · tap a place`
      kit.text(c, 'Hint', hint, -9.0, headY - 0.85, z, 0.48, SOFT, 0.9, 'left', false, 16, 1, MAP_TEXT)
    }
    const close = kit.node(c, 'Close', 11.6, headY, z)
    const closeIcon = kit.icon(close, 'Icon', this.icons.close, 0, 0, 0, 1.6, SOFT, 0.9)
    this.raise(closeIcon)
    kit.pressable(close, 2.6, 2.6, 1, () => this.hide())

    const frame = kit.panel(c, 'Plot', PLOT_X, PLOT_Y, z, 13.2, 13.2, { color: PANEL_RIM, tintAlpha: 0.16, bodyAlpha: 0.22, edgeGlow: 0.7, cornerRadiusCm: 1.1 }, MAP_ORDER + 1)
    this.raise(frame)
    if (this.mapTex) {
      this.drawMap(c, z)
      this.drawRouteOverlay(c, z)
    } else {
      kit.text(c, 'Loading', 'Loading map…', PLOT_X, PLOT_Y, z + 0.05, 0.48, SOFT, 0.9, 'center', false, undefined, 1, MAP_TEXT)
    }
    kit.text(c, 'Credit', 'Snap Map', PLOT_X, -7.15, z + 0.08, 0.28, SOFT, 0.75, 'center', false, undefined, 1, MAP_TEXT)

    const listCard = kit.panel(c, 'ListCard', 6.5, -0.8, z, 12.6, 17.2, { color: [0.38, 0.42, 0.9], tintAlpha: 0.42, bodyAlpha: 0.62, edgeGlow: 0.75, cornerRadiusCm: 1.1 }, MAP_ORDER + 1)
    this.raise(listCard)
    const placed = this.withDistance(pins, origin)
    this.drawList(c, placed, stay, origin, z)
    const active = guide || this.nearestOther(placed, origin)
    if (active) {
      const start = kit.node(c, 'Start', 6.6, -11.0, z)
      const glass = kit.card(start, 'Glass', 0, 0, 0, 11.2, 2.2, { color: guide ? PLACES : CYAN, tintAlpha: 0.22, bodyAlpha: 0.3, edgeGlow: 0.9 })
      this.raise(glass)
      const eta = this.minutesFor(active.name)
      const label = guide ? 'End trip' : eta ? `Start · ${eta} min` : 'Start'
      kit.text(start, 'Label', label, 0, 0, 0.06, 0.5, WHITE, 1, 'center', false, 10, 1, MAP_TEXT)
      kit.pressable(start, 11.2, 2.2, 1, () => {
        this.guiding = this.guiding ? null : active.name
        this.rebuild()
      })
    }
    this.ensureMap(stay, origin, placed)
  }

  private ensureMap(stay: MapPin | null, origin: MapPin | null, placed: PlacedPin[]): void {
    if (!stay) {
      return
    }
    const view = this.fitView(stay, origin, placed)
    const key = `${view.lat.toFixed(4)},${view.lng.toFixed(4)}|z${view.zoom}|${this.guiding || '*'}`
    if (!this.mapTex || this.mosaicKey !== key) {
      const id = ++this.loadId
      this.fetchMap(view, key, id)
    }
    if (origin) {
      const targets = placed.filter((p) => p.onMap && p.name !== origin.name)
      this.ensureRoutes(origin, targets)
    }
  }

  private fetchMap(view: { lat: number; lng: number; zoom: number }, key: string, id: number): void {
    if (!this.mapModule) {
      print('[TripOpticMap] MapModule missing — add a Map Module asset (Resources > + > Map Module)')
      return
    }
    try {
      const zoomOffset = this.snapZoomOffset(view.zoom)
      const location = LocationAsset.getGeoAnchoredPosition(view.lng, view.lat).location.adjacentTile(0, 0, zoomOffset)
      const tex = this.mapModule.createMapTextureProvider()
      const provider = tex.control as MapTextureProvider
      provider.onReady.add(() => {
        if (id !== this.loadId || !this.shown) {
          return
        }
        this.mapTex = tex
        this.mapLocation = location
        this.mosaicKey = key
        this.rebuild()
      })
      provider.onFailed.add(() => print('[TripOpticMap] Snap map tile failed to download'))
      provider.location = location
    } catch (e) {
      print(`[TripOpticMap] Snap map: ${e}`)
    }
  }

  /** Snap map tiles: negative offset zooms out from the GPS tile (Lens example uses -3). */
  private snapZoomOffset(zoom: number): number {
    if (zoom >= 15) {
      return -2
    }
    if (zoom >= 13) {
      return -3
    }
    if (zoom >= 12) {
      return -4
    }
    return -5
  }

  private ensureRoutes(origin: MapPin, targets: PlacedPin[]): void {
    const originBit = `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}`
    const focus = this.guiding || '*'
    const key = `${originBit}|${focus}`
    if (this.routeCacheKey === key) {
      return
    }
    const haveFromHere = this.routesFrom === originBit && this.routes.length > 0
    const haveFocus = !this.guiding || this.routes.some((r) => r.name === this.guiding)
    if (haveFromHere && haveFocus) {
      this.routeCacheKey = key
      return
    }
    const dests = this.guiding ? targets.filter((p) => p.name === this.guiding) : targets
    if (dests.length === 0) {
      return
    }
    const id = ++this.routeLoadId
    this.routeCacheKey = key
    this.fetchRoutes(origin, dests)
      .then((routes) => {
        if (id !== this.routeLoadId || !this.shown) {
          return
        }
        this.routesFrom = originBit
        this.routes = haveFromHere && this.guiding ? this.mergeRoutes(this.routes, routes) : routes
        this.rebuild()
      })
      .catch((e) => print(`[TripOpticMap] routes: ${e}`))
  }

  private mergeRoutes(prev: WalkRoute[], next: WalkRoute[]): WalkRoute[] {
    const out = prev.slice()
    for (let i = 0; i < next.length; i++) {
      let found = false
      for (let j = 0; j < out.length; j++) {
        if (out[j].name === next[i].name) {
          out[j] = next[i]
          found = true
          break
        }
      }
      if (!found) {
        out.push(next[i])
      }
    }
    return out
  }

  private async fetchRoutes(origin: MapPin, targets: PlacedPin[]): Promise<WalkRoute[]> {
    const routes: WalkRoute[] = []
    for (let i = 0; i < targets.length; i++) {
      const pin = targets[i]
      try {
        const url =
          `https://routing.openstreetmap.de/routed-foot/route/v1/foot/` +
          `${origin.lng},${origin.lat};${pin.lng},${pin.lat}?overview=simplified&steps=true&geometries=geojson`
        const response = await this.internet.fetch(url, { method: 'GET', headers: { 'User-Agent': UA } })
        if (response.status !== 200) {
          throw new Error(`osrm ${response.status}`)
        }
        const json = await response.json()
        const route = json && json.routes && json.routes[0]
        const coords: number[][] = route && route.geometry && route.geometry.coordinates ? route.geometry.coordinates : []
        if (coords.length < 2) {
          throw new Error('empty route')
        }
        const steps: any[] = route.legs && route.legs[0] && route.legs[0].steps ? route.legs[0].steps : []
        const step = steps.length > 0 ? steps[0] : null
        routes.push({
          name: pin.name,
          color: pin.color,
          seconds: route.duration || 0,
          street: step && step.name ? step.name : '',
          stepMeters: step && typeof step.distance === 'number' ? step.distance : 0,
          pts: coords,
        })
      } catch (e) {
        print(`[TripOpticMap] route ${pin.name}: ${e}`)
        const stay = this.stayAnchor(this.pins)
        const fromStay = stay && Math.abs(stay.lat - origin.lat) < 0.0002 && Math.abs(stay.lng - origin.lng) < 0.0002
        const sample = fromStay ? SAMPLE_WALKS[pin.name] : null
        routes.push({
          name: pin.name,
          color: pin.color,
          seconds: sample ? sample.seconds : 0,
          street: sample ? sample.street : '',
          stepMeters: sample ? sample.stepMeters : this.kmBetween(origin.lat, origin.lng, pin.lat, pin.lng) * 1000,
          pts: sample
            ? sample.pts
            : [
                [origin.lng, origin.lat],
                [pin.lng, pin.lat],
              ],
        })
      }
    }
    return routes
  }

  private drawMap(parent: SceneObject, z: number): void {
    if (!this.mapTex) {
      return
    }
    const so = this.kit.image(parent, 'StreetMap', this.mapTex, PLOT_X, PLOT_Y, z + 0.04, PLOT_S, PLOT_S, 0.08)
    const vis = so.getComponent('Component.RenderMeshVisual') as RenderMeshVisual
    vis.setRenderOrder(MAP_ORDER + 1)
  }

  private drawRouteOverlay(parent: SceneObject, z: number): void {
    const origin = this.routeOrigin(this.pins)
    const active = this.guiding
    const depth = z + 0.07
    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i]
      if (active && route.name !== active) {
        continue
      }
      const color = active ? ROUTE_MINT : route.color
      const thick = active ? 0.28 : 0.16
      const pts = route.pts
      for (let p = 1; p < pts.length; p++) {
        const a = this.plotPos(pts[p - 1][0], pts[p - 1][1])
        const b = this.plotPos(pts[p][0], pts[p][1])
        if (!a || !b) {
          continue
        }
        this.kit.line(parent, `R_${i}_${p}`, a.x, a.y, b.x, b.y, depth, thick, color, 1)
      }
    }
    const pins = this.withDistance(this.pins, origin)
    for (let i = 0; i < pins.length; i++) {
      if (!pins[i].onMap) {
        continue
      }
      const at = this.plotPos(pins[i].lng, pins[i].lat)
      if (!at) {
        continue
      }
      const picked = !!active && pins[i].name === active
      const size = picked ? 0.72 : 0.5
      this.kit.panel(parent, `Pin_${i}`, at.x, at.y, depth + 0.02, size, size, {
        color: picked ? ROUTE_MINT : pins[i].color,
        tintAlpha: 0.95,
        edgeGlow: 0.8,
        cornerRadiusCm: size * 0.5,
      }, MAP_ORDER + 2)
    }
    if (origin && this.usingGps()) {
      const here = this.plotPos(origin.lng, origin.lat)
      if (here) {
        this.kit.panel(parent, 'You', here.x, here.y, depth + 0.03, 0.7, 0.7, {
          color: CYAN,
          tintAlpha: 0.95,
          edgeGlow: 1.1,
          cornerRadiusCm: 0.35,
        }, MAP_ORDER + 2)
      }
    }
  }

  private plotPos(lng: number, lat: number): { x: number; y: number } | null {
    if (!this.mapModule || !this.mapLocation) {
      return null
    }
    const uv = this.mapModule.longLatToImageRatio(lng, lat, this.mapLocation)
    const u = uv.x
    const v = uv.y
    if (u < -0.08 || v < -0.08 || u > 1.08 || v > 1.08) {
      return null
    }
    return {
      x: PLOT_X + (u - 0.5) * PLOT_S,
      y: PLOT_Y + (0.5 - v) * PLOT_S,
    }
  }

  private drawList(parent: SceneObject, pins: PlacedPin[], stay: MapPin | null, origin: MapPin | null, z: number): void {
    const kit = this.kit
    const sorted = pins.slice().sort((a, b) => a.km - b.km)
    const title = this.guiding ? 'This trip' : this.usingGps() ? 'From you' : 'From your stay'
    kit.text(parent, 'ListTitle', title, 2.0, 8.4, z, 0.48, SOFT, 0.9, 'left', false, undefined, 1, MAP_TEXT)
    const maxRows = 9
    let row = 0
    for (let i = 0; i < sorted.length && row < maxRows; i++) {
      const p = sorted[i]
      const y = 6.95 - row * 1.52
      row++
      const picked = this.guiding === p.name
      const isStay = !!stay && p.name === stay.name
      const isOrigin = !!origin && p.name === origin.name
      const hit = kit.node(parent, `Pick_${i}`, 6.5, y, z)
      if (picked) {
        kit.panel(hit, 'Sel', 0, 0, -0.02, 12.0, 1.4, { color: ROUTE_MINT, tintAlpha: 0.18, bodyAlpha: 0.16, cornerRadiusCm: 0.35 }, MAP_ORDER + 2)
      }
      const swatch = picked ? ROUTE_MINT : p.color
      kit.panel(hit, `Swatch`, -4.55, 0, 0.02, 0.7, 0.7, { color: swatch, tintAlpha: 0.95, edgeGlow: 0.15, cornerRadiusCm: 0.2 }, MAP_ORDER + 2)
      const name = p.name.length > 14 ? `${p.name.substring(0, 13)}…` : p.name
      const dist = !p.onMap
        ? `${this.formatKm(p.km)} off`
        : isOrigin && this.usingGps()
          ? 'here'
          : isStay && !this.usingGps()
            ? 'stay'
            : this.formatKm(p.km)
      const mins = this.minutesFor(p.name)
      const extra = mins && !isOrigin ? ` · ${mins} min` : ''
      kit.text(hit, `Row`, name, -3.85, 0.04, 0.02, 0.4, WHITE, 1, 'left', false, 5.8, 1, MAP_TEXT)
      kit.text(hit, `Meta`, `${dist}${extra}`, 5.45, -0.02, 0.02, 0.3, SOFT, 0.9, 'right', false, 3.3, 1, MAP_TEXT)
      if (!isOrigin) {
        kit.pressable(hit, 12.0, 1.4, 1, () => this.pick(p.name))
      }
    }
  }

  private pick(name: string): void {
    this.guiding = name
    this.rebuild()
  }

  private streetFor(name: string): string {
    for (let i = 0; i < this.routes.length; i++) {
      if (this.routes[i].name === name) {
        return this.routes[i].street
      }
    }
    return ''
  }

  private stepFor(name: string): number {
    for (let i = 0; i < this.routes.length; i++) {
      if (this.routes[i].name === name) {
        return this.routes[i].stepMeters
      }
    }
    return 0
  }

  private minutesFor(name: string): number {
    for (let i = 0; i < this.routes.length; i++) {
      if (this.routes[i].name === name && this.routes[i].seconds > 0) {
        return Math.max(1, Math.round(this.routes[i].seconds / 60))
      }
    }
    return 0
  }

  private guidePin(pins: MapPin[]): MapPin | null {
    if (!this.guiding) {
      return null
    }
    for (let i = 0; i < pins.length; i++) {
      if (pins[i].name === this.guiding) {
        return pins[i]
      }
    }
    return null
  }

  private nearestOther(pins: PlacedPin[], origin: MapPin | null): PlacedPin | null {
    let best: PlacedPin | null = null
    for (let i = 0; i < pins.length; i++) {
      if (origin && pins[i].name === origin.name) {
        continue
      }
      if (!pins[i].onMap) {
        continue
      }
      if (!best || pins[i].km < best.km) {
        best = pins[i]
      }
    }
    return best
  }

  private stayAnchor(pins: MapPin[]): MapPin | null {
    for (let i = 0; i < pins.length; i++) {
      if (pins[i].category === 'Stay') {
        return pins[i]
      }
    }
    return pins.length > 0 ? pins[0] : null
  }

  private usingGps(): boolean {
    return !!this.gps && this.inCity(this.pins, this.gps)
  }

  private routeOrigin(pins: MapPin[]): MapPin | null {
    const stay = this.stayAnchor(pins)
    if (this.gps && this.inCity(pins, this.gps)) {
      return { name: 'You', category: 'Here', color: CYAN, lat: this.gps.lat, lng: this.gps.lng }
    }
    return stay
  }

  private inCity(pins: MapPin[], at: { lat: number; lng: number }): boolean {
    const stay = this.stayAnchor(pins)
    if (stay && this.kmBetween(at.lat, at.lng, stay.lat, stay.lng) <= CITY_KM) {
      return true
    }
    for (let i = 0; i < pins.length; i++) {
      if (this.kmBetween(at.lat, at.lng, pins[i].lat, pins[i].lng) <= CITY_KM) {
        return true
      }
    }
    return false
  }

  private startLocation(script: BaseScriptComponent): void {
    try {
      const service = GeoLocation.createLocationService()
      service.accuracy = GeoLocationAccuracy.Navigation
      const tick = script.createEvent('DelayedCallbackEvent')
      tick.bind(() => {
        service.getCurrentPosition(
          (pos) => {
            this.onGps(pos.latitude, pos.longitude)
            tick.reset(2.5)
          },
          (err) => {
            print(`[TripOpticMap] gps: ${err}`)
            tick.reset(5)
          },
        )
      })
      tick.reset(0.3)
    } catch (e) {
      print(`[TripOpticMap] location: ${e}`)
    }
  }

  private onGps(lat: number, lng: number): void {
    const wasGps = this.usingGps()
    this.gps = { lat, lng }
    const nowGps = this.usingGps()
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`
    if (!this.shown) {
      this.lastGpsKey = key
      return
    }
    if (nowGps !== wasGps) {
      this.routeCacheKey = ''
      this.routesFrom = ''
      this.lastGpsKey = key
      this.rebuild()
      return
    }
    if (nowGps && this.guiding && this.lastGpsKey !== key) {
      this.lastGpsKey = key
      this.routeCacheKey = ''
      this.routesFrom = ''
      this.rebuild()
      return
    }
    this.lastGpsKey = key
  }

  private withDistance(pins: MapPin[], origin: MapPin | null): PlacedPin[] {
    const stay = this.stayAnchor(pins)
    const out: PlacedPin[] = []
    for (let i = 0; i < pins.length; i++) {
      const km = origin ? this.kmBetween(origin.lat, origin.lng, pins[i].lat, pins[i].lng) : 0
      const mapKm = stay ? this.kmBetween(stay.lat, stay.lng, pins[i].lat, pins[i].lng) : km
      out.push({ ...pins[i], km, onMap: !stay || mapKm <= CITY_KM })
    }
    return out
  }

  private formatKm(km: number): string {
    if (km < 1) {
      return `${Math.max(1, Math.round(km * 1000))} m`
    }
    return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
  }

  private kmBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const r = 6371
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLng = ((lng2 - lng1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)))
  }

  /** Center and zoom so every shown path (or the picked one) fits in the 3×3 mosaic. */
  private fitView(stay: MapPin, origin: MapPin | null, placed: PlacedPin[]): { lat: number; lng: number; zoom: number } {
    const pts: { lat: number; lng: number }[] = [{ lat: stay.lat, lng: stay.lng }]
    if (origin) {
      pts.push({ lat: origin.lat, lng: origin.lng })
    }
    if (this.guiding) {
      for (let i = 0; i < placed.length; i++) {
        if (placed[i].name === this.guiding) {
          pts.push({ lat: placed[i].lat, lng: placed[i].lng })
        }
      }
      for (let i = 0; i < this.routes.length; i++) {
        if (this.routes[i].name !== this.guiding) {
          continue
        }
        const path = this.routes[i].pts
        for (let p = 0; p < path.length; p++) {
          pts.push({ lat: path[p][1], lng: path[p][0] })
        }
      }
    } else {
      for (let i = 0; i < placed.length; i++) {
        if (placed[i].onMap) {
          pts.push({ lat: placed[i].lat, lng: placed[i].lng })
        }
      }
      for (let i = 0; i < this.routes.length; i++) {
        const path = this.routes[i].pts
        for (let p = 0; p < path.length; p++) {
          pts.push({ lat: path[p][1], lng: path[p][0] })
        }
      }
    }
    let minLat = pts[0].lat
    let maxLat = pts[0].lat
    let minLng = pts[0].lng
    let maxLng = pts[0].lng
    for (let i = 1; i < pts.length; i++) {
      minLat = Math.min(minLat, pts[i].lat)
      maxLat = Math.max(maxLat, pts[i].lat)
      minLng = Math.min(minLng, pts[i].lng)
      maxLng = Math.max(maxLng, pts[i].lng)
    }
    const padLat = Math.max(0.0025, (maxLat - minLat) * 0.2)
    const padLng = Math.max(0.0025, (maxLng - minLng) * 0.2)
    minLat -= padLat
    maxLat += padLat
    minLng -= padLng
    maxLng += padLng
    const lat = (minLat + maxLat) * 0.5
    const lng = (minLng + maxLng) * 0.5
    let zoom = MIN_ZOOM
    for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
      const dx = Math.abs(this.lonToTileXf(maxLng, z) - this.lonToTileXf(minLng, z))
      const dy = Math.abs(this.latToTileYf(minLat, z) - this.latToTileYf(maxLat, z))
      if (dx <= GRID * 0.72 && dy <= GRID * 0.72) {
        zoom = z
        break
      }
      zoom = z
    }
    return { lat, lng, zoom }
  }

  private lonToTileXf(lng: number, zoom: number): number {
    return ((lng + 180) / 360) * Math.pow(2, zoom)
  }

  private latToTileYf(lat: number, zoom: number): number {
    const r = (lat * Math.PI) / 180
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, zoom)
  }

  private lonToTileX(lng: number, zoom: number): number {
    return Math.floor(this.lonToTileXf(lng, zoom))
  }

  private latToTileY(lat: number, zoom: number): number {
    return Math.floor(this.latToTileYf(lat, zoom))
  }
}
