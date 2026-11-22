import { CUSTOM_BIN_ID, findBin, findRollingBox } from './bins'
import { normalizeFloor, type FloorGeometry, type PolyEdge } from './geometry'
import { CHORD_T, solveHeight, type HeightOption, type HeightSolution } from './height'
import { buildLayout, DRAWER_FACE_T, DRAWER_SLIDE, DRAWER_WALL, WEB_OC, rollingAxes, type Layout } from './layout'
import { planLumber, planSheets, type LumberPlan, type SheetPlan } from './optimize'
import { planPlywood } from './deck'
import { tatamiFit } from './tatami'
import type { FloorSpec, Params, Part, Placement, Rect } from './types'

/** Structural plywood, roughly 34 lb per cubic foot. */
const PLY_LB_PER_IN3 = 34 / 1728
const LIFT_DEPTH = 8
const MIN_SPLIT = 4

function subtractRect(q: Placement, z: Rect): Placement[] {
  const out: Placement[] = []
  const add = (x: number, y: number, x2: number, y2: number) => {
    if (x2 - x > 0.01 && y2 - y > 0.01) out.push({ ...q, x, y, sx: x2 - x, sy: y2 - y })
  }
  const qx2 = q.x + q.sx
  const qy2 = q.y + q.sy
  const zx2 = z.x + z.w
  const zy2 = z.y + z.l
  add(q.x, q.y, qx2, Math.min(qy2, z.y))
  add(q.x, Math.max(q.y, zy2), qx2, qy2)
  add(q.x, Math.max(q.y, z.y), Math.min(qx2, z.x), Math.min(qy2, zy2))
  add(Math.max(q.x, zx2), Math.max(q.y, z.y), qx2, Math.min(qy2, zy2))
  return out
}

export function defaultParams(): Params {
  const b = findBin('samla-22')!
  return {
    floor: { shape: 'rect', width: 120, length: 96, notchW: 36, notchL: 36, frontEdge: 0 },
    finalHeight: 15,
    plyThickness: 0.75,
    tatamiThickness: 2,
    sheetW: 48,
    sheetL: 96,
    lumberLengths: [96, 120, 144],
    kerf: 0.125,
    binId: b.id,
    bin: { w: b.w, d: b.d, h: b.h },
    binLongAlongJoists: false,
    clearance: 0.5,
    joistStyle: 'builtup',
    drawerKind: 'ikea',
    rollingBox: { id: 'malm-box', w: 37.375, d: 24.375, h: 11.375 },
    maxSpacing: 24,
    features: { drawers: false, hatches: false, edgeTrim: false, acousticStrips: false, underlay: false },
    underlayThickness: 0.25,
    trimSides: { front: true, back: true, left: true, right: true },
    reinforce: { doubleJoists: false },
    heightOption: 0,
    designLoadPsf: 40,
    pointLoadLb: 300,
    supportCount: 0,
    joistAdjust: 0,
    crossAdjust: 0,
    moves: {},
    tatamiPattern: 'brick',
    tatamiAnchor: 'bl',
    tatamiLong: 72,
    tatamiShort: 36,
    liftTables: [],
  }
}

export function resolveBin(p: Params) {
  if (p.binId === CUSTOM_BIN_ID) return p.bin
  const b = findBin(p.binId)
  return b ? { w: b.w, d: b.d, h: b.h } : p.bin
}

export type Edge = PolyEdge

export function floorEdges(f: FloorSpec): Edge[] {
  return normalizeFloor(f).edges
}

export { splitAxis, planDeck, type DeckPiece } from './deck'

