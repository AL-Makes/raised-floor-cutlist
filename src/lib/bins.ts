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

export const CUSTOM_BIN_ID = 'custom'

export const findBin = (id: string) => IKEA_BINS.find((b) => b.id === id)

/** Standard IKEA storage-box footprints (long x short, mm), largest first. */
export const STANDARD_BIN_FOOTPRINTS_MM: [number, number][] = [[560, 390], [390, 280], [280, 195], [195, 140]]
