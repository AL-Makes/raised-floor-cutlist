import type { Build } from './build'
import { matSchedule, type Mat } from './tatami'
import { formatLength, type UnitSystem } from './units'

const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`

export function toCsv(b: Build, mats: Mat[], units: UnitSystem): string {
  const f = (v: number) => formatLength(v, units)
  const rows: string[] = []
  rows.push(['#', 'Group', 'Part', 'Material', 'Qty', 'Length', 'Width', 'Thickness', 'Pocket holes', 'Notes'].map(q).join(','))
  for (const p of b.parts) {
    rows.push(
      [p.id, p.group, p.name, p.material, p.qty, f(p.length), f(p.width), f(p.thickness), p.pockets ?? 0, p.notes ?? ''].map(q).join(','),
    )
  }
  rows.push('')
  rows.push(['Stock to buy', 'Material', 'Qty', 'Size', 'Waste %'].map(q).join(','))
  for (const l of b.lumberPlans) rows.push(['Lumber', l.material, l.boards.length, f(l.stockLength), l.wastePct.toFixed(1)].map(q).join(','))
  for (const s of b.sheetPlans) rows.push(['Sheet', s.material, s.sheets.length, `${f(b.params.sheetL)} x ${f(b.params.sheetW)}`, s.wastePct.toFixed(1)].map(q).join(','))
  rows.push('')
  rows.push(['Hardware', 'Qty', 'Unit', 'Notes'].map(q).join(','))
  for (const h of b.hardware) rows.push([h.name, h.qty, h.unit, h.notes ?? ''].map(q).join(','))
  if (mats.length) {
    rows.push('')
    rows.push(['Tatami', 'Qty', 'Length', 'Width'].map(q).join(','))
    for (const m of matSchedule(mats)) rows.push([m.name, m.qty, f(m.w), f(m.l)].map(q).join(','))
  }
  return rows.join('\r\n')
}
