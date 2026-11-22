import { describe, expect, it } from 'vitest'
import { defaultParams, buildFloor, floorEdges, splitAxis } from './build'
import { closeOutline, moveCorner, moveEdge, normalizeFloor, setEdgeLength, validatePolygon } from './geometry'
import { solveHeight } from './height'
import { buildLayout, divide, floorRects } from './layout'
import { planLumber, planSheets } from './optimize'
import { analyze, plyCapacity } from './structural'
import { matSchedule, suggestTatami } from './tatami'
import { formatInches, parseImperial, parseLength } from './units'

describe('units', () => {
  it('parses carpenter input', () => {
    expect(parseImperial('38 1/2')).toBeCloseTo(38.5)
    expect(parseImperial("3' 2")).toBeCloseTo(38)
    expect(parseImperial('1/2')).toBeCloseTo(0.5)
    expect(parseImperial('abc')).toBeNaN()
    expect(parseLength('254', 'metric')).toBeCloseTo(10)
  })
  it('formats fractions', () => {
    expect(formatInches(38.5)).toBe('38 1/2"')
    expect(formatInches(0.0625)).toBe('1/16"')
    expect(formatInches(11.99999)).toBe('12"')
  })
})

describe('height solver', () => {
  const base = { plyThickness: 0.75, tatamiThickness: 2, binH: 5.5, drawers: false }
  it('hits the exact support height', () => {
    // 12 - 0.75 - 2 = 9.25 -> 2x10 on edge
    const s = solveHeight({ ...base, finalHeight: 12 })
    expect(s.target).toBeCloseTo(9.25)
    expect(s.fits).toBe(true)
    expect(s.options[0].achieved).toBeCloseTo(9.25)
    expect(s.options.every((o) => Math.abs(o.error) <= 1 / 16)).toBe(true)
  })
  it('stacks flat layers on a 2x4 for 5" support', () => {
    const s = solveHeight({ ...base, finalHeight: 7.75 + 0, binH: 1 })
    expect(s.target).toBeCloseTo(5)
    const o = s.options.find((x) => x.joist.key === '2x4' && x.layers.length === 1)
    expect(o?.layers[0].t).toBe(1.5)
  })
  it('flags bins that do not fit', () => {
    const s = solveHeight({ ...base, finalHeight: 8, binH: 11 })
    expect(s.fits).toBe(false)
    expect(s.minFinalHeight).toBeCloseTo(11.5 + 2.75)
  })
  it('needs more height with drawers', () => {
    const a = solveHeight({ ...base, finalHeight: 12 })
    const b = solveHeight({ ...base, finalHeight: 12, drawers: true })
    expect(b.required).toBeGreaterThan(a.required)
  })
})

describe('layout', () => {
  it('divides a span into bin cells', () => {
    const d = divide(120, 16, 1.5)
    expect(d.n).toBe(6)
    expect(d.cell).toBeGreaterThanOrEqual(16)
    expect(d.n * d.cell + (d.n - 1) * 1.5 + 3).toBeCloseTo(120)
  })
  it('splits an L-shape into two rectangles', () => {
    const p = { ...defaultParams(), floor: { shape: 'L' as const, width: 120, length: 96, notchW: 36, notchL: 36 } }
    const r = floorRects(p)
    expect(r).toHaveLength(2)
    expect(r[0].w * r[0].l + r[1].w * r[1].l).toBe(120 * 96 - 36 * 36)
    expect(floorEdges(p.floor)).toHaveLength(6)
  })
  it('every cell fits the bin', () => {
    const l = buildLayout(defaultParams())
    expect(l.cells.length).toBeGreaterThan(0)
    expect(l.cells.every((c) => c.fitsBin)).toBe(true)
  })
  it('reports a cell too small for the bin', () => {
    const p = { ...defaultParams(), floor: { shape: 'rect' as const, width: 15, length: 96, notchW: 0, notchL: 0 } }
    expect(buildLayout(p).warnings.length).toBeGreaterThan(0)
  })
})