export interface Build {
  params: Params
  geometry: FloorGeometry
  layout: Layout
  height: HeightSolution
  option?: HeightOption
  supportHeight: number
  parts: Part[]
  hardware: { name: string; qty: number; unit: string; notes?: string }[]
  placements: Placement[]
  unsupportedSeams: { axis: 'x' | 'y'; pos: number; section: number }[]
  lumberPlans: LumberPlan[]
  sheetPlans: SheetPlan[]
  warnings: string[]
  assembly: string[]
  pockets: number
  binCount: number
  deckPanels: number
  heaviestPanelLb: number
  /** false when not even one 36x36 tatami mat fits on the floor */
  tatamiFits: boolean
  jointCount: { joists: number; crossJoists: number }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000
const sheetKey = (t: number) => `ply-${r3(t)}`

export function mergeParts(parts: Part[]): Part[] {
  const m = new Map<string, Part>()
  for (const p of parts) {
    const k = [p.group, p.name, p.material, r3(p.length), r3(p.width), r3(p.thickness), p.notes ?? ''].join('|')
    const e = m.get(k)
    if (e) {
      e.qty += p.qty
      e.pockets = (e.pockets ?? 0) + (p.pockets ?? 0)
    } else m.set(k, { ...p, length: r3(p.length), width: r3(p.width), pockets: p.pockets })
  }
  return [...m.values()]
}

export function buildFloor(input: Params): Build {
  const p: Params = { ...input, bin: resolveBin(input) }
  const warnings: string[] = []
  const geometry = normalizeFloor(p.floor)
  if (geometry.error) warnings.push(`Floor shape problem: ${geometry.error}`)
  const layout = buildLayout(p)
  warnings.push(...layout.warnings)
  const readyDrawers = p.features.drawers && p.drawerKind === 'ikea'
  const ul = p.features.underlay ? p.underlayThickness : 0
  const height = solveHeight({
    finalHeight: p.finalHeight - ul,
    plyThickness: p.plyThickness,
    tatamiThickness: p.tatamiThickness,
    binH: readyDrawers ? Math.max(p.bin.h, p.rollingBox.h) : p.bin.h,
    drawers: p.features.drawers && !readyDrawers,
    style: p.joistStyle,
  })
  if (height.message) warnings.push(height.message)
  const option = height.options[Math.min(Math.max(0, p.heightOption), Math.max(0, height.options.length - 1))]
  const S = option?.achieved ?? Math.max(0, height.target)
  const depth = option?.depth ?? S
  const layers = option?.layers ?? []
  const bu = layers.reduce((s, l) => s + l.t, 0)
  const jointKey = option?.joist.key ?? '2x4'

  const parts: Part[] = []
  const placements: Placement[] = []
  const unsupportedSeams: Build['unsupportedSeams'] = []
  let pockets = 0
  let joistLf = 0
  let deckScrewLen = 0
  let deckPanels = 0
  let accessCount = 0
  let heaviest = 0
  let joistCount = 0
  let crossLines = 0
  let supportPads = 0

  const lumber = (
    group: string,
    name: string,
    material: string,
    qty: number,
    length: number,
    width: number,
    thickness: number,
    notes?: string,
    pk = 0,
  ) => {
    if (qty <= 0 || length <= 0) return
    parts.push({ id: '', group, name, kind: 'lumber', material, qty, length, width, thickness, notes, pockets: pk * qty })
    pockets += pk * qty
  }
  const sheet = (group: string, name: string, t: number, qty: number, a: number, b: number, notes?: string) => {
    if (qty <= 0 || a <= 0 || b <= 0) return
    parts.push({
      id: '',
      group,
      name,
      kind: 'sheet',
      material: sheetKey(t),
      qty,
      length: Math.max(a, b),
      width: Math.min(a, b),
      thickness: t,
      notes,
    })
  }
  const T = layout.joistW
  const builtup = p.joistStyle === 'builtup'
  /** one frame member: a solid board on edge, or two flat 2x4 chords with vertical 2x4 webs pocket-screwed between them */
  const member = (name: string, qty: number, length: number, solidPk = 0) => {
    if (qty <= 0 || length <= 0) return
    if (!builtup) return lumber('Frame', name, jointKey, qty, length, option?.joist.d ?? depth, 1.5, ripNote, solidPk)
    const webs = Math.max(2, Math.ceil(length / WEB_OC) + 1)
    lumber('Frame', `${name} - top & bottom chord (2x4 flat)`, '2x4', qty * 2, length, 3.5, 1.5, 'Run the full length: one on top, one on the bottom')
    lumber('Frame', `${name} - vertical web (2x4)`, '2x4', qty * webs, Math.max(0.5, S - 2 * CHORD_T), 3.5, 1.5, `Pocket-screw to top and bottom chord, about ${WEB_OC}" apart`, 4)
  }
  const ripNote = option?.ripTo ? `Rip to ${option.ripTo.toFixed(3)}" wide` : undefined

  layout.sections.forEach((sec) => {
    const { rect } = sec
    const n = sec.joistX.length
    sec.joistX.forEach((jx, k) => {
      const rim = k === 0 || k === n - 1
      const t = sec.joistT[k]
      placements.push({ kind: rim ? 'rim' : 'joist', x: jx, y: rect.y, z: bu, sx: t, sy: rect.l, sz: depth, ref: rim || sec.exact ? undefined : { s: sec.index, axis: 'x', k } })
      if (bu > 0) placements.push({ kind: 'buildup', x: jx, y: rect.y, z: 0, sx: t, sy: rect.l, sz: bu })
      joistLf += rect.l / 12
      deckScrewLen += rect.l
    })
    const rimCount = 2
    const divTotal = sec.joistX.length - 2
    const mult = p.reinforce.doubleJoists ? 2 : 1
    joistCount += rimCount + divTotal * mult
    crossLines += Math.max(0, ...sec.colBlocks.map((b) => b.length))
    supportPads += p.supportCount > 1 ? (rimCount + divTotal * mult) * p.supportCount : 0
    member(builtup ? 'Joist' : `Joist (${jointKey} on edge)`, rimCount + divTotal * mult, rect.l)
    for (const l of layers) {
      const qty = rimCount + divTotal * mult
      if (l.material.startsWith('ply-strip')) sheet('Frame', `Build-up strip (${l.name})`, l.t, qty, rect.l, 3.5, 'Glue + screw under each joist')
      else lumber('Frame', `Build-up strip (${l.name})`, l.material, qty, rect.l, 3.5, l.t, 'Glue + screw under each joist')
    }

    const nJ = sec.joistX.length
    const backY = rect.y + rect.l - T
    for (let k = 0; k < nJ - 1; k++) {
      const x0 = sec.joistX[k] + sec.joistT[k]
      const w = sec.joistX[k + 1] - x0
      if (w < 0.1) continue
      placements.push({ kind: 'rim', x: x0, y: backY, z: bu, sx: w, sy: T, sz: depth })
      member('Back rim (between joists)', 1, w, 4)
      if (sec.drawerFront) {
        placements.push({ kind: 'header', x: x0, y: rect.y, z: S - 1.5, sx: w, sy: 3.5, sz: 1.5 })
        lumber('Frame', 'Drawer header (2x4 laid flat)', '2x4', 1, w, 3.5, 1.5, 'Sits flush under deck at the front opening, between joists', 4)
      } else {
        placements.push({ kind: 'rim', x: x0, y: rect.y, z: bu, sx: w, sy: T, sz: depth })
        member('Front rim (between joists)', 1, w, 4)
      }
    }

    sec.cols.forEach((col, ci) => {
      sec.colBlocks[ci].forEach((by, bk) => {
        placements.push({ kind: 'block', x: col.x, y: by, z: bu, sx: col.w, sy: T, sz: depth, ref: sec.colRows[ci]?.[0]?.drawer && bk === 0 ? undefined : { s: sec.index, axis: 'y', k: bk, c: ci } })
        member('Cross member', 1, col.w, 4)
        deckScrewLen += col.w
      })
    })
  })

  const deck = planPlywood(layout, { sheetL: p.sheetL, sheetW: p.sheetW, serviceFillers: p.fillerAccess ?? [] })
  unsupportedSeams.push(...deck.unsupported)
  const ply = p.plyThickness
  for (const q of deck.panels) {
    const lift = q.kind === 'lift'
    const under = q.kind !== 'accessible'
    if (q.kind === 'accessible') {
      sheet('Deck', `Accessible deck panel (${r3(ply)}" ply)`, ply, 1, q.w, q.l, 'Under the tatami mats; lifts out to reach the bins / drawers below. Edges on joist centrelines')
      deckPanels++
    } else if (lift) {
      sheet('Deck', `Maintenance lift-out under filler (${r3(ply)}" ply)`, ply, 1, q.w - 0.25, q.l - 0.25, 'Edges on joist centrelines; not screwed down, lifts out for cable / power access. 1/8" clearance, finger pull')
      accessCount++
    } else {
      sheet('Deck', `Deck panel under filler (${r3(ply)}" ply, fixed)`, ply, 1, q.w, q.l, 'Same size as the filler area; screw down to the joists and blocks, not accessible')
      deckPanels++
    }
    if (under) sheet('Deck reinforcement', `Heavy-load reinforcing ply under filler (${r3(ply)}" ply)`, ply, 1, q.w, q.l, 'Glue + screw a second layer for TV / TV stand loads; seams offset from the panel above')
    placements.push({ kind: lift ? 'hatch' : 'deck', x: q.x, y: q.y, z: S, sx: q.w, sy: q.l, sz: ply })
    heaviest = Math.max(heaviest, q.w * q.l * ply * PLY_LB_PER_IN3 * (under ? 2 : 1))
  }
  const drawerCells = layout.cells.filter((c) => c.type === 'drawer')
  const clr = p.clearance
  const splitMode = (c: { key: string }) => {
    const m = p.binSplit?.[c.key]
    return m === 'x' && (layout.binX - clr) / 2 >= MIN_SPLIT ? 'x' : m === 'y' && (layout.binY - clr) / 2 >= MIN_SPLIT ? 'y' : undefined
  }
  let binCount = layout.cells.reduce((s, c) => s + c.binsX * c.binsY, 0)

  const slotPos = (start: number, size: number, n: number, item: number, k: number) => start + (size / n) * k + (size / n - item) / 2
  // a split cell is refilled with the smaller bin along the split axis, so extra bins appear when they fit
  const pushSplit = (c: { index: number; binsX: number; binsY: number }, mode: 'x' | 'y', rx: number, rw: number, ry: number, rl: number, nxFixed: number, nyFixed: number, z: number) => {
    const half = ((mode === 'x' ? layout.binX : layout.binY) - clr) / 2
    const sx = mode === 'x' ? half : layout.binX
    const sy = mode === 'y' ? half : layout.binY
    const nx = mode === 'x' ? Math.max(2, Math.floor((rw + 1e-6) / (half + clr))) : nxFixed
    const ny = mode === 'y' ? Math.max(2, Math.floor((rl + 1e-6) / (half + clr))) : nyFixed
    for (let ix = 0; ix < nx; ix++)
      for (let iy = 0; iy < ny; iy++) placements.push({ kind: 'bin', x: slotPos(rx, rw, nx, sx, ix), y: slotPos(ry, rl, ny, sy, iy), z, sx, sy, sz: p.bin.h, cell: c.index, split: mode })
    binCount += nx * ny - c.binsX * c.binsY
  }
  layout.cells.forEach((c) => {
    if (c.type === 'bin') {
      const mode = splitMode(c)
      if (mode) return pushSplit(c, mode, c.x, c.w, c.y, c.l, c.binsX, c.binsY, 0)
      for (let ix = 0; ix < c.binsX; ix++)
        for (let iy = 0; iy < c.binsY; iy++)
          placements.push({ kind: 'bin', x: slotPos(c.x, c.w, c.binsX, layout.binX, ix), y: slotPos(c.y, c.l, c.binsY, layout.binY, iy), z: 0, sx: layout.binX, sy: layout.binY, sz: p.bin.h, cell: c.index })
    }
  })
  const boxT = DRAWER_WALL
  let slides = 0
  if (readyDrawers) {
    const { rx, ry } = rollingAxes(p)
    const faceH = S - 1.5 - 0.375
    for (const c of drawerCells) {
      sheet('Drawers', 'Drawer false front (screws to the IKEA box)', DRAWER_FACE_T, 1, c.w - 0.25, Math.min(faceH, S - 0.5), 'Screw from inside of the IKEA box front')
      placements.push({ kind: 'drawer', x: c.x + (c.w - rx) / 2, y: c.y + DRAWER_FACE_T, z: 0.25, sx: rx, sy: ry, sz: p.rollingBox.h, cell: c.index })
      placements.push({ kind: 'drawerFace', x: c.x + 0.125, y: c.y, z: 0.125, sx: c.w - 0.25, sy: DRAWER_FACE_T, sz: faceH, cell: c.index })
    }
  } else if (p.features.drawers) {
    const faceH = S - 1.5 - 0.375
    const boxH = faceH - 0.75
    for (const c of drawerCells) {
      const boxW = c.w - 2 * DRAWER_SLIDE
      const boxL = layout.binY + p.clearance + 2 * boxT
      const boxLen = Math.min(boxL, c.l - DRAWER_FACE_T - 0.25)
      sheet('Drawers', 'Drawer side', boxT, 2, boxLen, boxH, 'Pocket-screw to front/back')
      sheet('Drawers', 'Drawer front/back', boxT, 2, boxW - 2 * boxT, boxH, 'Pocket-screw to sides')
      sheet('Drawers', 'Drawer bottom', boxT, 1, boxW, boxLen, 'Screw + glue to box')
      sheet('Drawers', 'Drawer face', DRAWER_FACE_T, 1, c.w - 0.25, faceH, 'Screw from inside of box')
      pockets += 8
      slides += Math.floor(Math.max(0, boxLen) / 2) * 2
      placements.push({ kind: 'drawer', x: c.x + DRAWER_SLIDE, y: c.y + DRAWER_FACE_T, z: 0.5, sx: boxW, sy: boxLen, sz: boxH, cell: c.index })
      placements.push({ kind: 'drawerFace', x: c.x + 0.125, y: c.y, z: 0.125, sx: c.w - 0.25, sy: DRAWER_FACE_T, sz: faceH, cell: c.index })
      const dmode = splitMode(c)
      if (dmode) pushSplit(c, dmode, c.x + DRAWER_SLIDE, boxW, c.y + DRAWER_FACE_T + boxT, boxLen - 2 * boxT, c.binsX, 1, 0.5 + boxT)
      else
        for (let ix = 0; ix < c.binsX; ix++)
          placements.push({ kind: 'bin', x: slotPos(c.x + DRAWER_SLIDE, boxW, c.binsX, layout.binX, ix), y: c.y + DRAWER_FACE_T + (boxLen - layout.binY) / 2, z: 0.5 + boxT, sx: layout.binX, sy: layout.binY, sz: p.bin.h, cell: c.index })
    }
  }

  const serviceCells = layout.cells.filter((c) => c.type === 'service')
  const sisterLen = new Map<string, number>()
  let cableHoles = 0
  serviceCells.forEach((c) => {
    const sec = layout.sections[c.section]
    const ci = sec.cols.findIndex((col) => Math.abs(col.x - c.x) < 1e-3)
    const last = sec.joistX.length - 1
    for (const k of [ci, ci + 1]) {
      if (ci < 0 || k <= 0 || k >= last) continue
      const key = `${c.section}:${k}`
      sisterLen.set(key, (sisterLen.get(key) ?? 0) + c.l + T)
    }
    placements.push({ kind: 'block', x: c.x, y: c.y + c.l / 2 - T / 2, z: bu, sx: c.w, sy: T, sz: depth })
    member('Heavy-load cross block (mid-cell, drill 1-1/2" cable hole)', 1, c.w, 4)
    placements.push({ kind: 'service', x: c.x, y: c.y, z: 0, sx: c.w, sy: c.l, sz: 0.25, cell: c.index })
    cableHoles++
  })
  sisterLen.forEach((len) => {
    member('Sister joist (doubled for TV / heavy-load zone)', 1, len, 4)
    cableHoles++
  })

  if (p.features.edgeTrim) {
    for (const e of floorEdges(p.floor)) {

      if (!p.trimSides[e.side]) continue
      const th = 0.75
      const fullH = S + p.plyThickness + p.tatamiThickness / 2
      const note = e.isFront && p.features.drawers
        ? '3/4" plywood, ONE continuous front panel; fix to each drawer face, cut a hand hold at each drawer'
        : '3/4" plywood, ripped to cover frame + deck edge'
      sheet('Edge trim', `Side panel - ${e.side}`, th, 1, e.length, fullH, note)
      const horiz = e.y1 === e.y2
      placements.push({
        kind: 'trim',
        x: horiz ? Math.min(e.x1, e.x2) : e.side === 'left' ? e.x1 - th : e.x1,
        y: horiz ? (e.side === 'front' ? e.y1 - th : e.y1) : Math.min(e.y1, e.y2),
        z: 0,
        sx: horiz ? e.length : th,
        sy: horiz ? th : e.length,
        sz: fullH,
      })
    }
  }

  const liftZones = p.liftTables.map((l) => ({ x: l.x, y: l.y, w: p.tatamiShort, l: p.tatamiShort }))
  if (liftZones.length) {
    const hit = (q: { x: number; y: number; sx: number; sy: number }, z: Rect) =>
      q.x < z.x + z.w - 0.01 && q.x + q.sx > z.x + 0.01 && q.y < z.y + z.l - 0.01 && q.y + q.sy > z.y + 0.01
    const next: Placement[] = []
    for (const q of placements) {
      if (q.kind === 'bin') {
        if (liftZones.some((z) => hit(q, z))) {
          binCount--
          continue
        }
      } else if (q.kind === 'joist' || q.kind === 'block' || q.kind === 'buildup' || q.kind === 'deck' || q.kind === 'rim') {
        let pieces = [q]
        for (const z of liftZones) pieces = pieces.flatMap((pc) => (hit(pc, z) ? subtractRect(pc, z) : [pc]))
        next.push(...pieces)
        continue
      }
      next.push(q)
    }
    const inFloor = (x: number, y: number) => geometry.rects.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.l)
    let sides = 0
    let ends = 0
    for (const z of liftZones) {
      const frame = [
        { x: z.x - T, y: z.y, sx: T, sy: z.l, side: true, skip: layout.sections.some((s) => Math.abs(s.rect.x + s.rect.w - z.x) < 0.01 && s.rect.y <= z.y + 0.01 && s.rect.y + s.rect.l >= z.y + z.l - 0.01) },
        { x: z.x + z.w, y: z.y, sx: T, sy: z.l, side: true, skip: layout.sections.some((s) => Math.abs(s.rect.x - (z.x + z.w)) < 0.01 && s.rect.y <= z.y + 0.01 && s.rect.y + s.rect.l >= z.y + z.l - 0.01) },
        { x: z.x - T, y: z.y - T, sx: z.w + 2 * T, sy: T, side: false, skip: false },
        { x: z.x - T, y: z.y + z.l, sx: z.w + 2 * T, sy: T, side: false, skip: false },
      ]
      for (const m of frame) {
        if (m.skip || !inFloor(m.x + m.sx / 2, m.y + m.sy / 2)) continue
        next.push({ kind: 'rim', x: m.x, y: m.y, z: bu, sx: m.sx, sy: m.sy, sz: depth })
        if (m.side) sides++
        else ends++
      }
      const bodyBottom = Math.max(0, S - LIFT_DEPTH)
      next.push({ kind: 'lift', x: z.x + 0.125, y: z.y + 0.125, z: bodyBottom, sx: z.w - 0.25, sy: z.l - 0.25, sz: S - bodyBottom })
      next.push({ kind: 'lift', x: z.x + 0.125, y: z.y + 0.125, z: S + p.plyThickness, sx: z.w - 0.25, sy: z.l - 0.25, sz: p.tatamiThickness })
    }
    placements.splice(0, placements.length, ...next)
    member('Lift pocket frame (side, along joists)', sides, p.tatamiShort, 4)
    member('Lift pocket frame (end, across)', ends, p.tatamiShort + 2 * T, 4)
    warnings.push(
      `${liftZones.length} motorized lift table(s): joists, cross blocks and the plywood are cut back around each ${r3(p.tatamiShort)}" opening and framed by the pocket frame; cut the members full length and trim on site. Bins cannot sit under a table, and front drawers are laid out across the front width left beside it.`,
    )
    if (S < LIFT_DEPTH) warnings.push(`Lift tables need about ${LIFT_DEPTH}" below the deck but the frame is only ${r3(S)}" high. Raise the final height.`)
    const clash = drawerCells.filter((c) => liftZones.some((z) => hit({ x: c.x, y: c.y, sx: c.w, sy: c.l }, z))).length
    if (clash) warnings.push(`${clash} drawer(s) overlap a lift table. Move the table off the front row or turn drawers off there.`)
  }

