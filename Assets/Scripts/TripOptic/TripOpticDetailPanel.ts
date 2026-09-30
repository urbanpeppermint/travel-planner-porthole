import { GlassKit, Rgb } from './TripOpticGlassKit'
import { PlaceReview } from './TripOpticPlaces'

export interface DetailCardData {
  /** Google Places reviews; adds a "Reviews" dropdown button to the card. */
  reviews?: PlaceReview[]
  name: string
  price?: string
  area?: string
  details?: string
  /** Only drawn when ratingSource is 'places' (Google Places API). */
  rating?: number
  ratingCount?: string
  ratingSource?: 'places'
  photo?: Texture
  /** Shown on the photo when it came from Google Places. */
  photoAttribution?: string
  /** Wikipedia / Commons search query when Places has no photo. */
  photoQuery?: string
  /** WGS84. Plotted on the trip map when both are set. */
  lat?: number
  lng?: number
}

export interface DetailPanelData {
  key: string
  title: string
  subtitle: string
  color: Rgb
  icon: Texture
  cards: DetailCardData[]
}

export interface DetailPanelIcons {
  close: Texture
  star: Texture
  photo: Texture
}

export type PanelSide = 'left' | 'right'

const WHITE: Rgb = [1, 1, 1]
const SOFT: Rgb = [0.82, 0.86, 1]
const PANEL_RIM: Rgb = [0.5, 0.55, 1]
const CYAN: Rgb = [0.35, 0.85, 1]

const PANEL_W = 24
const PANEL_H = 27
const SIDE_X = 44
const SIDE_Y = 2.5
const SIDE_Z = 8
const SIDE_YAW = 30
const OPEN_SECONDS = 0.18

/**
 * Detail card panel: header, one large card and up to two small cards.
 * Pinch a small card to promote it; "View details" expands the large card.
 */
export class TripOpticDetailPanel {
  /** Fires with the category key when the panel closes. */
  onClosed: (key: string) => void = () => {}
  /** Fires when the header Map button is pinched. */
  onMap: () => void = () => {}

  private readonly root: SceneObject
  private content: SceneObject | null = null
  private data: DetailPanelData | null = null
  private heroIndex = 0
  private expanded = false
  private reviewsOpen = false
  private openT = 1
  private opening = false

  constructor(
    private kit: GlassKit,
    parent: SceneObject,
    private icons: DetailPanelIcons,
    private script: BaseScriptComponent,
  ) {
    this.root = kit.node(parent, 'DetailPanel', SIDE_X, SIDE_Y, SIDE_Z)
    this.root.enabled = false
    script.createEvent('UpdateEvent').bind(() => this.animate())
  }

  get openKey(): string | null {
    return this.root.enabled && this.data ? this.data.key : null
  }

  show(data: DetailPanelData, side: PanelSide): void {
    this.data = data
    this.heroIndex = 0
    this.expanded = false
    this.reviewsOpen = false
    const sign = side === 'left' ? -1 : 1
    const t = this.root.getTransform()
    t.setLocalPosition(new vec3(sign * SIDE_X, SIDE_Y, SIDE_Z))
    t.setLocalRotation(quat.fromEulerAngles(0, -sign * SIDE_YAW * MathUtils.DegToRad, 0))
    this.root.enabled = true
    this.rebuild()
    this.openT = 0
    this.opening = true
  }

  hide(): void {
    if (!this.root.enabled) {
      return
    }
    const key = this.data ? this.data.key : ''
    this.root.enabled = false
    this.onClosed(key)
  }

  /** Replace card data (e.g. when photos arrive) without resetting selection. */
  refresh(data: DetailPanelData): void {
    if (!this.data || this.data.key !== data.key) {
      return
    }
    this.data = data
    if (this.heroIndex >= data.cards.length) {
      this.heroIndex = 0
    }
    this.rebuild()
  }