describe('cut list', () => {
  it('produces frame and deck parts, with no access hatches (deck lifts whole)', () => {
    const b = buildFloor(defaultParams())
    const groups = new Set(b.parts.map((x) => x.group))
    expect(groups.has('Frame')).toBe(true)
    expect(groups.has('Deck')).toBe(true)
    expect(groups.has('Access hatches')).toBe(false)
  })
  it('deck panels cover the floor area', () => {
    const b = buildFloor(defaultParams())
    const area = b.parts.filter((x) => x.group === 'Deck').reduce((s, x) => s + x.qty * x.length * x.width, 0)
    expect(area).toBeCloseTo(120 * 96, 0)
    expect(b.parts.filter((x) => x.group === 'Deck').every((x) => x.length <= 96 && x.width <= 48)).toBe(true)
  })
  it('features change the cut list', () => {
    const base = buildFloor(defaultParams())
    const p = defaultParams()
    p.features = { drawers: true, hatches: false, edgeTrim: true,     acousticStrips: true, underlay: false }
    p.finalHeight = 14
    p.drawerKind = 'built'
    const b = buildFloor(p)
    expect(b.parts.some((x) => x.group === 'Drawers')).toBe(true)
    expect(b.parts.some((x) => x.group === 'Edge trim')).toBe(true)
    expect(b.parts.some((x) => x.name.startsWith('Drawer header'))).toBe(true)
    expect(b.hardware.some((h) => h.name.startsWith('Drawer slides'))).toBe(true)
    expect(base.parts.some((x) => x.group === 'Drawers')).toBe(false)
  })
  it('underlay adds a sheet layer and lowers the frame', () => {
    const base = buildFloor(defaultParams())
    const p = defaultParams()
    p.features = { ...p.features, underlay: true }
    const b = buildFloor(p)
    expect(b.placements.some((q) => q.kind === 'underlay')).toBe(true)
    expect(b.hardware.some((h) => h.name.startsWith('Acoustic underlay'))).toBe(true)
    const top = (x: typeof b) => Math.max(...x.placements.filter((q) => q.kind !== 'underlay').map((q) => q.z + q.sz))
    expect(top(b)).toBeCloseTo(top(base), 1)
  })
  it('doubling joists adds joists', () => {
    const count = (b: ReturnType<typeof buildFloor>) =>
      b.parts.filter((x) => x.name.startsWith('Joist')).reduce((s, x) => s + x.qty, 0)
    const p = defaultParams()
    const a = count(buildFloor(p))
    p.reinforce.doubleJoists = true
    expect(count(buildFloor(p))).toBeGreaterThan(a)
  })
  it('splitAxis snaps seams to supports', () => {
    const r = splitAxis(120, [0.75, 20, 40, 60, 90, 118], 96, 96)
    expect(r.cuts).toEqual([90, 120])
    expect(r.unsupported).toHaveLength(0)
  })
})

describe('optimizer', () => {
  const part = (len: number, qty: number) => ({
    id: '1', group: 'g', name: 'n', kind: 'lumber' as const, material: '2x4', qty, length: len, width: 3.5, thickness: 1.5,
  })
  it('packs lumber without exceeding stock length', () => {
    const plan = planLumber('2x4', [part(45, 4), part(30, 3)], [96], 0.125)
    for (const b of plan.boards) expect(b.used).toBeLessThanOrEqual(96 + 1e-9)
    expect(plan.boards.reduce((s, b) => s + b.cuts.length, 0)).toBe(7)
    expect(plan.boards.length).toBe(3)
  })
  it('reports pieces too long for stock', () => {
    expect(planLumber('2x4', [part(200, 1)], [96, 120], 0.125).unfit).toEqual([200])
  })
  it('packs sheets', () => {
    const sp = { ...part(47, 4), kind: 'sheet' as const, width: 23.9 }
    const plan = planSheets('ply', [sp], 96, 48, 0.125)
    expect(plan.sheets).toHaveLength(1)
    expect(plan.unfit).toHaveLength(0)
  })
})

describe('structural', () => {
  it('thicker plywood is stronger and wider spans are weaker', () => {
    expect(plyCapacity(0.75, 16).psf).toBeGreaterThan(plyCapacity(0.5, 16).psf)
    expect(plyCapacity(0.75, 24).psf).toBeLessThan(plyCapacity(0.75, 16).psf)
  })
  it('flags weak thin ply and suggests thicker', () => {
    const p = defaultParams()
    p.plyThickness = 0.5
    p.binId = 'samla-45'
    const s = analyze(buildFloor(p))
    expect(s.cells.some((c) => c.status !== 'ok')).toBe(true)
    const sug = s.suggestions.find((x) => x.id === 'thicker-ply')
    expect(sug?.apply?.(p).plyThickness).toBeGreaterThan(0.5)
  })
  it('default design is ok', () => {
    const s = analyze(buildFloor(defaultParams()))
    expect(s.cells.every((c) => c.status === 'ok')).toBe(true)
  })
})

