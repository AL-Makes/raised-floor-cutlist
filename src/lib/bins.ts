import { mmToIn } from './units'

export interface BinSpec {
  id: string
  name: string
  series: string
  /** outer footprint + height, inches */
  w: number
  d: number
  h: number
  url: string
}

const search = (q: string) => `https://www.ikea.com/us/en/search/?q=${encodeURIComponent(q)}`

function bin(id: string, name: string, series: string, wCm: number, dCm: number, hCm: number): BinSpec {
  return {
    id,
    name,
    series,
    w: mmToIn(wCm * 10),
    d: mmToIn(dCm * 10),
    h: mmToIn(hCm * 10),
    url: search(series),
  }
}

/**
 * Common IKEA bins (outer dimensions, cm). IKEA has no public API, so these are
 * approximate built-ins - always confirm on the product page and use the custom
 * size entry if your bin differs.
 */
export const IKEA_BINS: BinSpec[] = [
  bin('samla-6', 'SAMLA 6 L', 'SAMLA', 28, 20, 14),
  bin('samla-11', 'SAMLA 11 L', 'SAMLA', 39, 28, 14),
  bin('samla-22', 'SAMLA 22 L', 'SAMLA', 39, 28, 28),
  bin('samla-45', 'SAMLA 45 L', 'SAMLA', 56, 39, 28),
  bin('samla-57', 'SAMLA 57 L', 'SAMLA', 78, 56, 18),
  bin('samla-130', 'SAMLA 130 L', 'SAMLA', 78, 56, 42),
  bin('kuggis-small', 'KUGGIS box w/ lid 26x35x8', 'KUGGIS', 26, 35, 8),
  bin('kuggis-large', 'KUGGIS box w/ lid 37x54x21', 'KUGGIS', 37, 54, 21),
  bin('trofast-low', 'TROFAST box 42x30x10', 'TROFAST', 42, 30, 10),
  bin('trofast-high', 'TROFAST box 42x30x23', 'TROFAST', 42, 30, 23),
  bin('drona', 'DRONA box 33x38x33', 'DRONA', 33, 38, 33),
  bin('skubb', 'SKUBB box 31x34x33', 'SKUBB', 31, 34, 33),
  bin('tjena', 'TJENA box w/ lid 35x50x30', 'TJENA', 35, 50, 30),
  bin('stuk', 'STUK box w/ lid 34x51x18', 'STUK', 34, 51, 18),
]

export interface RollingBoxSpec {
  id: string
  name: string
  w: number
  d: number
  h: number
  /** true when IKEA sells it with wheels already fitted */
  casters: boolean
  url: string
}

function rolling(id: string, name: string, q: string, wCm: number, dCm: number, hCm: number, casters: boolean): RollingBoxSpec {
  return { id, name, w: mmToIn(wCm * 10), d: mmToIn(dCm * 10), h: mmToIn(hCm * 10), casters, url: search(q) }
}

/**
 * Ready-made IKEA under-bed boxes that can be used as drawers instead of building them.
 * Sizes are approximate (cm, outer, wheels included) - confirm on ikea.com or enter your own.
 */
export const IKEA_ROLLING_BOXES: RollingBoxSpec[] = [
  { ...rolling('malm-box', 'MALM underbed box for high bed 37 3/8 x 24 3/8 x 11 3/8 (2 pack)', 'MALM underbed storage box high bed', 94.9, 61.9, 28.9, true), url: 'https://www.ikea.com/us/en/p/malm-underbed-storage-box-for-high-bed-dark-brown-veneer-70599439/' },
  rolling('smyga', 'SMYGA bed storage box', 'SMYGA bed storage box', 99, 91, 29, false),
  rolling('stuk-71', 'STUK storage case 71x51x18 (add castors)', 'STUK storage case', 71, 51, 18, false),
  rolling('skubb-65', 'SKUBB storage case 65x53x19 (add castors)', 'SKUBB storage case', 65, 53, 19, false),
  rolling('skubb-90', 'SKUBB storage case 90x53x19 (add castors)', 'SKUBB storage case', 90, 53, 19, false),
]

export const CUSTOM_ROLLING_ID = 'custom'

export function findRollingBox(id: string): RollingBoxSpec | undefined {
  return IKEA_ROLLING_BOXES.find((b) => b.id === id)
}

export const CUSTOM_BIN_ID = 'custom'

export function findBin(id: string): BinSpec | undefined {
  return IKEA_BINS.find((b) => b.id === id)
}
