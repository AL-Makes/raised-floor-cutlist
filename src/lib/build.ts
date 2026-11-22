import { STANDARD_BIN_FOOTPRINTS_MM } from './bins'
import { mmToIn } from './units'
import { insetForTrim, normalizeFloor, type FloorGeometry, type PolyEdge } from './geometry'
import { CHORD_T, solveHeight, type HeightOption, type HeightSolution } from './height'
import { buildLayout, DRAWER_BACK_GAP, DRAWER_SIDE_GAP, WEB_OC, type Layout } from './layout'
import { planLumber, planSheets, type LumberPlan, type SheetPlan } from './optimize'
import { planPlywood, snapSeams } from './deck'
import { tatamiFit } from './tatami'
import type { FloorSpec, Params, Part, Placement, Rect } from './types'

/** Structural plywood, roughly 34 lb per cubic foot. */
const PLY_LB_PER_IN3 = 34 / 1728
const LIFT_DEPTH = 12.4 // compressed column height
const LIFT_BASE_T = 0.75 // 3/4" plywood base plate under the motorized column
const LIFT_TRAVEL = 16.5
const LIFT_COL = 6 // column footprint, square
const LIFT_FILLER_COL = 12 // 12" x 12" filler column between the compacted column top and the table top

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
    clearance: 2,
    joistStyle: 'builtup',
    drawerBoardT: 0.75,
    casterH: 2,
    maxSpacing: 24,
    features: { drawers: false, hatches: false, edgeTrim: false, acousticStrips: false, underlay: false },
    underlayThickness: 0.25,
    trimSides: { front: true, back: true, left: true, right: true },
    reinforce: { doubleJoists: false },
    heightOption: 0,
    webOc: WEB_OC,
    peopleAdj: 0,
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
    prices: {},
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
  /** set when the drawers need more height than the final-height slider allows */
  raisedHeight?: number
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

const DRAWER_CLEAR = 6 // preferred gap from drawer box top to top of supports; shrinks (box stays bin-height) when the height is tight
const DRAWER_TOP_EXTRA = 2.25 // minimum: 1" above the box + 1-1/2" header + 1/4" spare, less the 1/2" hatch allowance