describe('tatami', () => {
  const rects = [{ x: 0, y: 0, w: 144, l: 108 }]
  it('tiles a 12x9 ft floor exactly with no cuts, covering all area', () => {
    const res = suggestTatami(rects, { tatamiLong: 72, tatamiShort: 36 })
    expect(res.length).toBeGreaterThanOrEqual(5)
    for (const a of res) {
      const area = a.mats.reduce((s, m) => s + m.w * m.l, 0)
      expect(area).toBeCloseTo(144 * 108, 1)
    }
    expect(res[0].counts.cut).toBe(0)
  })
  it('brick pattern avoids four-corner joints', () => {
    const res = suggestTatami(rects, { tatamiLong: 72, tatamiShort: 36 })
    expect(res.find((r) => r.id === 'brick')!.fourCorner).toBe(0)
    expect(res.find((r) => r.id === 'rows')!.fourCorner).toBeGreaterThan(0)
  })
  it('uses cut mats on awkward sizes and covers L-shapes', () => {
    const l = [{ x: 0, y: 0, w: 100, l: 50 }, { x: 0, y: 50, w: 60, l: 40 }]
    const res = suggestTatami(l, { tatamiLong: 72, tatamiShort: 36 })
    for (const a of res) {
      expect(a.mats.reduce((s, m) => s + m.w * m.l, 0)).toBeCloseTo(100 * 50 + 60 * 40, 1)
      expect(a.counts.cut).toBeGreaterThan(0)
    }
    expect(matSchedule(res[0].mats).reduce((s, r) => s + r.qty, 0)).toBe(res[0].mats.length)
  })
  it('anchors the layout to a corner or centers it, always covering the floor', () => {
    const l = [{ x: 0, y: 0, w: 100, l: 50 }, { x: 0, y: 50, w: 60, l: 40 }]
    for (const tatamiAnchor of ['bl', 'br', 'tl', 'tr', 'center'] as const) {
      for (const a of suggestTatami(l, { tatamiLong: 72, tatamiShort: 36, tatamiAnchor }))
        expect(a.mats.reduce((s, m) => s + m.w * m.l, 0)).toBeCloseTo(100 * 50 + 60 * 40, 1)
    }
    const c = suggestTatami([{ x: 0, y: 0, w: 100, l: 72 }], { tatamiLong: 72, tatamiShort: 36, tatamiAnchor: 'center' }).find((r) => r.id === 'rows')!
    const xs = c.mats.map((m) => m.x)
    expect(Math.min(...xs)).toBe(0)
    const left = c.mats.find((m) => m.x === 0)!.w
    const right = c.mats.reduce((s, m) => (m.x + m.w > 99.9 ? m.w : s), 0)
    expect(left).toBeCloseTo(right, 1)
    const br = suggestTatami([{ x: 0, y: 0, w: 100, l: 72 }], { tatamiLong: 72, tatamiShort: 36, tatamiAnchor: 'br' }).find((r) => r.id === 'rows')!
    expect(br.mats.find((m) => m.x + m.w > 99.9)!.w).toBe(72)
  })
})

