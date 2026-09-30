/**
 * Runtime builders for the TripOptic glass look: 3D pill meshes, flat glass
 * panels with a neon edge, icons, world-space text and glow lines.
 *
 * Portable to the Lens Studio 5.15 project: uses only MeshBuilder, Text,
 * RenderMeshVisual and material clones. No SIK or UI Kit.
 *
 * Glass material parameters (TripOptic_Glass): tint, rimColor, rimPower,
 * edgeGlow, aspect, cornerRadius, edgeWidth.
 * Icon material parameters (TripOptic_Icon / image_unlit): baseTex, baseColor.
 */

import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable'

export type Rgb = [number, number, number]

export type TextAlign = 'left' | 'center' | 'right'

export interface GlassStyle {
  color: Rgb
  tintAlpha?: number
  rimAlpha?: number
  /** Fill opacity. When set, skips the default glassy body cap. */
  bodyAlpha?: number
  edgeGlow?: number
  cornerRadiusCm?: number
  edgeWidthCm?: number
  rimPower?: number
}

/** Match 5.24 `Text.size = capCm * 100`. Overflow keeps glyphs from stacking. */
const TEXT_SIZE_PER_CM = 100

/** Width of the text layout box; text is anchored to one edge of it. */
const TEXT_RECT_SPAN_CM = 60

const HOVER_SCALE = 1.06

const ORDER_LINE = 0
const ORDER_GLASS = 1
const ORDER_CARD = 2
const ORDER_CONTENT = 4

/** Extra mesh size so the shader can bloom outside the visual rounded-rect. */
const GLOW_MESH = 1.18

export class GlassKit {
  private quadMesh: RenderMesh | null = null
  private discMesh: RenderMesh | null = null
  private pillMeshes: { [key: string]: RenderMesh } = {}
  private roundMeshes: { [key: string]: RenderMesh } = {}
  private ringMeshes: { [key: string]: RenderMesh } = {}
  private glassMaterial: Material
  private iconMaterial: Material
  private photoMaterial: Material | null
  private titleFont: Font | null
  private bodyFont: Font | null

  constructor(
    glassMaterial: Material,
    iconMaterial: Material,
    titleFont: Font | null,
    photoMaterial: Material | null = null,
  ) {
    this.glassMaterial = this.usable(glassMaterial, '../../Material and shaders/TripOptic_Glass/TripOptic_Glass.mat', 'glass')
    this.iconMaterial = this.usable(iconMaterial, '../../ImageMaterial.mat', 'icon')
    this.photoMaterial = photoMaterial && this.hasPass(photoMaterial) ? photoMaterial : this.iconMaterial
    this.titleFont = titleFont || this.loadFont('../../Fonts/Michroma.ttf')
    this.bodyFont = this.loadFont('../../Fonts/Roboto-Medium.ttf')
  }