  private animate(): void {
    if (!this.opening) {
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

  private rebuild(): void {
    if (this.content) {
      this.content.destroy()
      this.content = null
    }
    const data = this.data
    if (!data) {
      return
    }
    const kit = this.kit
    const c = kit.node(this.root, 'Content', 0, 0, 0)
    this.content = c
    kit.panel(c, 'Glass', 0, 0, 0, PANEL_W, PANEL_H, { color: PANEL_RIM, tintAlpha: 0.09, edgeGlow: 1.1, cornerRadiusCm: 2.2 })
    const z = 0.1
    kit.panel(c, 'HeaderBadge', -9.3, 11, z, 3.2, 3.2, { color: data.color, tintAlpha: 0.2, edgeGlow: 0.9 })
    kit.icon(c, 'HeaderIcon', data.icon, -9.3, 11, z + 0.05, 1.9, data.color)
    kit.text(c, 'Title', data.title, -7.1, 11.7, z, 1.0, WHITE, 1, 'left', true)
    kit.text(c, 'Subtitle', data.subtitle, -7.1, 10.0, z, 0.55, SOFT, 0.85, 'left')

    const close = kit.node(c, 'Close', 10, 11.2, z)
    kit.icon(close, 'Icon', this.icons.close, 0, 0, 0, 1.6, SOFT, 0.9)
    kit.pressable(close, 2.6, 2.6, 1, () => this.hide())

    if (data.cards.length === 0) {
      kit.text(c, 'Empty', 'Nothing planned here yet.', 0, 0, z, 0.6, SOFT, 0.85, 'center')
      return
    }
    const hero = data.cards[this.heroIndex]
    this.buildHero(c, hero, -3.4, -1.2, z)
    const others: number[] = []
    for (let i = 0; i < data.cards.length && others.length < 2; i++) {
      if (i !== this.heroIndex) {
        others.push(i)
      }
    }
    const slotsY = [3.83, -6.23]
    for (let s = 0; s < others.length; s++) {
      const index = others[s]
      this.buildSmall(c, data.cards[index], index, 7.3, slotsY[s], z)
    }
    if (this.reviewsOpen && hero.reviews && hero.reviews.length > 0) {
      this.buildReviews(c, hero.reviews, data.color)
    }
  }

  /** Overlay on the large card: up to three Google reviews. */
  private buildReviews(parent: SceneObject, reviews: PlaceReview[], color: Rgb): void {
    const kit = this.kit
    const shown = reviews.slice(0, 3)
    const w = 14.4
    const h = 19.5
    const box = kit.node(parent, 'Reviews', -3.4, -1.2, 0.45)
    kit.panel(box, 'Glass', 0, 0, 0, w, h, { color: PANEL_RIM, tintAlpha: 0.16, edgeGlow: 1.0, cornerRadiusCm: 1.1 })
    const left = -w * 0.5 + 0.8
    const top = h * 0.5
    kit.text(box, 'Header', 'Reviews from Google', left, top - 1.4, 0.1, 0.5, WHITE, 1, 'left')
    const close = kit.node(box, 'Collapse', w * 0.5 - 1.4, top - 1.4, 0.1)
    kit.icon(close, 'Icon', this.icons.close, 0, 0, 0, 1.2, SOFT, 0.9)
    kit.pressable(close, 2.2, 2.2, 1, () => {
      this.reviewsOpen = false
      this.rebuild()
    })
    const rowH = (h - 3.4) / shown.length
    for (let i = 0; i < shown.length; i++) {
      const r = shown[i]
      const rowTop = top - 2.8 - i * rowH
      kit.icon(box, `Star_${i}`, this.icons.star, left + 0.3, rowTop - 0.35, 0.1, 0.7, [1, 0.8, 0.3])
      const head = r.when ? `${r.rating.toFixed(0)}  ·  ${r.author}  ·  ${r.when}` : `${r.rating.toFixed(0)}  ·  ${r.author}`
      kit.text(box, `Author_${i}`, head, left + 1.0, rowTop - 0.35, 0.1, 0.38, color, 1, 'left')
      const body = kit.text(box, `Text_${i}`, r.text, left, rowTop - 1.0, 0.1, 0.36, SOFT, 0.95, 'left')
      body.horizontalOverflow = HorizontalOverflow.Wrap
      body.verticalOverflow = VerticalOverflow.Truncate
      body.verticalAlignment = VerticalAlignment.Top
      body.worldSpaceRect = Rect.create(0, w - 1.6, -(rowH - 1.6), 0)
    }
  }

  private buildHero(parent: SceneObject, card: DetailCardData, x: number, y: number, z: number): void {
    const kit = this.kit
    const h = kit.node(parent, 'HeroCard', x, y, z)
    const w = 14.4
    const left = -w * 0.5 + 0.9
    if (this.expanded && card.details) {
      kit.text(h, 'Name', card.name, left, 8.0, 0.1, 0.8, WHITE, 1, 'left', false, w - 1.8)
      const body = kit.text(h, 'Details', card.details, left, 1.2, 0.1, 0.5, SOFT, 0.95, 'left')
      body.horizontalOverflow = HorizontalOverflow.Wrap
      body.worldSpaceRect = Rect.create(0, w - 1.8, -6, 6)
      body.verticalAlignment = VerticalAlignment.Top
    } else {
      this.buildPhoto(h, card, 0, 4.6, 0.05, 13.4, 8.8, 1.8)
      kit.text(h, 'Name', card.name, left, -1.35, 0.1, 0.7, WHITE, 1, 'left', false, w - 1.8, 1)
      let rowY = -2.65
      if (this.buildRating(h, card, left, rowY, 0.1, 0.5)) {
        rowY -= 1.35
      }
      if (card.price) {
        kit.text(h, 'Price', card.price, left, rowY, 0.1, 0.55, WHITE, 1, 'left')
        rowY -= 1.25
      }
      if (card.area) {
        kit.text(h, 'Area', card.area, left, rowY, 0.1, 0.5, SOFT, 0.8, 'left', false, w - 1.8)
      }
    }
    const hasReviews = !!(card.reviews && card.reviews.length > 0)
    if (hasReviews && card.details) {
      const reviewsBtn = kit.node(h, 'ReviewsButton', -3.0, -8.2, 0.08)
      kit.card(reviewsBtn, 'Glass', 0, 0, 0, 5.4, 2.2, { color: [1, 0.8, 0.35], tintAlpha: 0.16, edgeGlow: 0.9 })
      kit.text(reviewsBtn, 'Label', this.reviewsOpen ? 'Hide' : 'Reviews', 0, 0, 0.04, 0.45, WHITE, 1, 'center')
      kit.pressable(reviewsBtn, 5.4, 2.2, 1, () => {
        this.reviewsOpen = !this.reviewsOpen
        if (this.reviewsOpen) {
          this.expanded = false
        }
        this.rebuild()
      })
      const detailsBtn = kit.node(h, 'ViewDetails', 3.0, -8.2, 0.08)
      kit.card(detailsBtn, 'Glass', 0, 0, 0, 5.4, 2.2, { color: CYAN, tintAlpha: 0.14, edgeGlow: 0.9 })
      kit.text(detailsBtn, 'Label', this.expanded ? 'Back' : 'Details', 0, 0, 0.04, 0.45, WHITE, 1, 'center')
      kit.pressable(detailsBtn, 5.4, 2.2, 1, () => {
        this.expanded = !this.expanded
        if (this.expanded) {
          this.reviewsOpen = false
        }
        this.rebuild()
      })
      return
    }
    if (hasReviews) {
      const reviewsBtn = kit.node(h, 'ReviewsButton', 0, -8.2, 0.08)
      kit.card(reviewsBtn, 'Glass', 0, 0, 0, 11.5, 2.2, { color: [1, 0.8, 0.35], tintAlpha: 0.16, edgeGlow: 0.9 })
      kit.text(reviewsBtn, 'Label', this.reviewsOpen ? 'Hide reviews' : 'Reviews', 0, 0, 0.04, 0.5, WHITE, 1, 'center')
      kit.pressable(reviewsBtn, 11.5, 2.2, 1, () => {
        this.reviewsOpen = !this.reviewsOpen
        this.rebuild()
      })
      return
    }
    if (!card.details) {
      return
    }
    const btn = kit.node(h, 'ViewDetails', 0, -8.2, 0.08)
    kit.card(btn, 'Glass', 0, 0, 0, 11.5, 2.2, { color: CYAN, tintAlpha: 0.14, edgeGlow: 0.9 })
    kit.text(btn, 'Label', this.expanded ? 'Back' : 'View details', 0, 0, 0.04, 0.55, WHITE, 1, 'center')
    kit.pressable(btn, 11.5, 2.2, 1, () => {
      this.expanded = !this.expanded
      this.rebuild()
    })
  }

  private buildSmall(parent: SceneObject, card: DetailCardData, index: number, x: number, y: number, z: number): void {
    const kit = this.kit
    const h = kit.node(parent, 'SmallCard', x, y, z)
    const photo = 6.6
    const hasReviews = !!(card.reviews && card.reviews.length > 0)
    this.buildPhoto(h, card, 0, 1.55, 0.05, photo, photo, 0.7)
    kit.text(h, 'Name', card.name, 0, -2.42, 0.1, 0.36, WHITE, 1, 'center', false, photo, 1)
    let rowY = -3.48
    if (this.buildRating(h, card, -2.4, rowY, 0.1, 0.34)) {
      rowY -= 0.95
    }
    if (card.price) {
      kit.text(h, 'Price', card.price, 0, rowY, 0.1, 0.34, SOFT, 0.9, 'center')
    }
    if (hasReviews) {
      const chip = kit.node(h, 'ReviewsChip', 0, -4.85, 0.08)
      kit.card(chip, 'Glass', 0, 0, 0, 5.4, 1.3, { color: [1, 0.8, 0.35], tintAlpha: 0.16, edgeGlow: 0.8 })
      kit.text(chip, 'Label', 'Reviews', 0, 0, 0.04, 0.34, WHITE, 1, 'center')
      kit.pressable(chip, 5.4, 1.3, 1, () => {
        this.heroIndex = index
        this.expanded = false
        this.reviewsOpen = true
        this.rebuild()
      })
    }
    kit.pressable(h, 7.2, 10.2, 1, () => {
      this.heroIndex = index
      this.expanded = false
      this.reviewsOpen = false
      this.rebuild()
    })
  }

  private buildPhoto(parent: SceneObject, card: DetailCardData, x: number, y: number, z: number, w: number, h: number, cornerCm: number = 1.6): void {
    const kit = this.kit
    if (card.photo) {
      kit.image(parent, 'Photo', card.photo, x, y, z, w, h, cornerCm)
    } else {
      kit.card(parent, 'PhotoSlot', x, y, z, w, h, { color: [0.4, 0.45, 0.9], tintAlpha: 0.22, edgeGlow: 0.3, cornerRadiusCm: cornerCm })
      kit.icon(parent, 'PhotoIcon', this.icons.photo, x, y, z + 0.05, Math.min(w, h) * 0.35, SOFT, 0.55)
    }
  }

  private buildRating(parent: SceneObject, card: DetailCardData, x: number, y: number, z: number, capCm: number): boolean {
    if (card.ratingSource !== 'places' || card.rating === undefined) {
      return false
    }
    this.kit.icon(parent, 'Star', this.icons.star, x + capCm * 0.8, y, z, capCm * 1.7, [1, 0.8, 0.3])
    const label = card.ratingCount ? `${card.rating.toFixed(1)} (${card.ratingCount})` : card.rating.toFixed(1)
    this.kit.text(parent, 'Rating', label, x + capCm * 2.0, y, z, capCm, WHITE, 1, 'left')
    return true
  }
}