describe('polygon floors, front edge, deck and tatami fit', () => {
  const U = [    { x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 72, y: 96 },
    { x: 72, y: 48 }, { x: 0, y: 48 },
  ]
  it('decomposes a polygon and rotates so the chosen edge is the front', () => {
    const g = normalizeFloor({ shape: 'poly', width: 0, length: 0, notchW: 0, notchL: 0, poly: U, frontEdge: 0 })
    expect(g.error).toBeUndefined()
    expect(g.rects.reduce((s, r) => s + r.w * r.l, 0)).toBeCloseTo(120 * 48 + 48 * 48)
    const g2 = normalizeFloor({ shape: 'poly', width: 0, length: 0, notchW: 0, notchL: 0, poly: U, frontEdge: 1 })
    expect(g2.front!.x2 - g2.front!.x1).toBeCloseTo(96)
    expect(g2.area).toBeCloseTo(g.area)
  })
  it('rejects slanted shapes and edits edge lengths', () => {
    expect(validatePolygon([{ x: 0, y: 0 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 0, y: 50 }])).toMatch(/slanted/)
    const out = setEdgeLength(U, 0, 100)
    expect(out[1].x).toBe(100)
    expect(validatePolygon(out)).toBeUndefined()
  })
  it('joist/cross adjustments change counts', () => {
    const base = buildFloor(defaultParams())
    const more = buildFloor({ ...defaultParams(), joistAdjust: 1, crossAdjust: 1 })
    expect(more.jointCount.joists).toBeGreaterThan(base.jointCount.joists)
    expect(more.jointCount.crossJoists).toBeGreaterThan(base.jointCount.crossJoists)
  })
  it('uses few deck panels from 4x8 sheets', () => {
    const b = buildFloor({ ...defaultParams(), floor: { shape: 'rect', width: 96, length: 48, notchW: 0, notchL: 0 } })
    expect(b.deckPanels).toBeLessThanOrEqual(2)
    expect(b.heaviestPanelLb).toBeGreaterThan(0)
  })
  it('flags floors too small for one tatami mat, and pinwheel avoids grid crossings', () => {
    const small = buildFloor({ ...defaultParams(), floor: { shape: 'rect', width: 30, length: 30, notchW: 0, notchL: 0 } })
    expect(small.tatamiFits).toBe(false)
    expect(small.warnings.join(' ')).toContain('not large enough to accommodate at least one tatami mat')
    const opts = suggestTatami([{ x: 0, y: 0, w: 216, l: 216 }], { tatamiLong: 72, tatamiShort: 36 })
    expect(opts.find((o) => o.id === 'pinwheel')!.fourCorner).toBeLessThan(opts.find((o) => o.id === 'squares')!.fourCorner)
  })
  it('recommends more support when the structure is weak', () => {
    const b = buildFloor({ ...defaultParams(), joistStyle: 'solid', supportCount: 2, floor: { shape: 'rect', width: 120, length: 192, notchW: 0, notchL: 0 } })
    const s = analyze(b)
    expect(s.issues.some((i) => /supports are recommended/.test(i.text))).toBe(true)
  })
})



describe('dragging walls and ready-made drawers', () => {
  const rect = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }]
  it('moves a wall sideways and stretches its neighbours', () => {
    const out = moveEdge(rect, 1, 12)
    expect(out[1].x).toBe(132)
    expect(out[2].x).toBe(132)
    expect(validatePolygon(out)).toBeUndefined()
  })
  it('moves a corner and keeps every angle at 90 degrees', () => {
    const out = moveCorner(rect, 2, 10, -6)
    expect(out[2]).toEqual({ x: 130, y: 90 })
    expect(out[1]).toEqual({ x: 130, y: 0 })
    expect(out[3]).toEqual({ x: 0, y: 90 })
    expect(validatePolygon(out)).toBeUndefined()
  })
  it('closes a drawn outline into a valid right-angled shape', () => {
    // split walls (collinear points) and a last point that is not aligned with the start
    const open = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 40, y: 96 }]
    const closed = closeOutline(open)
    expect(validatePolygon(closed)).toBeUndefined()
    expect(closed).toHaveLength(4)
    const L = closeOutline([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 48 }, { x: 60, y: 48 }, { x: 60, y: 96 }])
    expect(validatePolygon(L)).toBeUndefined()
    expect(L).toHaveLength(6)
  })
  it('ready-made drawers sit 1/4" off each joist and the deck over them stops at the middle of the next cross joist', () => {
    const base = defaultParams()
    const p = { ...base, features: { ...base.features, drawers: true }, drawerKind: 'ikea' as const }
    const b = buildFloor(p)
    const sec = b.layout.sections[0]
    const dr = b.placements.filter((q) => q.kind === 'drawer')
    expect(dr.length).toBeGreaterThan(0)
    for (const d of dr) {
      const left = sec.joistX.findIndex((jx, k) => Math.abs(jx + sec.joistT[k] - (d.x - 0.25)) < 1e-6)
      expect(left).toBeGreaterThanOrEqual(0)
      expect(sec.joistX[left + 1]).toBeCloseTo(d.x + d.sx + 0.25)
    }
    const cross = sec.blockY[0] + b.layout.joistW / 2
    const front = b.placements.filter((q) => q.kind === 'deck' && Math.abs(q.y - sec.rect.y) < 1e-6 && q.x < sec.rect.x + sec.rect.w - 1e-6)
    expect(front.length).toBeGreaterThan(0)
    for (const f of front) expect(f.y + f.sy).toBeCloseTo(cross)
  })
  it('sizes joist spacing from an IKEA rolling box and drops the drawer cut parts', () => {
    const base = defaultParams()
    const p = { ...base, finalHeight: 20, features: { ...base.features, drawers: true }, drawerKind: 'ikea' as const, rollingBox: { id: 'x', w: 24, d: 36, h: 8 } }
    const lay = buildLayout(p)
    expect(lay.cellMinX).toBeCloseTo(36 + p.clearance)
    const b = buildFloor(p)
    expect(b.parts.some((x) => x.name === 'Drawer side')).toBe(false)
    expect(b.hardware.some((h) => /rolling box/i.test(h.name))).toBe(true)
  })
})