export function buildFloor(input: Params): Build {
  const p: Params = { ...input, bin: resolveBin(input) }
  if (p.features.edgeTrim) p.floor = insetForTrim(p.floor, p.trimSides, 0.75)
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
  let raisedHeight: number | undefined
  if (p.features.drawers && !height.fits) {
    const raised = Math.ceil((height.minFinalHeight + ul) * 8) / 8
    warnings.push(`Final height raised from ${r3(p.finalHeight)}" to ${r3(raised)}" so the drawers fit (face flush with the frame, " between the top of each drawer box and the top of the supports, 1/4" each side).`)
    raisedHeight = raised
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

  const MAX_RUN = 96
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
    if (group === 'Frame' && length > MAX_RUN + 0.01) {
      const nPieces = Math.ceil(length / MAX_RUN)
      qty *= nPieces
      length = length / nPieces
      notes = (notes ? notes + ' - ' : '') + `Over 8 ft, so spliced from ${nPieces} pieces: stagger the splices and join with a 2x4 sister or plywood gusset`
    }
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
  const webOc = p.webOc > 0 ? p.webOc : WEB_OC
  /** one frame member: a solid board on edge, or two flat 2x4 chords with vertical 2x4 webs pocket-screwed between them */
  const member = (name: string, qty: number, length: number, solidPk = 0) => {
    if (qty <= 0 || length <= 0) return
    if (!builtup) return lumber('Frame', name, jointKey, qty, length, option?.joist.d ?? depth, 1.5, ripNote, solidPk)
    const webs = Math.max(2, Math.ceil(length / webOc) + 1)
    lumber('Frame', `${name} - top & bottom chord (2x4 flat)`, '2x4', qty * 2, length, 3.5, 1.5, 'Run the full length: one on top, one on the bottom')
    lumber('Frame', `${name} - vertical web (2x4)`, '2x4', qty * webs, Math.max(0.5, S - 2 * CHORD_T), 3.5, 1.5, `Pocket-screw to top and bottom chord, about ${webOc}" apart`, 4)
  }
  const ripNote = option?.ripTo ? `Rip to ${option.ripTo.toFixed(3)}" wide` : undefined

  layout.sections.forEach((sec) => {
    const { rect } = sec
    const n = sec.joistX.length
    const frontT = sec.drawerFront ? 3.5 : sec.shareFront ? 0 : T
    const sharedEdge = layout.sections.filter((o) => o !== sec && Math.abs(o.joistX[o.joistX.length - 1] + o.joistT[o.joistT.length - 1] - sec.joistX[0]) < 0.05).reduce((a, o) => a + Math.max(0, Math.min(o.rect.y + o.rect.l, sec.rect.y + sec.rect.l) - Math.max(o.rect.y, sec.rect.y)), 0) >= sec.rect.l - 0.05
    const inner = Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 1)
    const dCells = layout.cells.filter((c) => c.section === sec.index && c.type === 'drawer')
    const touches = (k: number) => dCells.some((c) => Math.abs(c.x + c.w - sec.joistX[k]) < 0.1 || Math.abs(c.x - (sec.joistX[k] + sec.joistT[k])) < 0.1)
    const drawerIdx = sec.drawerFront ? [0, ...inner, n - 1].filter((k) => !(k === 0 && sharedEdge) && touches(k)) : []
    sec.joistX.forEach((jx, k) => {
      const rim = k === 0 || k === n - 1
      if (k === 0 && sharedEdge) return
      const t = sec.joistT[k]
      const drawerJoist = drawerIdx.includes(k)
      const jy = drawerJoist || rim ? rect.y : rect.y + frontT
      const jl = drawerJoist || rim ? rect.l : rect.l - frontT - T
      placements.push({ kind: rim ? 'rim' : 'joist', x: jx, y: jy, z: bu, sx: t, sy: jl, sz: drawerJoist ? depth - 1.5 : depth, ref: rim || sec.exact ? undefined : { s: sec.index, axis: 'x', k } })
      if (bu > 0) placements.push({ kind: 'buildup', x: jx, y: jy, z: 0, sx: t, sy: jl, sz: bu })
      joistLf += jl / 12
      deckScrewLen += jl
    })
    const placedEnds = [0, n - 1].filter((k) => !(k === 0 && sharedEdge))
    const rimLens = placedEnds.filter((k) => !drawerIdx.includes(k)).map(() => rect.l)
    const rimCount = placedEnds.length
    const divTotal = inner.length
    const mult = p.reinforce.doubleJoists ? 2 : 1
    joistCount += rimCount + divTotal * mult
    crossLines += Math.max(0, ...sec.colBlocks.map((b) => b.length))
    supportPads += p.supportCount > 1 ? (rimCount + divTotal * mult) * p.supportCount : 0
    const jname = builtup ? 'Joist' : `Joist (${jointKey} on edge)`
    rimLens.forEach((len) => member(jname, 1, len))
    if (sec.drawerFront) {
      if (drawerIdx.length) member(jname + ' (drawer support, front face to back rim)', drawerIdx.length * mult, rect.l)
    }
    const stdInner = inner.filter((k) => !drawerIdx.includes(k)).length
    if (stdInner > 0) member(jname + ' (interior, between front & back rims)', stdInner * mult, rect.l - frontT - T)
    const frontRims = sec.drawerFront ? placedEnds.filter((k) => !drawerIdx.includes(k)).length : 0
    if (frontRims) lumber('Frame', 'Front end vertical web (2x4, end support at the front face)', '2x4', frontRims * mult, Math.max(0.5, S - 2 * CHORD_T), 3.5, 1.5, 'Full-height web at the front end of an end support, pocket-screwed to both chords', 4)
    if (drawerIdx.length) {
      const dTotal = drawerIdx.length
      const capL = rect.l - 3.5
      drawerIdx.forEach((k) => {
        const jx = sec.joistX[k]
        placements.push({ kind: 'header', x: jx + sec.joistT[k] / 2 - 1.75, y: rect.y + 3.5, z: S - 1.5, sx: 3.5, sy: capL, sz: 1.5 })
      })
      lumber('Frame', 'Drawer support cap (2x4 laid flat on top of each drawer support)', '2x4', dTotal * mult, capL, 3.5, 1.5, 'Screw down into the joist; carries the plywood above the drawers. The joist is cut 1-1/2" shorter in height under it', 4)
      lumber('Frame', 'Drawer support extra vertical web (2x4)', '2x4', dTotal * mult, Math.max(0.5, S - 2 * CHORD_T), 3.5, 1.5, 'One extra web in each drawer support, near the front face, pocket-screwed to both chords', 4)
    }
    if (sec.drawerFront) {
      const frames: { x: number; w: number }[] = []
      for (let k = 0; k < n - 1; k++) {
        const x0 = sec.joistX[k] + sec.joistT[k]
        const xs = k === 0 && sharedEdge ? rect.x : x0
        const w = sec.joistX[k + 1] - xs
        if (w > 0.5 && !dCells.some((c) => Math.abs(c.x - x0) < 0.1)) frames.push({ x: xs, w })
      }
      const vh = Math.max(0.5, S - 1.5 - 1.5)
      frames.forEach((fr) => {
        placements.push({ kind: 'web', x: fr.x, y: rect.y, z: bu, sx: fr.w, sy: 3.5, sz: 1.5 })
        placements.push({ kind: 'web', x: fr.x, y: rect.y, z: bu + 1.5, sx: 1.5, sy: 3.5, sz: vh })
        placements.push({ kind: 'web', x: fr.x + fr.w - 1.5, y: rect.y, z: bu + 1.5, sx: 1.5, sy: 3.5, sz: vh })
      })
      if (frames.length) {
        lumber('Frame', 'Front frame bottom rail (2x4 laid flat, under the front header over a non-drawer bay)', '2x4', frames.length, frames.reduce((a, x) => a + x.w, 0) / frames.length, 3.5, 1.5, 'Hangs between the supports; screw into the support faces', 4)
        lumber('Frame', 'Front frame vertical (2x4, at each end of a non-drawer bay front)', '2x4', frames.length * 2, vh, 3.5, 1.5, 'Two verticals plus the bottom rail and the header make a closed frame', 4)
      }
    }
    for (const l of layers) {
      const qty = rimCount + divTotal * mult
      if (l.material.startsWith('ply-strip')) sheet('Frame', `Build-up strip (${l.name})`, l.t, qty, rect.l, 3.5, 'Glue + screw under each joist')
      else lumber('Frame', `Build-up strip (${l.name})`, l.material, qty, rect.l, 3.5, l.t, 'Glue + screw under each joist')
    }

    const nJ = sec.joistX.length
    const endL = sharedEdge || drawerIdx.includes(0) ? 0 : sec.joistT[0]
    const innerW = rect.w - endL - (drawerIdx.includes(nJ - 1) ? 0 : sec.joistT[nJ - 1])
    const backY = rect.y + rect.l - T
    const runPieces = (between = false): { x: number; len: number }[] => {
      const x0 = rect.x + endL
      const segs: number[][] = []
      if (between && drawerIdx.length) {
        let st = 0
        for (const k of drawerIdx) { const a = sec.joistX[k] - x0; if (a > st + 0.01) segs.push([st, a]); st = a + sec.joistT[k] }
        if (innerW > st + 0.01) segs.push([st, innerW])
      } else if (innerW <= MAX_RUN + 0.01) segs.push([0, innerW])
      else {
        const cuts = sec.joistX.slice(1, -1).map((jx, i) => jx + sec.joistT[i + 1] / 2 - x0)
        // equal pieces: each splice goes on the joist nearest the even division point, unless that would leave a piece over 8 ft
        const n = Math.ceil(innerW / MAX_RUN - 0.0001)
        let start = 0
        for (let k = 1; k < n; k++) {
          const ideal = (innerW * k) / n
          const ok = cuts.filter((c) => c - start > 0.01 && c - start <= MAX_RUN + 0.01 && innerW - c <= (n - k) * MAX_RUN + 0.01)
          const cut = ok.length ? ok.reduce((a, c) => (Math.abs(c - ideal) < Math.abs(a - ideal) ? c : a)) : ideal
          segs.push([start, cut])
          start = cut
        }
        segs.push([start, innerW])
      }
      return segs.flatMap(([a, b]) => {
        const nP = Math.max(1, Math.ceil((b - a) / MAX_RUN - 0.0001))
        return Array.from({ length: nP }, (_, k) => ({ x: a + (k * (b - a)) / nP, len: (b - a) / nP }))
      })
    }
    const splitRun = (name: string, pk: number, mk: (nm: string, q: number, len: number, pk: number) => void, between = false) => {
      const pcs = runPieces(between)
      pcs.forEach((pc) => mk(pcs.length > 1 ? name + ' (spliced over a joist)' : name, 1, pc.len, pk))
    }
    const pushRun = (kind: string, y: number, z: number, sy: number, sz: number, between = false) => {
      runPieces(between).forEach((pc) => placements.push({ kind, x: rect.x + endL + pc.x, y, z, sx: pc.len, sy, sz } as never))
    }
    pushRun('rim', backY, bu, T, depth, true)
    splitRun('Back rim (between end joists)', 4, member, true)
    if (sec.drawerFront) {
      pushRun('header', rect.y, S - 1.5, 3.5, 1.5)
      splitRun('Drawer header (2x4 laid flat)', 4, (nm, q, len, pk) => lumber('Frame', nm, '2x4', q, len, 3.5, 1.5, 'Sits flush under deck at the front opening', pk))
    } else if (!sec.shareFront) {
      pushRun('rim', rect.y, bu, T, depth)
      splitRun('Front rim (between end joists)', 4, member)
    }
    sec.cols.forEach((col, ci) => {
      const ext = sharedEdge && ci === 0 ? sec.joistT[0] : 0
      sec.colBlocks[ci].forEach((by, bk) => {
        placements.push({ kind: 'block', x: col.x - ext, y: by, z: bu, sx: col.w + ext, sy: T, sz: depth, ref: sec.colRows[ci]?.[0]?.drawer && bk === 0 ? undefined : { s: sec.index, axis: 'y', k: bk, c: ci } })
        member('Cross member', 1, col.w + ext, 4)
        deckScrewLen += col.w + ext
      })
    })
  })

  for (let i = placements.length - 1; i >= 0; i--) {
    const q = placements[i]
    if (!['joist', 'rim', 'buildup', 'block'].includes(q.kind) || q.sy <= MAX_RUN + 0.01) continue
    const nP = Math.ceil(q.sy / MAX_RUN)
    const len = q.sy / nP
    const pcs = Array.from({ length: nP }, (_, k) => ({ ...q, y: q.y + k * len, sy: len }))
    placements.splice(i, 1, ...pcs)
  }

  const deck = planPlywood(layout, { sheetL: p.sheetL, sheetW: p.sheetW, serviceFillers: p.fillerAccess ?? [] })
  // a sheet seam that would land between supports gets its own backing block so every panel edge sits on a support centre
  const seamBlocks = new Map<string, number>()
  for (const u of deck.unsupported) {
    const sec = layout.sections[u.section]
    if (!sec) { unsupportedSeams.push(u); continue }
    const r = sec.rect
    const k = `${u.axis}${Math.round(u.pos * 4)}`
    if (seamBlocks.has(k)) continue
    seamBlocks.set(k, 1)
    if (u.axis === 'y') placements.push({ kind: 'block', x: r.x + T, y: u.pos - T / 2, z: bu, sx: r.w - 2 * T, sy: T, sz: depth })
    else placements.push({ kind: 'block', x: u.pos - T / 2, y: r.y + T, z: bu, sx: T, sy: r.l - 2 * T, sz: depth })
    member('Plywood seam backing block', 1, (u.axis === 'y' ? r.w : r.l) - 2 * T, 4)
  }  const ply = p.plyThickness
  const supportsNow = placements.filter((q) => q.kind === 'joist' || q.kind === 'block' || q.kind === 'rim' || q.kind === 'buildup').map((q) => ({ x: q.x, y: q.y, w: q.sx, l: q.sy }))
  for (const q of snapSeams(deck.panels, supportsNow)) {
    const lift = q.kind === 'lift'
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
    placements.push({ kind: lift ? 'hatch' : 'deck', x: q.x, y: q.y, z: S, sx: q.w, sy: q.l, sz: ply })
    heaviest = Math.max(heaviest, q.w * q.l * ply * PLY_LB_PER_IN3)
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
  const boxH = Math.max(bt + 1, Math.min(S - DRAWER_CLEAR - caster, S - 2.5 - caster) , Math.min(bt + p.bin.h + 0.25, S - 2.5 - caster))
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
        placements.push({ ...base, x: a, sx: b - a, seamless: true })
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
        if (b.x0 > a0 + 1e-6) placements.push({ ...base, x: a0, sx: b.x0 - a0, seamless: true })
        if (b.top < fullH - 1e-6) placements.push({ ...base, x: b.x0, sx: ow, z: b.top, sz: fullH - b.top, seamless: true })
        if (a1 > b.x1 + 1e-6) placements.push({ ...base, x: b.x1, sx: a1 - b.x1, seamless: true })
        cursor = a1
      }
      plain(cursor, end)
    }
  }

  const liftZones = p.liftTables.map((l) => ({ x: l.x, y: l.y, w: p.tatamiShort, l: p.tatamiShort }))
  if (liftZones.length) {
    const hit = (q: { x: number; y: number; sx: number; sy: number }, z: Rect) =>
      q.x < z.x + z.w - 0.01 && q.x + q.sx > z.x + 0.01 && q.y < z.y + z.l - 0.01 && q.y + q.sy > z.y + 0.01
    // the pocket frame occupies a ring of one member thickness around each opening, so supports and bins stop at its outer edge
    const ringZones = liftZones.map((z) => ({ x: z.x - T, y: z.y - T, w: z.w + 2 * T, l: z.l + 2 * T }))
    const next: Placement[] = []
    for (const q of placements) {
      if (q.kind === 'bin') {
        if (ringZones.some((z) => hit(q, z))) {
          binCount--
          continue
        }
      } else if (q.kind === 'joist' || q.kind === 'block' || q.kind === 'buildup' || q.kind === 'deck' || q.kind === 'rim') {
        let pieces = [q]
        for (const z of q.kind === 'deck' ? liftZones : ringZones) pieces = pieces.flatMap((pc) => (hit(pc, z) ? subtractRect(pc, z) : [pc]))
        next.push(...pieces)
        continue
      }
      next.push(q)
    }
    const inFloor = (x: number, y: number) => geometry.rects.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.l)
    let sides = 0
    let ends = 0
    let riserBlocks = 0
    let riserH = 0
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
        // never let the frame overhang the floor outline
        const fr = geometry.rects.find((r) => m.x + m.sx / 2 > r.x && m.x + m.sx / 2 < r.x + r.w && m.y + m.sy / 2 > r.y && m.y + m.sy / 2 < r.y + r.l)!
        const mx0 = Math.max(m.x, fr.x)
        const my0 = Math.max(m.y, fr.y)
        const mx1 = Math.min(m.x + m.sx, fr.x + fr.w)
        const my1 = Math.min(m.y + m.sy, fr.y + fr.l)
        if (mx1 - mx0 < 0.01 || my1 - my0 < 0.01) continue
        next.push({ kind: 'rim', x: mx0, y: my0, z: bu, sx: mx1 - mx0, sy: my1 - my0, sz: depth })
        if (m.side) sides++
        else ends++
      }
      const cx0 = z.x + (z.w - LIFT_COL) / 2
      const cy0 = z.y + (z.l - LIFT_COL) / 2
      // 36x36x3/4" plywood base plate on the floor that the motorized column bolts onto
      next.push({ kind: 'lift', x: z.x, y: z.y, z: 0, sx: z.w, sy: z.l, sz: LIFT_BASE_T, lift: zi })
      sheet('Deck', `Lift column base plate (${r3(LIFT_BASE_T)}" ply)`, LIFT_BASE_T, 1, z.w, z.l, `Rests in the ${r3(z.w)}" x ${r3(z.l)}" pocket; the motorized column base bolts onto this plate`)
      // column: fixed 6" sleeve plus the telescoping stage sitting on the 3/4" base plate
      const colTop = LIFT_BASE_T + LIFT_DEPTH
      next.push({ kind: 'lift', x: cx0, y: cy0, z: LIFT_BASE_T, sx: LIFT_COL, sy: LIFT_COL, sz: LIFT_DEPTH, lift: zi })
      next.push({ kind: 'lift', x: cx0 + 0.25, y: cy0 + 0.25, z: LIFT_BASE_T, sx: LIFT_COL - 0.5, sy: LIFT_COL - 0.5, sz: LIFT_DEPTH, lift: zi })
      // 12x12" filler column between the compacted column top and the underside of the plywood table top (height determined by overall structure height)
      const gapH = S - colTop
      if (gapH > 0.01) {
        const fx0 = z.x + (z.w - LIFT_FILLER_COL) / 2
        const fy0 = z.y + (z.l - LIFT_FILLER_COL) / 2
        next.push({ kind: 'lift', x: fx0, y: fy0, z: colTop, sx: LIFT_FILLER_COL, sy: LIFT_FILLER_COL, sz: gapH, lift: zi })
        riserBlocks++
        riserH = gapH
      }
      // plywood table top flush with the surrounding deck layer, plus 36x36 tatami mat on top
      next.push({ kind: 'lift', x: z.x, y: z.y, z: S, sx: z.w, sy: z.l, sz: p.plyThickness, lift: zi })
      next.push({ kind: 'lift', x: z.x, y: z.y, z: S + p.plyThickness, sx: z.w, sy: z.l, sz: p.tatamiThickness, lift: zi, liftMat: true })
      sheet('Deck', `Lift table top (${r3(p.plyThickness)}" ply)`, p.plyThickness, 1, z.w, z.l, `Flush with the deck layer; carries the ${r3(p.tatamiShort)}" x ${r3(p.tatamiShort)}" tatami mat`)
    }
    placements.splice(0, placements.length, ...next)
    if (riserBlocks) {
      member(`Lift column top filler (${LIFT_FILLER_COL}" x ${LIFT_FILLER_COL}" column, 2x4)`, riserBlocks * 4, riserH, 4)
    }
    member('Lift pocket frame (side, along joists)', sides, p.tatamiShort, 4)
    member('Lift pocket frame (end, across)', ends, p.tatamiShort + 2 * T, 4)
    warnings.push(
      `${liftZones.length} motorized lift table(s): joists, cross blocks and the plywood are cut back around each ${r3(p.tatamiShort)}" opening and framed by the pocket frame; cut the members full length and trim on site. Bins cannot sit under a table, and front drawers are laid out across the front width left beside it.`,
    )
    if (S < LIFT_BASE_T + LIFT_DEPTH) warnings.push(`The lift column + ${r3(LIFT_BASE_T)}" base plate is ${r3(LIFT_BASE_T + LIFT_DEPTH)}" tall when compressed, but the support height below the deck is only ${r3(S)}". Raise the final height.`)
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
  if (liftZones.length) hardware.push({ name: `Motorized lift table, ${r3(p.tatamiShort)}" square (electric, purchased)`, qty: liftZones.length, unit: 'pcs', notes: `${LIFT_COL}" x ${LIFT_COL}" column, ${LIFT_DEPTH}" compressed, ${LIFT_TRAVEL}" travel. Bolts onto a ${r3(p.tatamiShort)}" x ${r3(p.tatamiShort)}" x ${r3(LIFT_BASE_T)}" plywood base plate; a ${LIFT_FILLER_COL}" x ${LIFT_FILLER_COL}" top filler column bridges the column top to the underside of the plywood table top. Needs a power feed and control` })
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
  if (serviceCells.length) warnings.push(`${serviceCells.length} heavy-load cell(s) under the plywood filler: extra blocking, no bins/drawers, not accessible once screwed down.`)
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
      ? `Build each joist as a ladder: lay the bottom chord flat, pocket-screw the webs upright about ${webOc}" apart (one at each end), then pocket-screw the top chord on. Make all joists identical.`
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
    raisedHeight,
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