  node(parent: SceneObject, name: string, x: number, y: number, z: number, yawDeg: number = 0): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    const t = so.getTransform()
    t.setLocalPosition(new vec3(x, y, z))
    if (yawDeg !== 0) {
      t.setLocalRotation(quat.fromEulerAngles(0, yawDeg * MathUtils.DegToRad, 0))
    }
    return so
  }

  /** Flat rounded-rect glass panel, w × h cm, facing +Z. Neon edge lives in the shader. */
  panel(parent: SceneObject, name: string, x: number, y: number, z: number, w: number, h: number, style: GlassStyle, order: number = ORDER_GLASS): SceneObject {
    const so = this.node(parent, name, x, y, z)
    const glow = (style.edgeGlow !== undefined ? style.edgeGlow : 1.75) > 0.04
    const pad = glow ? GLOW_MESH : 1
    so.getTransform().setLocalScale(new vec3(w * pad, h * pad, 1))
    const halfH = h * 0.5
    const radius = style.cornerRadiusCm !== undefined ? style.cornerRadiusCm : halfH
    const edgeWidth = style.edgeWidthCm !== undefined ? style.edgeWidthCm : 0.72
    const mat = this.glass(style)
    const pass = this.pass(mat)
    if (pass) {
      pass.edgeGlow = style.edgeGlow !== undefined ? style.edgeGlow : 1.75
      pass.aspect = w / h
      pass.cornerRadius = Math.min(1, radius / halfH)
      pass.edgeWidth = edgeWidth / halfH
    }
    this.visual(so, this.getQuad(), mat, order)
    return so
  }

  /** Colored annulus. `outerRadius` and `thickness` are in cm. */
  ring(parent: SceneObject, name: string, x: number, y: number, z: number, outerRadius: number, thickness: number, style: GlassStyle, order: number = ORDER_GLASS): SceneObject {
    const so = this.node(parent, name, x, y, z)
    this.visual(so, this.getRing(Math.max(0.05, outerRadius - thickness), outerRadius), this.glass(style), order)
    return so
  }

  /** Card-level panel: drawn after the panel it sits on. */
  card(parent: SceneObject, name: string, x: number, y: number, z: number, w: number, h: number, style: GlassStyle): SceneObject {
    return this.panel(parent, name, x, y, z, w, h, style, ORDER_CARD)
  }

  /** 3D pill (capsule) mesh, w × h × d cm, lit by the Fresnel rim. */
  pill(parent: SceneObject, name: string, x: number, y: number, z: number, w: number, h: number, d: number, style: GlassStyle): SceneObject {
    const so = this.node(parent, name, x, y, z)
    const mat = this.glass(style)
    const pass = this.pass(mat)
    if (pass) {
      pass.edgeGlow = 0
    }
    this.visual(so, this.getPill(w, h, d), mat, ORDER_GLASS)
    return so
  }

  sphere(parent: SceneObject, name: string, x: number, y: number, z: number, radius: number, style: GlassStyle): SceneObject {
    return this.pill(parent, name, x, y, z, radius * 2, radius * 2, radius * 2, style)
  }

  icon(parent: SceneObject, name: string, tex: Texture | null, x: number, y: number, z: number, sizeCm: number, color: Rgb, alpha: number = 1): SceneObject {
    const so = this.node(parent, name, x, y, z)
    so.getTransform().setLocalScale(new vec3(sizeCm, sizeCm, 1))
    const mat = this.iconMaterial.clone()
    const pass = this.pass(mat)
    if (pass) {
      if (tex) {
        pass.baseTex = tex
      }
      pass.baseColor = new vec4(color[0], color[1], color[2], alpha)
    }
    this.visual(so, this.getQuad(), mat, ORDER_CONTENT)
    return so
  }

  /**
   * Photo quad, w × h cm, center-cropped to fill the slot with rounded
   * corners. cornerCm >= h / 2 gives a pill (a circle when w == h).
   * Rounded mask lives in the shader — never read pixels (blocked on glasses
   * when the Lens uses Remote APIs).
   */
  image(parent: SceneObject, name: string, tex: Texture, x: number, y: number, z: number, w: number, h: number, cornerCm: number = 0.5): SceneObject {
    const so = this.node(parent, name, x, y, z)
    so.getTransform().setLocalScale(new vec3(w, h, 1))
    const circular = w > 0.01 && Math.abs(w - h) < 0.05 && cornerCm >= h * 0.45
    const mat = (this.photoMaterial || this.iconMaterial).clone()
    const pass = this.pass(mat)
    if (pass) {
      pass.baseTex = tex
      pass.baseColor = new vec4(1, 1, 1, 1)
      pass.slotAspect = w / h
      try {
        pass.texAspect = tex.getWidth() / Math.max(1, tex.getHeight())
      } catch (e) {
        pass.texAspect = 1
      }
      pass.cornerRadius = circular ? 1 : Math.min(1, cornerCm / (h * 0.5))
    }
    this.visual(so, circular ? this.getDisc() : this.getQuad(), mat, ORDER_CARD + 1)
    return so
  }

  /**
   * Makes `so` pinchable with a w × h × d box collider. Hover grows it
   * slightly; `onPress` fires on pinch release over the object.
   * `so` must be unscaled (a holder node), since the collider scales with it.
   */
  pressable(so: SceneObject, w: number, h: number, d: number, onPress: () => void): Interactable {
    const collider = so.createComponent('Physics.ColliderComponent') as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(w, h, d)
    collider.shape = shape
    const inter = so.createComponent(Interactable.getTypeName()) as Interactable
    const t = so.getTransform()
    const base = t.getLocalScale()
    inter.onHoverEnter.add(() => t.setLocalScale(base.uniformScale(HOVER_SCALE)))
    inter.onHoverExit.add(() => t.setLocalScale(base))
    inter.onTriggerEnd.add(() => {
      t.setLocalScale(base)
      onPress()
    })
    return inter
  }

  /** World-space text; capCm is the approximate cap height in cm. */
  text(
    parent: SceneObject,
    name: string,
    value: string,
    x: number,
    y: number,
    z: number,
    capCm: number,
    color: Rgb,
    alpha: number = 1,
    align: TextAlign = 'left',
    title: boolean = false,
    maxWidthCm?: number,
    lines: number = 1,
    renderOrder: number = ORDER_CONTENT + 1,
  ): Text {
    const so = this.node(parent, name, x, y, z)
    const t = so.createComponent('Component.Text') as Text
    t.text = value
    t.size = capCm * TEXT_SIZE_PER_CM
    const font = title ? this.titleFont : this.bodyFont
    if (font) {
      t.font = font
    }
    t.letterSpacing = 0
    t.lineSpacing = 1.15
    t.depthTest = true
    t.textFill.color = new vec4(color[0], color[1], color[2], alpha)
    t.horizontalAlignment =
      align === 'left' ? HorizontalAlignment.Left : align === 'right' ? HorizontalAlignment.Right : HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    const span = maxWidthCm !== undefined ? maxWidthCm : TEXT_RECT_SPAN_CM
    if (maxWidthCm !== undefined && lines > 1) {
      t.horizontalOverflow = HorizontalOverflow.Wrap
      t.verticalOverflow = VerticalOverflow.Truncate
      t.verticalAlignment = VerticalAlignment.Top
      t.worldSpaceRect =
        align === 'left'
          ? Rect.create(0, span, -capCm * 1.45 * lines, capCm * 0.2)
          : align === 'right'
            ? Rect.create(-span, 0, -capCm * 1.45 * lines, capCm * 0.2)
            : Rect.create(-span * 0.5, span * 0.5, -capCm * 1.45 * lines, capCm * 0.2)
    } else {
      const halfH = capCm * 0.85
      t.worldSpaceRect =
        align === 'left'
          ? Rect.create(0, span, -halfH, halfH)
          : align === 'right'
            ? Rect.create(-span, 0, -halfH, halfH)
            : Rect.create(-span * 0.5, span * 0.5, -halfH, halfH)
      if (maxWidthCm !== undefined) {
        t.horizontalOverflow = HorizontalOverflow.Shrink
      }
    }
    t.renderOrder = renderOrder
    return t
  }

  /** Thin glowing line from a to b in the parent's XY plane at depth z. */
  line(parent: SceneObject, name: string, ax: number, ay: number, bx: number, by: number, z: number, thicknessCm: number, color: Rgb, alpha: number = 0.8): SceneObject {
    const dx = bx - ax
    const dy = by - ay
    const len = Math.max(0.01, Math.sqrt(dx * dx + dy * dy))
    const so = this.node(parent, name, (ax + bx) * 0.5, (ay + by) * 0.5, z)
    const t = so.getTransform()
    t.setLocalRotation(quat.fromEulerAngles(0, 0, Math.atan2(dy, dx)))
    t.setLocalScale(new vec3(len * GLOW_MESH, thicknessCm * GLOW_MESH, 1))
    const mat = this.glass({ color, tintAlpha: alpha * 0.5, rimAlpha: alpha })
    const pass = this.pass(mat)
    if (pass) {
      pass.edgeGlow = 1.35
      pass.aspect = len / thicknessCm
      pass.cornerRadius = 1
      pass.edgeWidth = 0.72
    }
    this.visual(so, this.getQuad(), mat, ORDER_LINE)
    return so
  }

  private glass(style: GlassStyle): Material {
    const c = style.color
    const mat = this.glassMaterial.clone()
    const pass = this.pass(mat)
    if (!pass) {
      return mat
    }
    const tintAlpha =
      style.bodyAlpha !== undefined ? style.bodyAlpha : style.tintAlpha !== undefined ? style.tintAlpha : 0.1
    const rimAlpha = style.rimAlpha !== undefined ? style.rimAlpha : 1
    pass.tint = new vec4(c[0] * 0.6 + 0.2, c[1] * 0.6 + 0.2, c[2] * 0.6 + 0.2, tintAlpha)
    pass.rimColor = new vec4(Math.min(1, c[0] * 1.34), Math.min(1, c[1] * 1.34), Math.min(1, c[2] * 1.34), rimAlpha)
    pass.rimPower = style.rimPower !== undefined ? style.rimPower : 1.5
    return mat
  }

  /** Update an existing glass clone (portal color cycle, capsule highlight). */
  recolor(mat: Material, color: Rgb, tintAlpha: number): void {
    const pass = this.pass(mat)
    if (!pass) {
      return
    }
    pass.tint = new vec4(color[0] * 0.6 + 0.2, color[1] * 0.6 + 0.2, color[2] * 0.6 + 0.2, tintAlpha)
    pass.rimColor = new vec4(Math.min(1, color[0] * 1.34), Math.min(1, color[1] * 1.34), Math.min(1, color[2] * 1.34), 1)
  }

  private pass(mat: Material): any {
    try {
      return (mat as any).mainPass
    } catch (e) {
      print(`[TripOptic] material has no pass: ${e}`)
      return null
    }
  }

  private hasPass(mat: Material): boolean {
    return !!this.pass(mat)
  }

  private loadFont(path: string): Font | null {
    try {
      return requireAsset(path) as Font
    } catch (e) {
      print(`[TripOptic] font ${path}: ${e}`)
      return null
    }
  }

  private usable(mat: Material, fallbackPath: string, label: string): Material {
    if (mat && this.hasPass(mat)) {
      return mat
    }
    try {
      const fallback = requireAsset(fallbackPath) as Material
      if (fallback && this.hasPass(fallback)) {
        print(`[TripOptic] ${label} shader has no pass; using ${fallbackPath}`)
        return fallback
      }
    } catch (e) {
      print(`[TripOptic] ${label} fallback failed: ${e}`)
    }
    return mat
  }

  private visual(so: SceneObject, mesh: RenderMesh, mat: Material, order: number): RenderMeshVisual {
    const rmv = so.createComponent('Component.RenderMeshVisual') as RenderMeshVisual
    rmv.mesh = mesh
    rmv.mainMaterial = mat
    rmv.setRenderOrder(order)
    return rmv
  }

  private getDisc(): RenderMesh {
    if (this.discMesh) {
      return this.discMesh
    }
    const segs = 48
    const verts: number[] = [0, 0, 0, 0, 0, 1, 0.5, 0.5]
    const indices: number[] = []
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2
      const x = Math.cos(a) * 0.5
      const y = Math.sin(a) * 0.5
      verts.push(x, y, 0, 0, 0, 1, x + 0.5, y + 0.5)
    }
    for (let i = 1; i <= segs; i++) {
      indices.push(0, i, i + 1)
    }
    const mb = this.newBuilder()
    mb.appendVerticesInterleaved(verts)
    mb.appendIndices(indices)
    mb.updateMesh()
    this.discMesh = mb.getMesh()
    return this.discMesh
  }

  private getQuad(): RenderMesh {
    if (this.quadMesh) {
      return this.quadMesh
    }
    const mb = this.newBuilder()
    mb.appendVerticesInterleaved([
      -0.5, -0.5, 0, 0, 0, 1, 0, 0,
      0.5, -0.5, 0, 0, 0, 1, 1, 0,
      0.5, 0.5, 0, 0, 0, 1, 1, 1,
      -0.5, 0.5, 0, 0, 0, 1, 0, 1,
    ])
    mb.appendIndices([0, 1, 2, 0, 2, 3])
    mb.updateMesh()
    this.quadMesh = mb.getMesh()
    return this.quadMesh
  }

  /**
   * Capsule around the X axis: two hemispheres joined by a cylinder,
   * flattened in Z to depth d. UVs are a front projection (0..1 over w × h).
   */
  private getRoundRect(w: number, h: number, r: number): RenderMesh {
    const key = `rr_${w.toFixed(2)}x${h.toFixed(2)}r${r.toFixed(2)}`
    const cached = this.roundMeshes[key]
    if (cached) {
      return cached
    }
    const hw = w * 0.5
    const hh = h * 0.5
    const rad = Math.max(0.02, Math.min(r, hw, hh))
    const segs = 8
    const verts: number[] = [0, 0, 0, 0, 0, 1, 0.5, 0.5]
    const corners = [
      { cx: hw - rad, cy: -hh + rad, a0: -Math.PI * 0.5 },
      { cx: hw - rad, cy: hh - rad, a0: 0 },
      { cx: -hw + rad, cy: hh - rad, a0: Math.PI * 0.5 },
      { cx: -hw + rad, cy: -hh + rad, a0: Math.PI },
    ]
    for (let c = 0; c < corners.length; c++) {
      const corner = corners[c]
      for (let i = 0; i <= segs; i++) {
        const a = corner.a0 + (i / segs) * (Math.PI * 0.5)
        const x = corner.cx + Math.cos(a) * rad
        const y = corner.cy + Math.sin(a) * rad
        verts.push(x, y, 0, 0, 0, 1, (x + hw) / w, (y + hh) / h)
      }
    }
    const rimCount = 4 * (segs + 1)
    const indices: number[] = []
    for (let i = 1; i < rimCount; i++) {
      indices.push(0, i, i + 1)
    }
    indices.push(0, rimCount, 1)
    const mb = this.newBuilder()
    mb.appendVerticesInterleaved(verts)
    mb.appendIndices(indices)
    mb.updateMesh()
    const mesh = mb.getMesh()
    this.roundMeshes[key] = mesh
    return mesh
  }

  /** Rounded-rect outline only — the colored edge on glass buttons. */
  private getRoundRectFrame(w: number, h: number, r: number, thickness: number): RenderMesh {
    const key = `rrf_${w.toFixed(2)}x${h.toFixed(2)}r${r.toFixed(2)}t${thickness.toFixed(2)}`
    const cached = this.roundMeshes[key]
    if (cached) {
      return cached
    }
    const t = Math.max(0.06, thickness)
    const segs = 8
    const outer = this.roundRectRing(w, h, r, segs)
    const inner = this.roundRectRing(Math.max(0.2, w - t * 2), Math.max(0.2, h - t * 2), Math.max(0.02, r - t), segs)
    const verts: number[] = []
    const indices: number[] = []
    const n = outer.length
    for (let i = 0; i < n; i++) {
      const o = outer[i]
      const q = inner[i]
      verts.push(q.x, q.y, 0, 0, 0, 1, 0.5, 0.5)
      verts.push(o.x, o.y, 0, 0, 0, 1, 0.5, 0.5)
    }
    for (let i = 0; i < n; i++) {
      const i0 = i * 2
      const i1 = i0 + 1
      const i2 = ((i + 1) % n) * 2
      const i3 = i2 + 1
      indices.push(i0, i1, i3, i0, i3, i2)
    }
    const mb = this.newBuilder()
    mb.appendVerticesInterleaved(verts)
    mb.appendIndices(indices)
    mb.updateMesh()
    const mesh = mb.getMesh()
    this.roundMeshes[key] = mesh
    return mesh
  }

  private roundRectRing(w: number, h: number, r: number, segs: number): { x: number; y: number }[] {
    const hw = w * 0.5
    const hh = h * 0.5
    const rad = Math.max(0.02, Math.min(r, hw, hh))
    const corners = [
      { cx: hw - rad, cy: -hh + rad, a0: -Math.PI * 0.5 },
      { cx: hw - rad, cy: hh - rad, a0: 0 },
      { cx: -hw + rad, cy: hh - rad, a0: Math.PI * 0.5 },
      { cx: -hw + rad, cy: -hh + rad, a0: Math.PI },
    ]
    const pts: { x: number; y: number }[] = []
    for (let c = 0; c < corners.length; c++) {
      const corner = corners[c]
      for (let i = 0; i <= segs; i++) {
        const a = corner.a0 + (i / segs) * (Math.PI * 0.5)
        pts.push({ x: corner.cx + Math.cos(a) * rad, y: corner.cy + Math.sin(a) * rad })
      }
    }
    return pts
  }

  private getRing(inner: number, outer: number): RenderMesh {
    const key = `ring_${inner.toFixed(2)}_${outer.toFixed(2)}`
    const cached = this.ringMeshes[key]
    if (cached) {
      return cached
    }
    const segs = 48
    const verts: number[] = []
    const indices: number[] = []
    const span = Math.max(0.01, outer * 2)
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      verts.push(c * inner, s * inner, 0, 0, 0, 1, (c * inner) / span + 0.5, (s * inner) / span + 0.5)
      verts.push(c * outer, s * outer, 0, 0, 0, 1, (c * outer) / span + 0.5, (s * outer) / span + 0.5)
    }
    for (let i = 0; i < segs; i++) {
      const i0 = i * 2
      const i1 = i0 + 1
      const i2 = i0 + 2
      const i3 = i0 + 3
      indices.push(i0, i1, i3, i0, i3, i2)
    }
    const mb = this.newBuilder()
    mb.appendVerticesInterleaved(verts)
    mb.appendIndices(indices)
    mb.updateMesh()
    const mesh = mb.getMesh()
    this.ringMeshes[key] = mesh
    return mesh
  }

  private getPill(w: number, h: number, d: number): RenderMesh {
    const key = `${w.toFixed(2)}x${h.toFixed(2)}x${d.toFixed(2)}`
    const cached = this.pillMeshes[key]
    if (cached) {
      return cached
    }
    const r = h * 0.5
    const halfLen = Math.max(0, w * 0.5 - r)
    const depthScale = d / h
    const ringsPerCap = 12
    const segments = 32
    const cols = segments + 1
    const verts: number[] = []
    const indices: number[] = []
    let rows = 0
    for (let cap = 0; cap < 2; cap++) {
      const cx = cap === 0 ? -halfLen : halfLen
      for (let i = 0; i <= ringsPerCap; i++) {
        const theta = (Math.PI * 0.5) * (cap + i / ringsPerCap)
        const st = Math.sin(theta)
        const ct = Math.cos(theta)
        for (let j = 0; j <= segments; j++) {
          const phi = (Math.PI * 2 * j) / segments
          const dx = -ct
          const dy = st * Math.cos(phi)
          const dz = st * Math.sin(phi)
          const px = cx + r * dx
          const py = r * dy
          const pz = r * dz * depthScale
          let nx = dx
          let ny = dy
          let nz = dz / depthScale
          const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
          nx /= nl
          ny /= nl
          nz /= nl
          verts.push(px, py, pz, nx, ny, nz, (px + w * 0.5) / w, (py + r) / h)
        }
        rows++
      }
    }
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < segments; j++) {
        const a = i * cols + j
        const b = (i + 1) * cols + j
        const c = (i + 1) * cols + j + 1
        const e = i * cols + j + 1
        indices.push(a, c, b, a, e, c)
      }
    }
    const mb = this.newBuilder()
    mb.appendVerticesInterleaved(verts)
    mb.appendIndices(indices)
    mb.updateMesh()
    const mesh = mb.getMesh()
    this.pillMeshes[key] = mesh
    return mesh
  }

  private newBuilder(): MeshBuilder {
    const mb = new MeshBuilder([
      { name: 'position', components: 3 },
      { name: 'normal', components: 3, normalized: true },
      { name: 'texture0', components: 2 },
    ])
    mb.topology = MeshTopology.Triangles
    mb.indexType = MeshIndexType.UInt16
    return mb
  }
}