describe('built-up joists', () => {
  it('uses top and bottom 2x4 chords with vertical 2x4 webs cut to the frame height', () => {
    const b = buildFloor({ ...defaultParams(), finalHeight: 16 })
    const chords = b.parts.filter((x) => /top & bottom chord/.test(x.name) && /^Joist/.test(x.name))
    const webs = b.parts.filter((x) => /^Joist - vertical web/.test(x.name))
    expect(chords[0].material).toBe('2x4')
    expect(chords[0].qty % 2).toBe(0)
    expect(webs[0].length).toBeCloseTo(b.height.target - 3)
    expect(b.layout.joistW).toBe(3.5)
  })
  it('makes joists 3-1/2 inches thick so fewer cells fit than with solid boards', () => {
    const solid = buildLayout({ ...defaultParams(), joistStyle: 'solid' })
    const built = buildLayout(defaultParams())
    expect(built.cells.length).toBeLessThanOrEqual(solid.cells.length)
  })
})

describe('motorized lift tables', () => {
  it('cuts a pocket: removes bins under the table, frames it and adds hardware', () => {
    const base = buildFloor({ ...defaultParams(), finalHeight: 15 })
    const lifted = buildFloor({ ...defaultParams(), finalHeight: 15, liftTables: [{ x: 36, y: 36 }] })
    expect(lifted.binCount).toBeLessThan(base.binCount)
    expect(lifted.placements.filter((q) => q.kind === 'lift')).toHaveLength(2)
    expect(lifted.hardware.some((h) => h.name.includes('Motorized lift table'))).toBe(true)
    expect(lifted.parts.some((x) => x.name.includes('Lift pocket frame'))).toBe(true)
    expect(lifted.placements.some((q) => q.kind === 'bin' && q.x < 72 && q.x + q.sx > 36 && q.y < 72 && q.y + q.sy > 36)).toBe(false)
  })
  it('lets the table take the front row and shares the remaining front width among drawers', () => {
    const p = { ...defaultParams(), finalHeight: 15, features: { ...defaultParams().features, drawers: true } }
    const b = buildFloor({ ...p, liftTables: [{ x: 36, y: 0 }] })
    const drawers = b.layout.cells.filter((c) => c.type === 'drawer')
    expect(drawers.length).toBeGreaterThan(0)
    expect(drawers.every((c) => c.x + c.w <= 36.01 || c.x >= 71.99)).toBe(true)
  })
})

describe('manual joist moves', () => {
  it('moving a cross joist changes only adjacent rows', () => {
    const p = defaultParams()
    const a = buildFloor(p).layout.sections[0]
    const k = Math.floor(a.blockY.length / 2)
    const b = buildFloor({ ...p, moves: { ['0:y:' + k]: 0.25 } }).layout.sections[0]
    expect(b.blockY[k]).toBeCloseTo(a.blockY[k] + 0.25, 3)
    expect(b.blockY.length).toBe(a.blockY.length)
    b.blockY.forEach((y, i) => { if (i !== k) expect(y).toBeCloseTo(a.blockY[i], 3) })
  })
})
