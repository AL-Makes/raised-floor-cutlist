import type { Build } from './build'
import { findBin } from './bins'
import { matSchedule, type Mat } from './tatami'
import { formatLength, type UnitSystem } from './units'

export interface CostItem {
  key: string
  group: string
  label: string
  qty: number
  unit: string
  unitPrice: number
  total: number
  notes?: string
}

export interface CostGroup {
  group: string
  items: CostItem[]
  subtotal: number
}

export interface CostReport {
  groups: CostGroup[]
  items: CostItem[]
  total: number
}

const DEFAULT_PRICES: Record<string, number> = {
  'lumber:2x4': 4.5,
  'lumber:2x6': 7.5,
  'lumber:2x8': 10.5,
  'lumber:2x10': 14.0,
  'lumber:1x2': 2.5,
  'lumber:1x3': 3.25,
  'lumber:1x4': 4.0,
  'lumber:1x6': 6.0,
  'sheet:ply-0.75': 58.0,
  'sheet:ply-0.625': 48.0,
  'sheet:ply-0.5': 42.0,
  'tatami:Full mat': 140.0,
  'tatami:Square mat': 95.0,
  'lift:column': 320.0,
  'bin:main': 12.0,
  'bin:split': 8.0,
  'bin:ikea-drawer': 45.0,
  'hw:pocket-screw': 0.08,
  'hw:deck-screw': 0.06,
  'hw:underlay': 1.25,
  'hw:adhesive': 7.5,
  'hw:caster': 4.5,
  'hw:drawer-pull': 5.0,
  'hw:acoustic-strip': 0.5,
  'hw:finger-pull': 6.0,
  'hw:grommet': 3.0,
}

export function defaultPriceFor(key: string): number {
  if (key in DEFAULT_PRICES) return DEFAULT_PRICES[key]
  if (key.startsWith('lumber:')) return 5.0
  if (key.startsWith('sheet:')) return 50.0
  return 5.0
}

function hwKey(name: string): string | null {
  if (name.startsWith('Motorized lift table')) return null // handled in Motorized lift table group
  if (name.startsWith('Smaller bins')) return null // handled in Storage bins & drawers group
  if (name.startsWith('Pocket screws')) return 'hw:pocket-screw'
  if (name.startsWith('Deck screws')) return 'hw:deck-screw'
  if (name.startsWith('Acoustic underlay')) return 'hw:underlay'
  if (name.startsWith('Construction adhesive')) return 'hw:adhesive'
  if (name.startsWith('Caster wheels')) return 'hw:caster'
  if (name.startsWith('Drawer pulls')) return 'hw:drawer-pull'
  if (name.startsWith('Acoustic isolation')) return 'hw:acoustic-strip'
  if (name.startsWith('Recessed finger')) return 'hw:finger-pull'
  if (name.startsWith('Cable pass-through')) return 'hw:grommet'
  return `hw:${name}`
}

export function estimateCost(build: Build, mats: Mat[], units: UnitSystem = 'imperial'): CostReport {
  const p = build.params
  const prices = p.prices ?? {}
  const f = (v: number) => formatLength(v, units)
  const priceOf = (key: string) => {
    const v = prices[key]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : defaultPriceFor(key)
  }

  const items: CostItem[] = []
  const add = (key: string, group: string, label: string, qty: number, unit: string, notes?: string) => {
    if (qty <= 0) return
    const unitPrice = priceOf(key)
    items.push({ key, group, label, qty, unit, unitPrice, total: qty * unitPrice, notes })
  }

  // 1. Lumber
  for (const l of build.lumberPlans) {
    const key = `lumber:${l.material}`
    add(key, 'Lumber', `${l.material} lumber (${f(l.stockLength)} board)`, l.boards.length, 'boards', `${l.wastePct.toFixed(0)}% waste`)
  }

  // 2. Plywood & sheet goods
  for (const s of build.sheetPlans) {
    const key = `sheet:${s.material}`
    add(key, 'Plywood & sheet goods', `${s.material} plywood (${f(p.sheetL)} x ${f(p.sheetW)} sheet)`, s.sheets.length, 'sheets', `${s.wastePct.toFixed(0)}% waste`)
  }

  // 3. Tatami mats (include full/square mats; filler pieces are cut from plywood sheets, plus each lift table carries a square tatami mat)
  const liftMats: Mat[] = p.liftTables.map((l) => ({ x: l.x, y: l.y, w: p.tatamiShort, l: p.tatamiShort, kind: 'square' as const }))
  const sched = matSchedule([...mats.filter((m) => m.kind !== 'cut'), ...liftMats])
  for (const m of sched) {
    const key = `tatami:${m.name}`
    add(key, 'Tatami mats', `${m.name} (${f(m.w)} x ${f(m.l)})`, m.qty, 'mats')
  }

  // 4. Motorized lift table
  if (p.liftTables.length > 0) {
    add(
      'lift:column',
      'Motorized lift table',
      `Motorized lift table column (${f(p.tatamiShort)} square table)`,
      p.liftTables.length,
      'pcs',
      'Column, motor & controller (wood base/top counted in Plywood)',
    )
  }

  // 5. Storage bins & rolling drawers
  const splitBins = build.placements.filter((q) => q.kind === 'bin' && q.split)
  const mainBinCount = Math.max(0, build.binCount - splitBins.length)
  const binInfo = findBin(p.binId)
  if (mainBinCount > 0) {
    add(
      'bin:main',
      'Storage bins',
      binInfo ? `${binInfo.name} storage bin` : `Storage bin (${f(p.bin.w)} x ${f(p.bin.d)} x ${f(p.bin.h)})`,
      mainBinCount,
      'bins',
    )
  }
  if (splitBins.length > 0) {
    add(
      'bin:split',
      'Storage bins',
      `Smaller split bin (~${f(splitBins[0].sx)} x ${f(splitBins[0].sy)} x ${f(p.bin.h)})`,
      splitBins.length,
      'bins',
    )
  }

  // 6. Hardware & underlay
  for (const h of build.hardware) {
    const k = hwKey(h.name)
    if (!k) continue
    add(k, 'Hardware & underlay', h.name, h.qty, h.unit, h.notes)
  }

  const groupOrder = ['Lumber', 'Plywood & sheet goods', 'Tatami mats', 'Motorized lift table', 'Storage bins', 'Hardware & underlay']
  const groups: CostGroup[] = []
  for (const g of groupOrder) {
    const gItems = items.filter((i) => i.group === g)
    if (gItems.length > 0) {
      groups.push({
        group: g,
        items: gItems,
        subtotal: gItems.reduce((s, i) => s + i.total, 0),
      })
    }
  }

  return {
    groups,
    items,
    total: groups.reduce((s, g) => s + g.subtotal, 0),
  }
}
