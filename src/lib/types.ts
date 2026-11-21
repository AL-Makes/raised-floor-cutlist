export type FloorShape = 'rect' | 'L'

export interface FloorSpec {
  shape: FloorShape
  /** overall width (x) and length (y), inches */
  width: number
  length: number
  /** L-shape: notch removed from the back-right corner */
  notchW: number
  notchL: number
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

export type TatamiPatternId = 'rows' | 'columns' | 'brick' | 'brickV' | 'basket' | 'squares'

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
  maxSpacing: number
  features: Features
  trimSides: TrimSides
  reinforce: Reinforce
  heightOption: number
  designLoadPsf: number
  pointLoadLb: number
  shimSpacing: number
  tatamiPattern: TatamiPatternId
  tatamiLong: number
  tatamiShort: number
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
  | 'joist'
  | 'rim'
  | 'block'
  | 'buildup'
  | 'header'
  | 'deck'
  | 'hatch'
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
}

export type CellType = 'bin' | 'drawer'

export interface Cell {
  index: number
  section: number
  x: number
  y: number
  w: number
  l: number
  type: CellType
  fitsBin: boolean
}
