import type { Build } from './lib/build'
import { floorPolygon } from './lib/geometry'
import type { LayerKey } from './components/Viewer3D'
import { LAYER_LABELS } from './components/Viewer3D'

export const DEMO_MS = 42000

export const DEMO_CAPTIONS = [
  'Drag the walls to reshape the floor - corners stay square',
  'Pick any IKEA bin - the layout re-fits to its size',
  'Change the height - the frame and render update live',
  'Layers: switch them on, fade them out, see inside',
  'Side panels on - add and remove drawers, pull them out',
  'Tatami layouts - swap a square mat for a lift table',
  'Lift table raised - this was just a demo',
]

export interface DemoCtx {
  alive: () => boolean
  caption: (i: number) => void
  build: () => Build
  setPulls: (p: Record<string, number>) => void
}

class Stopped extends Error {}

export async function runDemo(ctx: DemoCtx) {
  const cur = document.createElement('div')
  cur.className = 'demo-cursor'
  cur.style.transform = `translate(${window.innerWidth / 2}px, ${window.innerHeight / 2}px)`
  document.body.appendChild(cur)

  const wait = async (ms: number) => {
    await new Promise((r) => setTimeout(r, ms))
    if (!ctx.alive()) throw new Stopped()
  }
  const place = (x: number, y: number) => { cur.style.transform = `translate(${x}px, ${y}px)` }
  const glide = async (x: number, y: number, ms = 500) => {
    cur.style.transition = `transform ${ms}ms ease-in-out`
    place(x, y)
    await wait(ms)
    cur.style.transition = 'none'
  }
  const center = (el: Element) => {
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  const to = async (el: Element, ms = 500) => {
    el.scrollIntoView({ block: 'nearest' })
    await wait(30)
    const c = center(el)
    await glide(c.x, c.y, ms)
    const c2 = center(el)
    if (Math.abs(c2.x - c.x) + Math.abs(c2.y - c.y) > 4) await glide(c2.x, c2.y, 150)
  }
  const pulse = async () => {
    cur.classList.add('click')
    await wait(220)
    cur.classList.remove('click')
  }
  const q = <T extends Element>(s: string) => document.querySelector<T>(s)
  const tween = async (from: number, to2: number, ms: number, fn: (v: number) => void) => {
    const steps = Math.max(1, Math.round(ms / 33))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      fn(from + (to2 - from) * (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2))
      await wait(33)
    }
  }
  const setValue = (el: HTMLInputElement | HTMLSelectElement, v: string, evt: string) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v)
    el.dispatchEvent(new Event(evt, { bubbles: true }))
  }
  const ptr = (type: string, x: number, y: number) =>
    new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'mouse', button: 0, isPrimary: true })

  const dragWall = async (i: number, delta: number, ms = 1200) => {
    const svg = q<SVGSVGElement>('.shape-plan')!
    const line = document.querySelectorAll('.shape-plan line[stroke="transparent"]')[i]
    const poly = floorPolygon(ctx.build().params.floor)
    const horizontal = poly[i].y === poly[(i + 1) % poly.length].y
    const r = line.getBoundingClientRect()
    const x0 = horizontal ? r.left + r.width * 0.25 : r.left
    const y0 = horizontal ? r.top : r.top + r.height * 0.25
    const k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width
    await glide(x0, y0, 600)
    cur.classList.add('down')
    line.dispatchEvent(ptr('pointerdown', x0, y0))
    await tween(0, delta, ms, (v) => {
      const x = horizontal ? x0 : x0 + v * k
      const y = horizontal ? y0 - v * k : y0
      place(x, y)
      svg.dispatchEvent(ptr('pointermove', x, y))
    })
    svg.dispatchEvent(ptr('pointerup', horizontal ? x0 : x0 + delta * k, horizontal ? y0 - delta * k : y0))
    cur.classList.remove('down')
    await wait(250)
  }

  const layerRow = (k: LayerKey) => [...document.querySelectorAll('.layerrow')].find((r) => r.textContent?.includes(LAYER_LABELS[k]))!
  const tabBtn = (i: number) => document.querySelectorAll<HTMLButtonElement>('.tabs button')[i]

  try {
    ctx.caption(0)
    await wait(700)
    await dragWall(1, 24)
    await dragWall(3, 24)
    await dragWall(4, 12, 900)

    ctx.caption(1)
    const sel = q<HTMLSelectElement>('.inputs select')!
    for (const id of ['samla-45', 'samla-11', 'samla-22']) {
      await to(sel, 500)
      await pulse()
      setValue(sel, id, 'change')
      await wait(1000)
    }

    ctx.caption(2)
    const slider = q<HTMLInputElement>('.vslider')!
    await to(slider, 500)
    const frac = (v: number) => (v - 4) / 32
    const sr = () => slider.getBoundingClientRect()
    const thumb = (v: number) => place(sr().left + sr().width / 2, sr().bottom - 8 - (sr().height - 16) * frac(v))
    thumb(16)
    cur.classList.add('down')
    await tween(16, 26, 1300, (v) => { thumb(v); setValue(slider, String(v), 'input') })
    await wait(250)
    await tween(26, 18, 1100, (v) => { thumb(v); setValue(slider, String(v), 'input') })
    cur.classList.remove('down')
    await wait(200)

    ctx.caption(3)
    for (const k of ['tatami', 'deck'] as LayerKey[]) {
      const cb = layerRow(k).querySelector<HTMLInputElement>('input[type=checkbox]')!
      await to(cb, 450)
      await pulse()
      cb.click()
      await wait(350)
    }
    const fade = async (k: LayerKey, from: number, v: number) => {
      const rg = layerRow(k).querySelector<HTMLInputElement>('input[type=range]')!
      await to(rg, 400)
      await tween(from, v, 700, (x) => setValue(rg, String(Math.round(x * 20) / 20), 'input'))
    }
    await fade('tatami', 1, 0.15)
    await fade('deck', 0.6, 0.15)
    await wait(300)
    for (const k of ['tatami', 'deck'] as LayerKey[]) {
      const cb = layerRow(k).querySelector<HTMLInputElement>('input[type=checkbox]')!
      await to(cb, 300)
      cb.click()
      await wait(150)
    }

    ctx.caption(4)
    const sideCb = layerRow('side').querySelector<HTMLInputElement>('input[type=checkbox]')!
    if (!sideCb.checked) {
      await to(sideCb, 500)
      await pulse()
      sideCb.click()
      await wait(600)
    }
    const dr = [...document.querySelectorAll('label.check')].find((l) => l.textContent?.includes('Drawers on the front row'))!.querySelector<HTMLInputElement>('input')!
    await to(dr, 600)
    await pulse()
    dr.click()
    await wait(700)
    const b = ctx.build()
    const drawers = b.layout.cells.filter((c) => c.type === 'drawer')
    const reach = (idx: number) => {
      const ps = b.placements.filter((p) => p.kind === 'drawer' && p.cell === idx)
      return ps.length ? Math.max(...ps.map((p) => p.y + p.sy)) - Math.min(...ps.map((p) => p.y)) : 0
    }
    const cv = q('.viewer canvas')
    if (cv) {
      const r = cv.getBoundingClientRect()
      await glide(r.left + r.width * 0.5, r.top + r.height * 0.8, 600)
    }
    cur.classList.add('down')
    await tween(0, 0.8, 1100, (v) => ctx.setPulls(Object.fromEntries(drawers.map((c) => [`d${c.index}`, reach(c.index) * v]))))
    cur.classList.remove('down')
    await wait(700)
    cur.classList.add('down')
    await tween(0.8, 0, 800, (v) => ctx.setPulls(Object.fromEntries(drawers.map((c) => [`d${c.index}`, reach(c.index) * v]))))
    cur.classList.remove('down')
    await wait(300)
    for (let i = 0; i < 2; i++) {
      await to(dr, 500)
      await pulse()
      dr.click()
      await wait(800)
    }
    await wait(150)

    ctx.caption(5)
    await to(tabBtn(1), 500)
    await pulse()
    tabBtn(1).click()
    await wait(500)
    for (const i of [1, 2]) {
      const card = document.querySelectorAll<HTMLButtonElement>('.cards .card')[i]
      if (!card) continue
      await to(card, 450)
      await pulse()
      card.click()
      await wait(550)
    }
    const mats = [...document.querySelectorAll<SVGGElement>('.tab svg g[style*="pointer"]')]
    const clear = (g: SVGGElement) => {
      const r = g.querySelector('rect')!
      const [x, y, w, l] = ['x', 'y', 'width', 'height'].map((a) => Number(r.getAttribute(a)))
      return !drawers.some((c) => x < c.x + c.w && x + w > c.x && y < c.y + c.l && y + l > c.y)
    }
    const mat = mats.find(clear) ?? mats[0]
    if (mat) {
      await to(mat, 500)
      await pulse()
      mat.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await wait(600)
    }

    ctx.caption(6)
    await to(tabBtn(0), 500)
    await pulse()
    tabBtn(0).click()
    await wait(700)
    const lp = ctx.build().placements.find((p) => p.lift !== undefined)
    if (lp) {
      const c = q('.viewer canvas')
      if (c) {
        const r = c.getBoundingClientRect()
        await glide(r.left + r.width * 0.5, r.top + r.height * 0.55, 500)
      }
      cur.classList.add('down')
      await tween(0, 9, 1000, (v) => ctx.setPulls({ [`l${lp.lift}`]: v }))
      cur.classList.remove('down')
    }
    await wait(500)
  } catch (e) {
    if (!(e instanceof Stopped)) throw e
  } finally {
    cur.remove()
    ctx.setPulls({})
  }
}
