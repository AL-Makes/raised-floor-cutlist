export type FloorShape = 'rect' | 'L' | 'poly'

export interface Pt {
  x: number
  y: number
}

export interface FloorSpec {
  shape: FloorShape
  /** overall width (x) and length (y), inches */
  width: number
  length: number
  /** L-shape: notch removed from the back-right corner */
  notchW: number
  notchL: number
  /** poly shape: right-angled outline, corners in order, inches */
  poly?: Pt[]
  /** edge i runs from corner i to corner i+1; this edge becomes the front (drawers, joists run away from it) */
  frontEdge?: number
}

export interface Rect {
  x: number
  y: number
  w: number
  l: number
}

export interface Features {
  drawers: boolean
  hatches: boolean
  edgeTrim: boolean
  acousticStrips: boolean
  /** full-coverage acoustic / protective underlay sheet laid on the slab under the whole frame */
  underlay: boolean
}

export interface TrimSides {
  front: boolean
  back: boolean
  left: boolean
  right: boolean
}

export interface Reinforce {
  doubleJoists: boolean
}

export type TatamiPatternId = 'rows' | 'columns' | 'brick' | 'brickV' | 'basket' | 'squares' | 'pinwheel'

export interface Params {
  floor: FloorSpec
  /** slab to top of tatami, inches */
  finalHeight: number
  plyThickness: number
  tatamiThickness: number
  sheetW: number
  sheetL: number
  lumberLengths: number[]
  kerf: number
  binId: string
  bin: { w: number; d: number; h: number }
  /** true = bin's long side runs along the joists (y) */
  binLongAlongJoists: boolean
  clearance: number
  /** front-row drawers: custom built from plywood, or a ready-made IKEA rolling box */
  drawerKind: 'built' | 'ikea'
  /** solid = one deep board on edge; builtup = 2x4 top + bottom chords with vertical 2x4 webs */
  joistStyle: 'solid' | 'builtup'
  rollingBox: { id: string; w: number; d: number; h: number }
  maxSpacing: number
  features: Features
  trimSides: TrimSides
  reinforce: Reinforce
  heightOption: number
  designLoadPsf: number
  pointLoadLb: number
  /** bearing points (shim pads) under each joist, end to end; 0 = joists rest continuously on the slab */
  supportCount: number
  /** change in the number of main joists vs. the bin-driven count (applies to every section) */
  joistAdjust: number
  /** change in the number of cross joists (blocking rows) vs. the bin-driven count */
  crossAdjust: number
  /** per-section extra joists (x = main, y = cross), added on top of the global adjusts */
  secAdjust?: Record<number, { x: number; y: number }>
  /** manual joist moves in inches from the auto-spaced position, keyed `${section}:${'x'|'y'}:${index}` */
  moves: Record<string, number>
  tatamiPattern: TatamiPatternId
  /** thickness of the acoustic underlay (QEP natural cork is 6 mm, about 1/4") */
  underlayThickness: number
  /** which corner the tatami layout starts from, or centered (cuts split evenly on both sides) */
  tatamiAnchor: 'bl' | 'br' | 'tl' | 'tr' | 'center'
  tatamiLong: number
  tatamiShort: number
  /** lower-left corners of square tatami mats replaced by motorized lift tables */
  liftTables: { x: number; y: number }[]
}

export type MaterialKind = 'lumber' | 'sheet'

export interface Part {
  id: string
  group: string
  name: string
  kind: MaterialKind
  /** material key, e.g. "2x4", "ply-0.75" */
  material: string
  qty: number
  /** lumber: cut length; sheet: longer side */
  length: number
  /** sheet: shorter side; lumber: face width */
  width: number
  thickness: number
  notes?: string
  pockets?: number
}

export type PlacementKind =
  | 'lift'
  | 'service'
  | 'joist'
  | 'rim'
  | 'block'
  | 'buildup'
  | 'underlay'
  | 'header'
  | 'deck'
  | 'drawer'
  | 'drawerFace'
  | 'bin'
  | 'trim'
  | 'backer'

export interface Placement {
  kind: PlacementKind
  /** min corner, inches; z up */
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
  cell?: number
  /** movable joist: section, axis the joist is moved along, and index within the section */
  ref?: { s: number; axis: 'x' | 'y'; k: number }
}

export type CellType = 'bin' | 'drawer' | 'service'

export interface Cell {
  index: number
  /** stable id `${section}:${col}:${row}` */
  key: string
  section: number
  x: number
  y: number
  w: number
  l: number
  type: CellType
  fitsBin: boolean
  /** how many bins sit side by side (x) and one behind another (y) in this cell */
  binsX: number
  binsY: number
}