  if (ul > 0) {
    for (const q of placements) q.z += ul
    for (const r of geometry.rects) placements.push({ kind: 'underlay', x: r.x, y: r.y, z: 0, sx: r.w, sy: r.l, sz: ul })
    // the underlay runs under the fascia trim, which sits on top of it
    for (const q of placements.filter((x) => x.kind === 'trim')) placements.push({ kind: 'underlay', x: q.x, y: q.y, z: 0, sx: q.sx, sy: q.sy, sz: ul })
  }

  const merged = mergeParts(parts).filter((x) => x.qty > 0 || (x.pockets ?? 0) > 0)
  const finalParts = merged.filter((x) => x.qty > 0)
  const order = ['Frame', 'Deck', 'Access hatches', 'Drawers', 'Edge trim']
  finalParts.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.length - a.length)
  finalParts.forEach((x, i) => (x.id = String(i + 1)))

  const hardware: Build['hardware'] = []
  const pocketCount = pockets
  if (pocketCount) hardware.push({ name: 'Pocket screws 2-1/2" coarse thread', qty: Math.ceil(pocketCount * 1.15), unit: 'pcs', notes: `${pocketCount} pocket holes + 15% spare` })
  if (deckScrewLen) hardware.push({ name: 'Deck screws 1-5/8" (plywood to frame)', qty: Math.ceil(deckScrewLen / 8), unit: 'pcs', notes: 'About every 8" along joists and blocks' })
  if (ul > 0) {
    const area = geometry.rects.reduce((s, r) => s + r.w * r.l, 0) / 144
    hardware.push({
      name: `Acoustic underlay, ${r3(ul)}" (6 mm) cork or rubber roll`,
      qty: Math.ceil(area * 1.1),
      unit: 'sq ft',
      notes: 'Laid wall to wall under the whole frame (10% waste); e.g. QEP natural cork 6 mm. The frame is built that much shorter to keep the final height.',
    })
  }
  if (joistLf) hardware.push({ name: 'Construction adhesive tubes', qty: Math.max(1, Math.ceil(joistLf / 25)), unit: 'tubes' })
  if (slides) hardware.push({ name: 'Drawer slides (side mount, pairs)', qty: drawerCells.length, unit: 'pairs', notes: `Total slide length about ${slides}"; choose the nearest even length` })
  if (readyDrawers && drawerCells.length) {
    const rb = findRollingBox(p.rollingBox.id)
    hardware.push({ name: `Ready-made rolling box${rb ? ` - ${rb.name}` : ' (custom size)'}`, qty: drawerCells.length, unit: 'pcs', notes: `${r3(p.rollingBox.w)}" x ${r3(p.rollingBox.d)}" x ${r3(p.rollingBox.h)}"; one per front cell` })
    if (!rb?.casters) hardware.push({ name: 'Swivel casters (kit)', qty: drawerCells.length, unit: 'sets', notes: 'Only if the box has no wheels; box height above includes them' })
  }
  if (liftZones.length) hardware.push({ name: `Motorized lift table, ${r3(p.tatamiShort)}" square (electric, purchased)`, qty: liftZones.length, unit: 'pcs', notes: `Needs about ${LIFT_DEPTH}" of depth below the deck for the retracted table and motor, plus a power feed and control` })
  if (drawerCells.length) hardware.push({ name: 'Drawer pulls', qty: drawerCells.length, unit: 'pcs' })
  const smallBins = placements.filter((q) => q.kind === 'bin' && q.split)
  if (smallBins.length) hardware.push({ name: `Smaller bins, about ${r3(smallBins[0].sx)}" x ${r3(smallBins[0].sy)}" x ${r3(p.bin.h)}" (purchased; sized to fit)`, qty: smallBins.length, unit: 'pcs', notes: 'Split bins: pick the nearest IKEA size that fits each half' })
  if (p.features.acousticStrips && joistLf) hardware.push({ name: 'Acoustic isolation tape / underlay strip', qty: Math.ceil(joistLf), unit: 'ft', notes: 'Under every joist, rims included' })
  if (accessCount) hardware.push({ name: 'Recessed finger pulls', qty: accessCount, unit: 'pcs' })
  if (serviceCells.length) hardware.push({ name: 'Cable pass-through grommets 1-1/2"', qty: cableHoles, unit: 'pcs', notes: 'Drill through joists / blocks to form a continuous cable chase from wall outlets to TV stand, table and heater' })
  if (serviceCells.length) hardware.push({ name: 'Cable clips / surface raceway', qty: serviceCells.length * 2, unit: 'pcs', notes: 'Keep cables off the slab; leave heater clearance' })
  if (height.options.length) {
    if (supportPads) hardware.push({ name: 'Support pads / shim stacks under joists', qty: supportPads, unit: 'pcs', notes: `${p.supportCount} per joist, evenly spaced end to end` })
    else hardware.push({ name: 'Cedar leveling shims', qty: Math.ceil(joistLf / 2), unit: 'pcs', notes: 'Estimate for uneven slab' })
  }

  const lumberMats = [...new Set(finalParts.filter((x) => x.kind === 'lumber').map((x) => x.material))]
  const sheetMats = [...new Set(finalParts.filter((x) => x.kind === 'sheet').map((x) => x.material))]
  const lumberPlans = lumberMats.map((m) =>
    planLumber(m, finalParts.filter((x) => x.kind === 'lumber' && x.material === m), p.lumberLengths, p.kerf),
  )
  const sheetPlans = sheetMats.map((m) =>
    planSheets(m, finalParts.filter((x) => x.kind === 'sheet' && x.material === m), p.sheetL, p.sheetW, p.kerf),
  )
  for (const lp of lumberPlans) if (lp.unfit.length) warnings.push(`${lp.material}: ${lp.unfit.length} piece(s) are longer than the longest stock length.`)
  for (const sp of sheetPlans) if (sp.unfit.length) warnings.push(`${sp.material}: ${sp.unfit.length} piece(s) do not fit on a sheet.`)
  if (unsupportedSeams.length) warnings.push(`${unsupportedSeams.length} deck seam(s) land between supports - see Load & weak points.`)
  if (heaviest > 75) {
    warnings.push(`The deck panels lift off whole: the heaviest is about ${Math.round(heaviest)} lb. Consider thinner plywood or a smaller sheet size so one person can lift it.`)
  }
  if (serviceCells.length) warnings.push(`${serviceCells.length} heavy-load cell(s) under the plywood filler: reinforced with doubled joists and blocking, no bins/drawers, not accessible once screwed down.`)
  const tatamiFits = geometry.rects.length === 0 || tatamiFit(geometry.rects, p.tatamiShort)
  if (!tatamiFits) warnings.push('Flooring size not large enough to accommodate at least one tatami mat.')

  const assembly = [
    geometry.front
      ? `Mark the layout on the slab. The front (drawer / entry side) is edge ${(geometry.edges.find((e) => e.isFront)?.index ?? 0) + 1}; joists run away from it. Frame is ${layout.sections.length} rectangular section(s).`
      : 'Mark the layout on the slab.',
    builtup
      ? `Cut the 2x4 chords (top and bottom pieces of every joist, rim and cross member, running its full length) and the vertical 2x4 webs (${r3(Math.max(0.5, S - 3))}" long). Drill 2 pocket holes in each end of every web.`
      : `Cut the joists, rims and cross blocks. Drill pocket holes in every block, rim${p.features.drawers ? ' and drawer header' : ''} end (2 per end).`,
    `Assemble each section on the floor: pocket-screw rims and blocks between the joists, checking square by measuring diagonals.`,
    builtup
      ? 'Build each joist as a ladder: lay the bottom chord flat, pocket-screw the webs upright about 16" apart (one at each end), then pocket-screw the top chord on. Make all joists identical.'
      : layers.length ? 'Glue and screw the build-up strips under each joist before standing the frame up.' : 'No build-up strips needed for this height.',
    'Set the frame in place, level it with shims, then glue and screw sections together where they meet.',
    ul > 0 ? `Before the frame goes down, roll out the ${r3(ul)}" acoustic underlay wall to wall, seams butted and taped.` : '',
    p.features.drawers ? (readyDrawers ? 'Roll the IKEA boxes into the front cells and screw the plywood false fronts on with even 1/8" gaps.' : 'Install drawer slides, build drawer boxes (pocket screws), and fit the faces with even 1/8" gaps.') : '',
    `Lay the ${r3(p.plyThickness)}" plywood deck in ${deckPanels} panel(s), seams on joist/block centres, screws about every 8". Panels are not glued so they can be lifted.`,
    p.features.edgeTrim ? 'Fit fascia trim on the selected exposed edges.' : '',
    'Lay the tatami mats following the chosen arrangement; screw plywood filler pieces down to the joists wherever the mats do not reach.',
    serviceCells.length ? 'Heavy-load / cable zones under the filler pieces: no bins or drawers. Add the sister joists and mid-cell blocks, drill 1-1/2" holes in line through joists and blocks for the cable chase, fit grommets, and run extension cables before screwing the fillers down.' : '',
  ].filter(Boolean)

  return {
    params: p,
    geometry,
    layout,
    height,
    option,
    supportHeight: S,
    parts: finalParts,
    hardware,
    placements,
    unsupportedSeams,
    lumberPlans,
    sheetPlans,
    warnings: [...new Set(warnings)],
    assembly,
    pockets: pocketCount,
    binCount,
    deckPanels,
    heaviestPanelLb: heaviest,
    tatamiFits,
    jointCount: { joists: joistCount, crossJoists: crossLines },
  }
}
