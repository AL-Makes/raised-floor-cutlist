import { describe, expect, it } from 'vitest'
import { defaultParams, buildFloor, floorEdges, splitAxis } from './build'
import { closeOutline, moveCorner, moveEdge, normalizeFloor, setEdgeLength, validatePolygon } from './geometry'
import { solveHeight } from './height'
import { buildLayout, divide, floorRects } from './layout'
import { planLumber, planSheets } from './optimize'
import { analyze, crowdScenario, maxWebOc, plyCapacity } from './structural'
import { matSchedule, suggestTatami } from './tatami'
import { estimateWeight } from './weight'
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
        const b = buildFloor(p)
    expect(b.parts.some((x) => x.group === 'Drawers')).toBe(true)
    expect(b.parts.some((x) => x.group === 'Edge trim')).toBe(true)
    expect(b.parts.some((x) => x.name.startsWith('Drawer header'))).toBe(true)
    expect(b.hardware.some((h) => h.name.startsWith('Caster'))).toBe(true)
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
    expect(b.deckPanels).toBeLessThanOrEqual(6)
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
    const b = buildFloor({ ...defaultParams(), joistStyle: 'solid', supportCount: 2, floor: { shape: 'rect', width: 120, length: 288, notchW: 0, notchL: 0 } })
    const s = analyze(b)
    expect(s.issues.some((i) => /supports are recommended/.test(i.text))).toBe(true)
  })
})



