import { STANDARD_BIN_FOOTPRINTS_MM } from './bins'
import { mmToIn } from './units'
import { normalizeFloor, type FloorGeometry, type PolyEdge } from './geometry'
import { CHORD_T, solveHeight, type HeightOption, type HeightSolution } from './height'
import { buildLayout, DRAWER_BACK_GAP, DRAWER_SIDE_GAP, WEB_OC, type Layout } from './layout'
import { planLumber, planSheets, type LumberPlan, type SheetPlan } from './optimize'
import { planPlywood } from './deck'
import { tatamiFit } from './tatami'
import type { FloorSpec, Params, Part, Placement, Rect } from './types'

/** Structural plywood, roughly 34 lb per cubic foot. */
const PLY_LB_PER_IN3 = 34 / 1728
const LIFT_DEPTH = 8

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
  return {
    floor: { shape: 'rect', width: 120, length: 96, notchW: 36, notchL: 36, frontEdge: 0 },
    finalHeight: 15,
    plyThickness: 0.75,
    tatamiThickness: 2,
    sheetW: 48,
    sheetL: 96,
    lumberLengths: [96, 120, 144],
    kerf: 0.125,
    binId: 'samla-22',
    bin: { w: mmToIn(390), d: mmToIn(280), h: mmToIn(280) },
    binLongAlongJoists: false,
    clearance: 0.5,
    joistStyle: 'builtup',
    drawerBoardT: 0.75,
    casterH: 2,
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
  return p.bin
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

const DRAWER_TOP_EXTRA = 2.25 // 1" above the box + 1-1/2" flat header + 1/4" spare, less the 1/2" hatch allowance

export function buildFloor(input: Params): Build {
  const p: Params = { ...input, bin: resolveBin(input) }
  const warnings: string[] = []
  const geometry = normalizeFloor(p.floor)
  if (geometry.error) warnings.push(`Floor shape problem: ${geometry.error}`)
  const layout = buildLayout(p)
  warnings.push(...layout.warnings)
  const ul = p.features.underlay ? p.underlayThickness : 0
  const heightIn = {
    finalHeight: p.finalHeight - ul,
    plyThickness: p.plyThickness,
    tatamiThickness: p.tatamiThickness,
    binH: p.features.drawers ? p.casterH + p.drawerBoardT + p.bin.h + DRAWER_TOP_EXTRA : p.bin.h,
    drawers: false,
    style: p.joistStyle,
  }
  let height = solveHeight(heightIn)
  if (p.features.drawers && !height.fits) {
    const raised = Math.ceil((height.minFinalHeight + ul) * 8) / 8
    warnings.push(`Final height raised from ${r3(p.finalHeight)}" to ${r3(raised)}" so the drawers fit (face flush with the frame, 1" above each drawer, 1/4" each side).`)
    height = solveHeight({ ...heightIn, finalHeight: raised - ul })
  }
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
    const frontT = sec.drawerFront ? 3.5 : sec.shareFront ? 0 : T
    sec.joistX.forEach((jx, k) => {
      const rim = k === 0 || k === n - 1
      const t = sec.joistT[k]
      const jy = rim ? rect.y : rect.y + frontT
      const jl = rim ? rect.l : rect.l - frontT - T
      placements.push({ kind: rim ? 'rim' : 'joist', x: jx, y: jy, z: bu, sx: t, sy: jl, sz: depth, ref: rim || sec.exact ? undefined : { s: sec.index, axis: 'x', k } })
      if (bu > 0) placements.push({ kind: 'buildup', x: jx, y: jy, z: 0, sx: t, sy: jl, sz: bu })
      joistLf += jl / 12
      deckScrewLen += jl
    })
    const rimCount = 2
    const divTotal = sec.joistX.length - 2
    const mult = p.reinforce.doubleJoists ? 2 : 1
    joistCount += rimCount + divTotal * mult
    crossLines += Math.max(0, ...sec.colBlocks.map((b) => b.length))
    supportPads += p.supportCount > 1 ? (rimCount + divTotal * mult) * p.supportCount : 0
    const jname = builtup ? 'Joist' : `Joist (${jointKey} on edge)`
    member(jname, rimCount, rect.l)
    if (divTotal > 0) member(jname + ' (interior, between front & back rims)', divTotal * mult, rect.l - frontT - T)
    for (const l of layers) {
      const qty = rimCount + divTotal * mult
      if (l.material.startsWith('ply-strip')) sheet('Frame', `Build-up strip (${l.name})`, l.t, qty, rect.l, 3.5, 'Glue + screw under each joist')
      else lumber('Frame', `Build-up strip (${l.name})`, l.material, qty, rect.l, 3.5, l.t, 'Glue + screw under each joist')
    }

    const nJ = sec.joistX.length
    const endL = sec.joistT[0]
    const innerW = rect.w - endL - sec.joistT[nJ - 1]
    const backY = rect.y + rect.l - T
    placements.push({ kind: 'rim', x: rect.x + endL, y: backY, z: bu, sx: innerW, sy: T, sz: depth })
    member('Back rim (between end joists)', 1, innerW, 4)
    if (sec.drawerFront) {
      placements.push({ kind: 'header', x: rect.x + endL, y: rect.y, z: S - 1.5, sx: innerW, sy: 3.5, sz: 1.5 })
      lumber('Frame', 'Drawer header (2x4 laid flat)', '2x4', 1, innerW, 3.5, 1.5, 'Sits flush under deck at the front opening', 4)
    } else if (!sec.shareFront) {
      placements.push({ kind: 'rim', x: rect.x + endL, y: rect.y, z: bu, sx: innerW, sy: T, sz: depth })
      member('Front rim (between end joists)', 1, innerW, 4)
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
  // a split cell steps down to the next smaller standard IKEA footprint (either way round) that really gives more bins
  const fitSplit = (rw: number, rl: number, have: number) => {
    const long = Math.max(layout.binX, layout.binY)
    for (const [l0, w0] of STANDARD_BIN_FOOTPRINTS_MM) {
      const l = mmToIn(l0)
      const w = mmToIn(w0)
      if (l >= long - 0.05) continue
      const opts = [{ sx: l, sy: w }, { sx: w, sy: l }].map((o) => ({ ...o, nx: Math.floor((rw + 1e-6) / (o.sx + clr)), ny: Math.floor((rl + 1e-6) / (o.sy + clr)) }))
      const best = opts.sort((a, b) => b.nx * b.ny - a.nx * a.ny)[0]
      if (best.nx * best.ny > have) return best
    }
    return undefined
  }
  const splitMode = (c: { key: string; w: number; l: number; binsX: number; binsY: number }) => (p.binSplit?.[c.key] && fitSplit(c.w, c.l, c.binsX * c.binsY) ? 'x' : undefined)
  let binCount = layout.cells.reduce((s, c) => s + c.binsX * c.binsY, 0)

  const slotPos = (start: number, size: number, n: number, item: number, k: number) => start + (size / n) * k + (size / n - item) / 2
  const pushSplit = (c: { index: number; binsX: number; binsY: number }, mode: 'x' | 'y', rx: number, rw: number, ry: number, rl: number, _nxFixed: number, _nyFixed: number, z: number) => {
    const { sx, sy, nx, ny } = fitSplit(rw, rl, c.binsX * c.binsY)!
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
  const bt = p.drawerBoardT
  const caster = p.casterH
  const faceH = Math.max(1, S - 1.5 - 1 - 0.125)
  const boxH = Math.max(bt + 1, S - 1.5 - 1 - caster)
  let casters = 0
  const bays: { cell: number; y: number; px0: number; px1: number; x0: number; x1: number; top: number }[] = []
  if (p.features.drawers) {
    for (const c of drawerCells) {
      binCount -= c.binsX * c.binsY
      const boxW = c.w - 2 * DRAWER_SIDE_GAP
      const boxLen = Math.max(1, c.l - bt - DRAWER_BACK_GAP)
      const L = boxLen + bt
      const bx = c.x + DRAWER_SIDE_GAP
      sheet('Drawers', 'Drawer side', bt, 2, L, boxH, 'Full length: overlaps the ends of the front and back; screw + glue through the side into their end grain')
      sheet('Drawers', 'Drawer front/back', bt, 2, boxW - 2 * bt, boxH, 'Fits between the sides. The front is screwed through from behind into the fascia cut-out piece')
      sheet('Drawers', 'Drawer bottom', bt, 1, boxW - 2 * bt, L - 2 * bt, 'Sits inside all four walls, flush with their bottom edges; screw + glue. Casters mount underneath')
      casters += 4
      const mk = (x: number, y: number, sx: number, sy: number, z: number, sz: number): Placement => ({ kind: 'drawer', x, y, z, sx, sy, sz, cell: c.index })
      placements.push(mk(bx, c.y, bt, L, caster, boxH), mk(bx + boxW - bt, c.y, bt, L, caster, boxH))
      placements.push(mk(bx + bt, c.y, boxW - 2 * bt, bt, caster, boxH), mk(bx + bt, c.y + L - bt, boxW - 2 * bt, bt, caster, boxH))
      placements.push(mk(bx + bt, c.y + bt, boxW - 2 * bt, L - 2 * bt, caster, bt))
      for (const wx of [bx + bt + 0.5, bx + boxW - bt - 1.3]) for (const wy of [c.y + bt + 1.5, c.y + L - bt - 3.5]) {
        placements.push({ kind: 'wheel', x: wx, y: wy, z: 0, sx: 0.8, sy: Math.min(2, caster), sz: caster, cell: c.index })
      }
      const sec = layout.sections[c.section]
      const kl = sec.joistX.findIndex((jx, k) => Math.abs(jx + sec.joistT[k] - c.x) < 0.05)
      const px0 = kl >= 0 ? sec.joistX[kl] + sec.joistT[kl] / 2 : c.x - T / 2
      const px1 = kl >= 0 && kl + 1 < sec.joistX.length ? sec.joistX[kl + 1] + sec.joistT[kl + 1] / 2 : c.x + c.w + T / 2
      bays.push({ cell: c.index, y: c.y, px0, px1, x0: Math.max(px0, c.x + 0.125 - 0.5), x1: Math.min(px1, c.x + c.w - 0.125 + 0.5), top: 0.125 + faceH + 0.5 })
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
      const horiz = e.y1 === e.y2
      const base = {
        kind: 'trim' as const,
        z: 0,
        sx: horiz ? e.length : th,
        sy: horiz ? th : e.length,
        sz: fullH,
        x: horiz ? Math.min(e.x1, e.x2) : e.side === 'left' ? e.x1 - th : e.x1,
        y: horiz ? (e.side === 'front' ? e.y1 - th : e.y1) : Math.min(e.y1, e.y2),
      }
      const mine = e.isFront && p.features.drawers ? bays.filter((b) => Math.abs(b.y - e.y1) < 0.01).sort((m, n) => m.px0 - n.px0) : []
      if (!mine.length) {
        sheet('Edge trim', `Side panel - ${e.side}`, th, 1, e.length, fullH, '3/4" plywood, ripped to cover frame + deck edge')
        placements.push(base)
        continue
      }
      const end = base.x + base.sx
      const plain = (a: number, b: number) => {
        if (b - a < 1e-3) return
        sheet('Edge trim', 'Front fascia filler piece', th, 1, b - a, fullH, 'Plain panel between drawer pieces; seams land on a joist centre')
        placements.push({ ...base, x: a, sx: b - a })
      }
      let cursor = base.x
      for (const b of mine) {
        const a0 = Math.max(cursor, b.px0)
        const a1 = Math.min(end, b.px1)
        plain(cursor, a0)
        const ow = b.x1 - b.x0
        sheet('Edge trim', 'Front fascia piece with drawer opening', th, 1, a1 - a0, fullH, `Joist centre to joist centre. Cut an opening ${r3(ow)}" wide x ${r3(b.top)}" tall from the bottom edge, 1/2" beyond the drawer face each side and 1/2" above it`)
        sheet('Edge trim', 'Drawer front (cut-out piece of the fascia)', th, 1, ow, b.top, 'The piece cut from the fascia opening IS the drawer front: screw it to the front of the drawer box, 1/2" reveal around it')
        placements.push({ ...base, kind: 'cutout', x: b.x0, sx: ow, sz: b.top, cell: b.cell })
        if (b.x0 > a0 + 1e-6) placements.push({ ...base, x: a0, sx: b.x0 - a0 })
        if (b.top < fullH - 1e-6) placements.push({ ...base, x: b.x0, sx: ow, z: b.top, sz: fullH - b.top })
        if (a1 > b.x1 + 1e-6) placements.push({ ...base, x: b.x1, sx: a1 - b.x1 })
        cursor = a1
      }
      plain(cursor, end)
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
      const zi = liftZones.indexOf(z)
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
      next.push({ kind: 'lift', x: z.x + 0.125, y: z.y + 0.125, z: bodyBottom, sx: z.w - 0.25, sy: z.l - 0.25, sz: S - bodyBottom, lift: zi })
      next.push({ kind: 'lift', x: z.x + 0.125, y: z.y + 0.125, z: S + p.plyThickness, sx: z.w - 0.25, sy: z.l - 0.25, sz: p.tatamiThickness, lift: zi })
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
  if (casters) hardware.push({ name: `Caster wheels, ${r3(p.casterH)}" tall overall (your own)`, qty: casters, unit: 'pcs', notes: '4 per drawer; screw to the underside of the drawer bottom' })
  if (liftZones.length) hardware.push({ name: `Motorized lift table, ${r3(p.tatamiShort)}" square (electric, purchased)`, qty: liftZones.length, unit: 'pcs', notes: `Needs about ${LIFT_DEPTH}" of depth below the deck for the retracted table and motor, plus a power feed and control` })
  if (drawerCells.length) hardware.push({ name: 'Drawer pulls', qty: drawerCells.length, unit: 'pcs' })
  const smallBins = placements.filter((q) => q.kind === 'bin' && q.split)
  if (smallBins.length) hardware.push({ name: `Smaller bins, about ${r3(smallBins[0].sx)}" x ${r3(smallBins[0].sy)}" x ${r3(p.bin.h)}" (purchased; sized to fit)`, qty: smallBins.length, unit: 'pcs', notes: 'Split bins: pick the nearest standard size that fits each half' })
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
    p.features.drawers ? 'Build the plywood drawer boxes, fit the casters, roll them into the front bays and screw the faces on with even 1/8" gaps.' : '',
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