describe('dragging walls and plywood drawers', () => {
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
  const boxes = (b: ReturnType<typeof buildFloor>) => {
    const m = new Map<number, { x: number; y: number; z: number; sx: number; sy: number; sz: number }>()
    for (const q of b.placements.filter((k) => k.kind === 'drawer')) {
      const o = m.get(q.cell!)
      if (!o) { m.set(q.cell!, { x: q.x, y: q.y, z: q.z, sx: q.sx, sy: q.sy, sz: q.sz }); continue }
      const x0 = Math.min(o.x, q.x), y0 = Math.min(o.y, q.y), z0 = Math.min(o.z, q.z)
      m.set(q.cell!, { x: x0, y: y0, z: z0, sx: Math.max(o.x + o.sx, q.x + q.sx) - x0, sy: Math.max(o.y + o.sy, q.y + q.sy) - y0, sz: Math.max(o.z + o.sz, q.z + q.sz) - z0 })
    }
    return [...m.values()]
  }
  const drawerP = () => {
    const base = defaultParams()
    return { ...base, features: { ...base.features, drawers: true, edgeTrim: true } }
  }
  it('plywood drawers fill the joist bay with 1" clear at each side and the back, front flush', () => {
    const b = buildFloor(drawerP())
    const sec = b.layout.sections[0]
    const dr = boxes(b)
    expect(dr.length).toBeGreaterThan(0)
    for (const d of dr) {
      const left = sec.joistX.findIndex((jx, k) => Math.abs(jx + sec.joistT[k] - (d.x - 1)) < 1e-6)
      expect(left).toBeGreaterThanOrEqual(0)
      expect(sec.joistX[left + 1]).toBeCloseTo(d.x + d.sx + 1)
      const cell = b.layout.cells.find((c) => c.type === 'drawer' && Math.abs(c.x + 1 - d.x) < 1e-6)!
      expect(cell.y + cell.l - (d.y + d.sy)).toBeCloseTo(1)
      expect(d.z).toBeCloseTo(2)
    }
    expect(b.placements.some((q) => q.kind === 'bin' && q.sz > 0 && b.layout.cells.some((c) => c.type === 'drawer' && c.index === q.cell))).toBe(false)
    expect(b.hardware.find((h) => /Caster/.test(h.name))?.qty).toBe(dr.length * 4)
  })
  it('lets you pick which front bays get a drawer', () => {
    const all = buildFloor(drawerP())
    const bays = all.layout.cells.filter((c) => c.drawerBay)
    const b = buildFloor({ ...drawerP(), drawerOff: { [bays[0].key]: true } })
    expect(boxes(b)).toHaveLength(boxes(all).length - 1)
    expect(b.placements.filter((q) => q.kind === 'cutout')).toHaveLength(boxes(all).length - 1)
    expect(b.placements.some((q) => q.kind === 'bin' && q.cell === bays[0].index)).toBe(true)
    const sec = b.layout.sections[0]
    const ws = sec.cols.map((c) => c.w)
    expect(ws[0]).toBeLessThan(ws[1])
    expect(sec.cols[ws.length - 1].x + ws[ws.length - 1] + sec.joistT[ws.length]).toBeCloseTo(sec.rect.x + sec.rect.w)
    ws.slice(1).forEach((w) => expect(w).toBeCloseTo(ws[1]))
  })
  it('keeps the drawer row joists independent of the joists behind the cross joist', () => {
    const b = buildFloor(drawerP())
    const [front, rear] = b.layout.sections
    expect(front.drawerFront).toBe(true)
    expect(rear.drawerFront).toBe(false)
    expect(rear.rect.y).toBeCloseTo(front.rect.y + front.rect.l)
    expect(rear.joistX.length).not.toBe(front.joistX.length)
    const shared = front.rect.y + front.rect.l
    const inner = b.placements.filter((q) => q.kind === 'joist' && Math.abs(q.y - shared) < 1e-6)
    expect(inner.length).toBeGreaterThan(0)
    const area = b.placements.filter((q) => q.kind === 'deck' || q.kind === 'hatch').reduce((s, q) => s + q.sx * q.sy, 0)
    const floor = b.layout.sections.reduce((s, x) => s + x.rect.w * x.rect.l, 0)
    expect(area).toBeCloseTo(floor, 0)
  })
  it('uses the board thickness for the drawer parts', () => {
    const b = buildFloor({ ...drawerP(), drawerBoardT: 0.5 })
    expect(b.parts.filter((x) => x.group === 'Drawers').every((x) => x.thickness === 0.5)).toBe(true)
  })
  it('raises the height so the drawer face is flush with the frame and the box has 1" above it', () => {
    const b = buildFloor({ ...drawerP(), finalHeight: 8 })
    expect(b.warnings.some((w) => /raised/i.test(w))).toBe(true)
    const d = boxes(b)[0]
    const f = b.placements.find((q) => q.kind === 'cutout')!
    const hdr = b.placements.find((q) => q.kind === 'header' && q.sx > 4)
    expect(hdr!.y).toBeCloseTo(d.y)
    expect(hdr!.z - (f.z + f.sz)).toBeGreaterThanOrEqual(0.5 - 1e-6)
    expect(hdr!.z - (d.z + d.sz)).toBeGreaterThanOrEqual(1 - 1e-6)
  })
  it('drawer supports reach the front face under the header, with a 2x4 cap and one extra web', () => {
    const b = buildFloor(drawerP())
    const sec = b.layout.sections[0]
    const hdr = b.placements.find((q) => q.kind === 'header' && q.sx > 4)!
    const js = b.placements.filter((q) => (q.kind === 'joist' || q.kind === 'rim') && Math.abs(q.y - sec.rect.y) < 1e-6 && q.sy > 10 && q.x >= sec.rect.x - 1e-6 && q.x < sec.rect.x + sec.rect.w - 1e-6)
    expect(js.length).toBe(sec.joistX.length)
    js.forEach((j) => expect(j.z + j.sz).toBeLessThanOrEqual(hdr.z + 1e-6))
    expect(b.placements.filter((q) => q.kind === 'header' && q.sx === 3.5 && q.y > sec.rect.y && q.y < sec.rect.y + 5 && q.x >= sec.rect.x - 1e-6 && q.x < sec.rect.x + sec.rect.w - 1e-6).length).toBe(js.length)
    expect(b.parts.some((i) => i.name.startsWith('Drawer support extra vertical web'))).toBe(true)
  })
  it('cuts the front fascia in joist-centre to joist-centre pieces, each with a drawer opening', () => {
    const b = buildFloor(drawerP())
    const sec = b.layout.sections[0]
    const faces = boxes(b)
    const cuts = b.placements.filter((q) => q.kind === 'cutout')
    expect(cuts).toHaveLength(faces.length)
    cuts.forEach((c) => expect(c.z).toBe(0))
    const pieces = b.parts.filter((x) => x.name === 'Front fascia piece with drawer opening')
    expect(pieces.reduce((s, x) => s + x.qty, 0)).toBe(faces.length)
    const centres = sec.joistX.map((jx, k) => jx + sec.joistT[k] / 2)
    const w = pieces[0].length
    expect(centres.some((c0) => centres.some((c1) => Math.abs(c1 - c0 - w) < 0.01))).toBe(true)
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
    const base = buildFloor({ ...defaultParams(), finalHeight: 20 })
    const lifted = buildFloor({ ...defaultParams(), finalHeight: 20, liftTables: [{ x: 36, y: 36 }] })
    expect(lifted.binCount).toBeLessThan(base.binCount)
    const liftParts = lifted.placements.filter((q) => q.kind === 'lift')
    const basePlate = liftParts.find((q) => Math.abs(q.z) < 0.01 && Math.abs(q.sz - 0.75) < 0.01 && Math.abs(q.sx - 36) < 0.01 && Math.abs(q.sy - 36) < 0.01)!
    expect(basePlate).toBeDefined()
    const col = liftParts.find((q) => Math.abs(q.sz - 12.4) < 0.01 && Math.abs(q.sx - 6) < 0.01)!
    expect(col.z).toBeCloseTo(0.75, 2)
    const top = liftParts.find((q) => q.sx >= 35.9 && q.z > col.z && !q.liftMat)!
    const mat = liftParts.find((q) => q.liftMat)!
    expect(top.sx).toBeCloseTo(36, 2)
    expect(top.sy).toBeCloseTo(36, 2)
    expect(mat.sx).toBeCloseTo(36, 2)
    expect(mat.sy).toBeCloseTo(36, 2)
    expect(mat.z).toBeCloseTo(top.z + top.sz, 2)
    const filler = liftParts.find((q) => Math.abs(q.sx - 6) < 0.01 && Math.abs(q.z - (col.z + col.sz)) < 0.01)!
    expect(filler).toBeDefined()
    expect(filler.z + filler.sz).toBeCloseTo(top.z, 2)
    expect(lifted.parts.some((x) => x.name.includes('Lift column base plate'))).toBe(true)
    expect(lifted.parts.some((x) => x.name.includes('Lift column top filler blocking'))).toBe(true)
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

describe('lift table support geometry', () => {
  const ov = (a: any, b: any) => a.x < b.x + b.sx - 0.01 && a.x + a.sx > b.x + 0.01 && a.y < b.y + b.sy - 0.01 && a.y + a.sy > b.y + 0.01 && a.z < b.z + b.sz - 0.01 && a.z + a.sz > b.z + 0.01
  it('frame, joists, blocks and rims never overlap and stay inside the floor', () => {
    for (const [x, y] of [[36, 36], [0, 0], [36, 0], [20, 50], [72, 36]]) {
      for (const drawers of [false, true]) {
        const d = defaultParams()
        const b = buildFloor({ ...d, finalHeight: 20, features: { ...d.features, drawers }, liftTables: [{ x, y }] })
        const st = b.placements.filter((q) => ['joist', 'block', 'buildup', 'rim'].includes(q.kind))
        for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) expect(ov(st[i], st[j])).toBe(false)
        for (const q of st) expect(q.x).toBeGreaterThanOrEqual(-0.01)
        for (const q of b.placements.filter((q) => q.kind === 'bin' || q.kind === 'drawer')) for (const s of st) expect(ov(q, s)).toBe(false)
      }
    }
  })
})
describe('drawer back support stays in drawer bays', () => {
  it('no bay under a filler gets a drawer row or its back joist', () => {
    for (const w of [139.25, 120, 100]) {
      const p = defaultParams()
      const b = buildFloor({ ...p, features: { ...p.features, drawers: true }, rects: undefined as never, width: w } as never)
      b.layout.sections.forEach((s) =>
        s.colRows.forEach((rows, ci) => {
          const svc = b.layout.cells.some((c) => c.section === s.index && c.type === 'service' && c.x >= s.cols[ci].x - 0.01 && c.x < s.cols[ci].x + s.cols[ci].w && c.y < s.rect.y + 1)
          if (svc) expect(rows[0].drawer).toBe(false)
        })
      )
    }
  })
})

describe('split bins', () => {
  it('splits a bin cell to the next smaller standard IKEA size and recombines', () => {
    const p = defaultParams()
    const b0 = buildFloor(p)
    const cell = b0.layout.cells.find((c) => c.type === 'bin' && c.binsX > 0)!
    const bins0 = b0.placements.filter((q) => q.kind === 'bin' && q.cell === cell.index)
    const b1 = buildFloor({ ...p, binSplit: { [cell.key]: 'x' } })
    const bins1 = b1.placements.filter((q) => q.kind === 'bin' && q.cell === cell.index)
    expect(bins1.length).toBeGreaterThan(bins0.length)
    bins1.forEach((q) => expect(Math.max(q.sx, q.sy)).toBeLessThan(Math.max(b0.layout.binX, b0.layout.binY)))
    expect(b1.binCount).toBe(b0.binCount - bins0.length + bins1.length)
    expect(buildFloor({ ...p, binSplit: {} }).binCount).toBe(b0.binCount)
  })
})

describe('per-bay cross joists', () => {
  it('adding one joist keeps the existing joists where they are', () => {
    const p = { ...defaultParams(), crossAdjust: -3 }
    p.floor = { ...p.floor, length: 120 }
    const a = buildFloor(p).layout.sections[0].colBlocks[1]
    const b = buildFloor({ ...p, colAdjust: { '0:1': 1 } }).layout.sections[0].colBlocks[1]
    expect(b.length).toBe(a.length + 1)
    a.forEach((y) => expect(b.some((v) => Math.abs(v - y) < 1e-6)).toBe(true))
  })
  it('adding or removing a cross joist only changes its own bay; main joists stay continuous', () => {
    const p = defaultParams()
    const a = buildFloor(p).layout.sections[0]
    for (const d of [1, -1]) {
      const b = buildFloor({ ...p, colAdjust: { '0:1': d } })
      const s = b.layout.sections[0]
      expect(s.colBlocks[1].length).toBe(a.colBlocks[1].length + d)
      s.colBlocks.forEach((cb, i) => { if (i !== 1) expect(cb).toEqual(a.colBlocks[i]) })
      expect(s.joistX).toEqual(a.joistX)
      b.layout.sections.slice(1).forEach((o, i) => expect(o.colBlocks).toEqual(buildFloor(p).layout.sections[i + 1].colBlocks))
    }
  })
})

describe('filler service zones', () => {
  it('puts no bins or drawers under filler pieces', () => {
    const b = buildFloor(defaultParams())
    const svc = b.layout.cells.filter((c) => c.type === 'service')
    if (b.layout.fillers.length === 0) return
    expect(svc.length).toBeGreaterThan(0)
    svc.forEach((c) => expect(c.binsX * c.binsY).toBe(0))
    expect(b.placements.some((x) => x.kind === 'service')).toBe(false)
  })
  it('added joists never land inside a filler strip', () => {
    const one = buildFloor({ ...defaultParams(), colAdjust: { '0:0': 1 } })
    const base = buildFloor(defaultParams())
    expect(one.layout.sections[0].colBlocks[0].length).toBe(base.layout.sections[0].colBlocks[0].length + 1)
    one.layout.sections.slice(1).forEach((s, i) => expect(s.blockY.length).toBe(base.layout.sections[i + 1].blockY.length))
  })
  it('cross joists can be added and removed inside the filler (fixed) sections too', () => {
    const base = buildFloor(defaultParams())
    const si = base.layout.sections.findIndex((x) => x.fixed)
    expect(si).toBeGreaterThanOrEqual(0)
    const sec = base.layout.sections[si]
    const st = sec.colStretches![0]
    const blocks = (ns: number[]) => buildFloor({ ...defaultParams(), fixedCounts: { [si + ':0']: ns } }).layout.sections[si].colBlocks[0]
    const dflt = blocks(st.map((r) => r.n))
    expect(dflt.length).toBe(st.length - 1 + st.filter((r) => r.n > 0).reduce((a, r) => a + r.n, 0))
    const i = st.findIndex((r) => r.ok)
    const two = blocks(st.map((r, k) => (k === i ? 2 : r.n)))
    expect(two.length).toBe(dflt.length + 1)
    const none = blocks(st.map((r, k) => (k === i ? 0 : r.n)))
    expect(none.length).toBe(dflt.length - 1)
    const inside = two.filter((y) => y > st[i].y && y < st[i].y + st[i].l)
    expect(inside.length).toBe(2)
    expect(Math.abs((inside[0] - st[i].y) - (st[i].y + st[i].l - inside[1])) < inside[1] - inside[0]).toBe(true)
  })
  it('deck under filler pieces matches them, is fixed and cannot be an access panel', () => {
    const b = buildFloor(defaultParams())
    expect(b.layout.fillers.length).toBeGreaterThan(0)
    const f = b.layout.fillers[0]
    const under = b.placements.filter((q) => q.kind === 'deck' && Math.abs(q.x - f.x) < 2 && Math.abs(q.y - f.y) < 2)
    expect(under.length).toBeGreaterThan(0)
    expect(b.parts.some((i) => i.name.startsWith('Heavy-load reinforcing ply'))).toBe(false)
  })
  it('cutting a filler at its joist makes one maintenance lift-out; mats stay accessible', () => {
    const base = buildFloor(defaultParams())
    const acc = buildFloor({ ...defaultParams(), fillerAccess: [0] })
    expect(base.placements.filter((q) => q.kind === 'hatch').length).toBe(0)
    expect(acc.placements.filter((q) => q.kind === 'hatch').length).toBeGreaterThan(0)
    expect(acc.parts.some((x) => x.name.startsWith('Maintenance lift-out'))).toBe(true)
    expect(base.parts.some((x) => x.name.startsWith('Accessible deck panel'))).toBe(true)
  })
  it('filler sections have joists only at the filler edges and plywood seams on joist centrelines', () => {
    const b = buildFloor(defaultParams())
    const back = b.layout.sections.find((s) => s.fixed && s.rect.y > 0)!
    expect(back.joistX.length).toBe(3)
    const T = b.layout.joistW
    const cx = new Set<number>()
    const cy = new Set<number>()
    for (const s of b.layout.sections) {
      s.joistX.forEach((x, k) => cx.add(Math.round((x + s.joistT[k] / 2) * 100)))
      s.blockY.forEach((y) => cy.add(Math.round((y + T / 2) * 100)))
      cx.add(Math.round(s.rect.x * 100)); cx.add(Math.round((s.rect.x + s.rect.w) * 100))
      cy.add(Math.round(s.rect.y * 100)); cy.add(Math.round((s.rect.y + s.rect.l) * 100))
    }
    for (const q of b.placements.filter((x) => x.kind === 'deck')) {
      for (const x of [q.x, q.x + q.sx]) expect(cx.has(Math.round(x * 100))).toBe(true)
      for (const y of [q.y, q.y + q.sy]) expect(cy.has(Math.round(y * 100))).toBe(true)
    }
  })
  it('a service filler lifts out whole, edge to edge on its joists', () => {
    const b = buildFloor({ ...defaultParams(), fillerAccess: [2] })
    const hatch = b.placements.filter((q) => q.kind === 'hatch')
    expect(hatch.length).toBe(1)
    expect(hatch[0].sx).toBeGreaterThan(60)
    expect(hatch[0].sy).toBeGreaterThan(20)
  })
  it('filler strip is unaffected by joist adjust', () => {
    const b = buildFloor({ ...defaultParams(), joistAdjust: 1 })
    for (const f of b.layout.fillers) {
      for (const s of b.layout.sections) {
        s.joistX.forEach((x, k) => {
          if (k === 0 || k === s.joistX.length - 1) return
          const inside = x > f.x + 1 && x < f.x + f.w - 1 && s.rect.y < f.y + f.l && s.rect.y + s.rect.l > f.y
          if (inside) expect(s.cols.length).toBe(s.joistX.length - 1)
        })
      }
    }
    const base = buildFloor(defaultParams()).layout.cells.filter((c) => c.type === 'service').length
    expect(b.layout.cells.filter((c) => c.type === 'service').length).toBe(base)
  })
})

describe('plywood seams', () => {
  it('only land on joists or blocks, and follow joist removal', () => {
    for (const adj of [0, -2]) {
      const d = defaultParams()
      const b = buildFloor({ ...d, joistAdjust: adj } as typeof d)
      const T = b.layout.joistW
      for (const q of b.placements.filter((p) => p.kind === 'deck' || p.kind === 'hatch')) {
        const sec = b.layout.sections.find((s) => q.x >= s.rect.x - 0.5 && q.x < s.rect.x + s.rect.w - 0.5 && q.y >= s.rect.y - 0.5 && q.y < s.rect.y + s.rect.l - 0.5)!
        const xs = [sec.rect.x, sec.rect.x + sec.rect.w, ...sec.joistX.map((x, k) => x + sec.joistT[k] / 2)]
        const ys = [sec.rect.y, sec.rect.y + sec.rect.l, ...sec.blockY.map((y) => y + T / 2)]
        for (const x of [q.x, q.x + q.sx]) expect(xs.some((c) => Math.abs(c - x) < T) || x < 0.5 || x > Math.max(...b.layout.sections.map((s) => s.rect.x + s.rect.w)) - 0.5).toBe(true)
        for (const y of [q.y, q.y + q.sy]) expect(ys.some((c) => Math.abs(c - y) < T) || y < 0.5 || y > Math.max(...b.layout.sections.map((s) => s.rect.y + s.rect.l)) - 0.5).toBe(true)
      }
    }
  })
})

describe('plywood coverage', () => {
  it('covers the whole floor when a filler edge has no joist', () => {
    const d = defaultParams()
    const b = buildFloor({ ...d, floor: { ...d.floor, shape: 'poly', poly: [{ x: 0, y: 0 }, { x: 139.25, y: 0 }, { x: 139.25, y: 73 }, { x: 0, y: 73 }] }, finalHeight: 15, joistStyle: 'builtup', features: { ...d.features, drawers: true } } as typeof d)
    const total = b.layout.sections.reduce((s, c) => s + c.rect.w * c.rect.l, 0)
    const area = b.placements.filter((q) => q.kind === 'deck' || q.kind === 'hatch').reduce((s, q) => s + q.sx * q.sy, 0)
    expect(area).toBeCloseTo(total, 0)
  })
})


describe('drawer supports and header', () => {
  it('keeps the special cap support between every drawer even when bin columns line up, with one continuous header per 8 ft', () => {
    const p = { ...defaultParams(), floor: { shape: 'poly' as const, width: 120, length: 73, notchW: 36, notchL: 36, frontEdge: 0, poly: [{ x: 0, y: 0 }, { x: 105, y: 0 }, { x: 105, y: 73 }, { x: 0, y: 73 }] }, features: { ...defaultParams().features, drawers: true }, finalHeight: 20 }
    const b = buildFloor(p)
    expect(b.parts.some((x) => /drawer support cap/i.test(x.name))).toBe(true)
    const headers = b.placements.filter((q) => q.kind === 'header' && q.sx > 20 && q.y < 0.1)
    expect(headers.length).toBe(2)
    expect(Math.max(...headers.map((q) => q.sx))).toBeLessThanOrEqual(96.01)
  })
})

describe('frame members never overlap', () => {
  it.each([false, true])('drawers=%s', (drawers) => {
    const p = { ...defaultParams(), floor: { shape: 'poly' as const, width: 136, length: 73, notchW: 36, notchL: 36, frontEdge: 0, poly: [{ x: 0, y: 0 }, { x: 136, y: 0 }, { x: 136, y: 73 }, { x: 0, y: 73 }] }, features: { ...defaultParams().features, drawers }, finalHeight: 20 }
    const f = buildFloor(p).placements.filter((q) => ['rim', 'joist', 'block', 'header', 'web'].includes(q.kind))
    let bad = 0
    for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) {
      const a = f[i], c = f[j]
      if (Math.min(a.x + a.sx, c.x + c.sx) - Math.max(a.x, c.x) > 0.05 && Math.min(a.y + a.sy, c.y + c.sy) - Math.max(a.y, c.y) > 0.05 && Math.min(a.z + a.sz, c.z + c.sz) - Math.max(a.z, c.z) > 0.05) bad++
    }
    expect(bad).toBe(0)
  })
})

describe('joists not touching a drawer', () => {
  it('are standard supports and never overlap', () => {
    const base = { ...defaultParams(), floor: { shape: 'poly' as const, width: 120, length: 73, notchW: 36, notchL: 36, frontEdge: 0, poly: [{ x: 0, y: 0 }, { x: 136, y: 0 }, { x: 136, y: 73 }, { x: 0, y: 73 }] }, features: { ...defaultParams().features, drawers: true }, finalHeight: 20 }
    const all = buildFloor(base)
    const keys = all.layout.cells.filter((c) => c.drawerBay).map((c) => c.key)
    const first = keys.slice(0, 1)
    const one = buildFloor({ ...base, drawerOff: Object.fromEntries(keys.filter((k) => !first.includes(k)).map((k) => [k, true])) })
    const capsAll = all.parts.filter((x) => /drawer support cap/i.test(x.name)).reduce((a, x) => a + x.qty, 0)
    const capsOne = one.parts.filter((x) => /drawer support cap/i.test(x.name)).reduce((a, x) => a + x.qty, 0)
    expect(capsOne).toBe(2)
    expect(capsOne).toBeLessThan(capsAll)
    const f = one.placements.filter((q) => ['rim', 'joist', 'block', 'header', 'web'].includes(q.kind))
    let bad = 0
    for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) {
      const a = f[i], c = f[j]
      if (Math.min(a.x + a.sx, c.x + c.sx) - Math.max(a.x, c.x) > 0.05 && Math.min(a.y + a.sy, c.y + c.sy) - Math.max(a.y, c.y) > 0.05 && Math.min(a.z + a.sz, c.z + c.sz) - Math.max(a.z, c.z) > 0.05) bad++
    }
    expect(bad).toBe(0)
  })
})

describe('edge trim toggle keeps the design', () => {
  it('does not collapse into plywood filler when the trim shrinks the frame slightly', () => {
    const p = defaultParams()
    const mk = (t: boolean) => buildFloor({ ...p, floor: { shape: 'rect', width: 144.5, length: 73 } as never, finalHeight: 15, features: { ...p.features, drawers: true, edgeTrim: t } })
    const on = mk(true)
    expect(on.layout.cells.filter((c) => c.type === 'drawer')).toHaveLength(mk(false).layout.cells.filter((c) => c.type === 'drawer').length)
    expect(on.binCount).toBeGreaterThan(0)
  })
})

describe('plywood seams sit on support centres', () => {
  it('every seam between two panels is centred on a support', () => {
    for (const [W, L, dr] of [[144.5, 73, true], [144.5, 73, false], [144, 72, true], [120, 96, false]] as const) {
      const p = defaultParams()
      const b = buildFloor({ ...p, floor: { shape: 'rect', width: W, length: L } as never, finalHeight: 15, features: { ...p.features, drawers: dr, edgeTrim: false } })
      const dk = b.placements.filter((q) => q.kind === 'deck' || q.kind === 'hatch')
      const sup = b.placements.filter((q) => ['joist', 'block', 'rim', 'buildup'].includes(q.kind))
      for (const d of dk)
        for (const e of dk) {
          if (d === e) continue
          for (const ax of ['x', 'y'] as const) {
            const o = ax === 'x' ? 'y' : 'x'
            const sz = (r: { sx: number; sy: number }, a: string) => (a === 'x' ? r.sx : r.sy)
            const lo = (r: { x: number; y: number }, a: string) => (a === 'x' ? r.x : r.y)
            const pos = lo(d, ax) + sz(d, ax)
            if (Math.abs(lo(e, ax) - pos) > 0.05) continue
            const a0 = Math.max(lo(d, o), lo(e, o))
            const a1 = Math.min(lo(d, o) + sz(d, o), lo(e, o) + sz(e, o))
            if (a1 - a0 < 1) continue
            let hit = 0
            let total = 0
            for (let mid = a0 + 1; mid < a1; mid += 2) {
              if (sup.some((s) => sz(s, ax) > sz(s, o) && mid >= lo(s, o) && mid <= lo(s, o) + sz(s, o) && pos >= lo(s, ax) && pos <= lo(s, ax) + sz(s, ax))) continue // crossing a perpendicular joist
              total++
              const run = sup.filter((s) => sz(s, o) >= sz(s, ax) && mid >= lo(s, o) && mid <= lo(s, o) + sz(s, o) && pos >= lo(s, ax) - 0.01 && pos <= lo(s, ax) + sz(s, ax) + 0.01)
              if (!run.length) continue
              hit++
              const u0 = Math.min(...run.map((s) => lo(s, ax)))
              const u1 = Math.max(...run.map((s) => lo(s, ax) + sz(s, ax)))
              if (Math.abs((u0 + u1) / 2 - pos) >= 0.3 && Math.min(pos - u0, u1 - pos) < 1.7) throw new Error(`off ${W}x${L} dr=${dr} ${ax}=${pos} @${mid} ${u0}..${u1} ${run.map((r) => r.kind + r.x + ',' + r.y + ',' + r.sx + ',' + r.sy).join(' ')}`)
            }
            expect(total === 0 || hit / total > 0.6).toBe(true)          }
        }
    }
  })
})
describe('structure weight', () => {
  const mk = (w: number, l: number, lifts: { x: number; y: number }[] = []) => {
    const d = defaultParams()
    const b = buildFloor({ ...d, floor: { shape: 'rect', width: w, length: l } as never, liftTables: lifts })
    const mats = suggestTatami(b.geometry.rects, b.params)[0].mats
    return estimateWeight(b, mats)
  }
  it('is positive and grows with area', () => {
    const a = mk(96, 72).total
    expect(a).toBeGreaterThan(100)
    expect(mk(144, 96).total).toBeGreaterThan(a)
  })
  it('counts the lift table assembly', () => {
    const base = mk(144, 96)
    const withLift = mk(144, 96, [{ x: 0, y: 0 }])
    expect(withLift.rows.some((r) => r.label.startsWith('Motorized'))).toBe(true)
    expect(withLift.total).toBeGreaterThan(base.total + 40)
  })
})

describe('web optimizer', () => {
  it('fewer webs at wider spacing, lighter structure, within chord limit', () => {
    const d = defaultParams()
    const mk = (webOc: number) => buildFloor({ ...d, floor: { shape: 'rect', width: 144, length: 73 } as never, webOc })
    const b = mk(16)
    const rec = maxWebOc(b)
    expect(rec).toBeGreaterThanOrEqual(16)
    expect(rec).toBeLessThanOrEqual(24)
    const c = mk(rec)
    const webs = (x: typeof b) => x.parts.filter((q) => q.name.includes('vertical web')).reduce((s, q) => s + q.qty, 0)
    expect(webs(c)).toBeLessThan(webs(b))
    expect(estimateWeight(c, []).total).toBeLessThan(estimateWeight(b, []).total)
  })
})

describe('underlay compresses the supports', () => {
  it('keeps final height and tatami/ply thickness; only the frame shrinks', () => {
    const d = defaultParams()
    const mk = (underlay: boolean) => buildFloor({ ...d, floor: { shape: 'rect', width: 144, length: 73 } as never, finalHeight: 20, features: { ...d.features, underlay } })
    const a = mk(false), b = mk(true)
    expect(a.supportHeight - b.supportHeight).toBeCloseTo(b.params.underlayThickness, 5)
    const top = (x: typeof a) => Math.max(...x.placements.filter((q) => q.kind === 'deck').map((q) => q.z + q.sz)) + x.params.tatamiThickness
    expect(top(b)).toBeCloseTo(20, 5)
    expect(top(a)).toBeCloseTo(20, 5)
  })
})

describe('drawer clearance', () => {
  it('drawer box top is 6" below the top of the supports when height allows', () => {
    const d = defaultParams()
    const b = buildFloor({ ...d, floor: { shape: 'rect', width: 144, length: 73 } as never, features: { ...d.features, drawers: true }, finalHeight: 30 })
    const box = b.placements.filter((q) => q.kind === 'drawer' && q.sz > 3)
    expect(box.length).toBeGreaterThan(0)
    for (const q of box) expect(b.supportHeight - (q.z + q.sz)).toBeCloseTo(6, 5)
  })
})

describe('crowd scenario', () => {
  it('is 1 person per 15 sq ft plus adjustment', () => {
    const d = defaultParams()
    const mk = (peopleAdj: number) => buildFloor({ ...d, floor: { shape: 'rect', width: 120, length: 60 } as never, peopleAdj })
    expect(crowdScenario(mk(0)).people).toBe(Math.ceil(50 / 15))
    expect(crowdScenario(mk(-3)).people).toBe(1)
  })
})

describe('deleting supports', () => {
  it('removing a cross support re-spaces the rest evenly', () => {
    const d = defaultParams()
    const base = { ...d, floor: { shape: 'rect', width: 144, length: 120 } as never, features: { ...d.features, drawers: false } }
    const n = (extra: number) => buildFloor({ ...base, colAdjust: { '0:0': extra } }).layout.sections[0].colRows[0]
    const rows = n(2)
    const fewer = n(-1)
    expect(fewer.length).toBe(n(0).length - 1)
    const gaps = fewer.map((r) => r.l)
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.01)
    expect(rows.length).toBeGreaterThan(fewer.length)
  })
})

describe('long runs', () => {
  it('splices runs over 8 ft into pieces of 8 ft or less', () => {
    const d = defaultParams()
    const b = buildFloor({ ...d, floor: { shape: 'rect', width: 170, length: 100 } as never, features: { ...d.features, drawers: false } })
    const rim = b.parts.filter((q) => q.name.startsWith('Back rim'))
    expect(rim.length).toBeGreaterThan(1)
    const lens = rim.map((q) => q.length)
    expect(Math.max(...lens)).toBeLessThanOrEqual(96.01)
  })
})
